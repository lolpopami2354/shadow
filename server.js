// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Provider keys (set env if you use Google/Bing)
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_CX = process.env.GOOGLE_CX;
const BING_API_KEY = process.env.BING_API_KEY;

// --- Simple in-memory storage (demo) ---
const store = {
  bookmarks: [], // { id, title, url, ts }
  history: [],   // { id, title, url, ts }
};
const uid = () => Math.random().toString(36).slice(2, 10);

// --- Search proxy ---
app.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  const provider = (req.query.provider || "duckduckgo").toLowerCase();
  const start = parseInt(req.query.start || "1", 10);

  if (!q) return res.status(400).json({ error: "Missing q" });

  try {
    if (provider === "duckduckgo") {
      const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
      const r = await fetch(url);
      if (!r.ok) return res.status(r.status).json({ error: "DuckDuckGo failed" });
      const data = await r.json();
      // Normalize
      const primary = data.Heading
        ? [{ title: data.Heading, snippet: data.Abstract || "", url: data.AbstractURL || "#" }]
        : [];
      const related = (data.RelatedTopics || [])
        .flatMap(rt => rt.Topics ? rt.Topics : [rt])
        .filter(t => t && t.Text && t.FirstURL)
        .map(t => ({ title: t.Text, snippet: "", url: t.FirstURL }));
      return res.json({ provider, items: [...primary, ...related].slice(0, 10), nextStart: null });
    }

    if (provider === "google") {
      if (!GOOGLE_API_KEY || !GOOGLE_CX) return res.status(500).json({ error: "Google not configured" });
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", GOOGLE_API_KEY);
      url.searchParams.set("cx", GOOGLE_CX);
      url.searchParams.set("q", q);
      url.searchParams.set("start", String(start));
      const r = await fetch(url.toString());
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      const items = (data.items || []).map(it => ({
        title: it.title,
        snippet: it.snippet,
        url: it.link,
        displayUrl: it.displayLink,
      }));
      const next = data.queries?.nextPage?.[0]?.startIndex || null;
      return res.json({ provider, items, nextStart: next });
    }

    if (provider === "bing") {
      if (!BING_API_KEY) return res.status(500).json({ error: "Bing not configured" });
      const url = `https://api.bing.microsoft.com/v7.0/search?q=${encodeURIComponent(q)}`;
      const r = await fetch(url, { headers: { "Ocp-Apim-Subscription-Key": BING_API_KEY } });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json(data);
      const items = (data.webPages?.value || []).map(it => ({
        title: it.name,
        snippet: it.snippet,
        url: it.url,
        displayUrl: it.displayUrl,
      }));
      return res.json({ provider, items, nextStart: null });
    }

    return res.status(400).json({ error: "Unknown provider" });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Upstream fetch failed" });
  }
});

// --- AI proxy (demo echo; replace with your provider) ---
app.post("/ai", async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });
  // Demo: just echo. Replace with your AI call.
  return res.json({ reply: `Echo: ${prompt}` });
});

// --- Chat proxy (demo echo) ---
app.post("/chat", async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing message" });
  // Demo: echo with timestamp
  return res.json({ reply: `Server received "${message}" at ${new Date().toLocaleTimeString()}` });
});

// --- Bookmarks API (optional server-side) ---
app.get("/bookmarks", (req, res) => res.json({ items: store.bookmarks }));
app.post("/bookmarks", (req, res) => {
  const { title, url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Missing url" });
  const item = { id: uid(), title: title || url, url, ts: Date.now() };
  store.bookmarks.unshift(item);
  res.json(item);
});
app.delete("/bookmarks/:id", (req, res) => {
  const id = req.params.id;
  const i = store.bookmarks.findIndex(b => b.id === id);
  if (i >= 0) store.bookmarks.splice(i, 1);
  res.json({ ok: true });
});

// --- History API (optional server-side) ---
app.get("/history", (req, res) => res.json({ items: store.history }));
app.post("/history", (req, res) => {
  const { title, url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Missing url" });
  const item = { id: uid(), title: title || url, url, ts: Date.now() };
  store.history.unshift(item);
  store.history = store.history.slice(0, 200);
  res.json(item);
});
app.delete("/history/:id", (req, res) => {
  const id = req.params.id;
  const i = store.history.findIndex(h => h.id === id);
  if (i >= 0) store.history.splice(i, 1);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on http://localhost:${PORT}`));
