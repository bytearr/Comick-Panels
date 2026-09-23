import { sameChapter, scoreTitle } from "./match.js";
import { sources } from "./parsers/index.js";

const MIN_SCORE = 75;

const caches = new Map();
const referers = new Map();
let catalog = null;

function absolute(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return "";
  }
}

function slugFromUrl(url) {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const index = parts.indexOf("comic");
    return index >= 0 ? decodeURIComponent(parts[index + 1] || "") : "";
  } catch {
    return "";
  }
}

function orderedSources() {
  if (catalog) return catalog;
  catalog = sources;
  return catalog;
}

async function noteReferer(hit) {
  let referer = hit.referer;
  if (!referer || !referer.startsWith("http")) return;
  if (!referer.endsWith("/")) referer += "/";
  let changed = false;
  for (const page of hit.pages) {
    let host = "";
    try { host = new URL(page).host; } catch { host = ""; }
    if (!host || referers.get(host) === referer) continue;
    referers.set(host, referer);
    changed = true;
  }
  if (!changed) return;
  const rules = [...referers.entries()].slice(0, 90).map(([host, value], index) => ({
    id: index + 1,
    priority: 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "referer", operation: "set", value }]
    },
    condition: { urlFilter: `||${host}/`, resourceTypes: ["image"] }
  }));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: rules
  });
}

async function persist(cache) {
  const entries = [...cache.entries.entries()].map(([id, entry]) => [id, {
    manga: entry.manga,
    chapters: entry.chapters,
    pages: entry.pages || {},
    label: entry.label
  }]);
  await chrome.storage.local.set({
    ["manga:" + cache.slug]: {
      title: cache.title,
      entries,
      misses: [...cache.misses]
    }
  });
}

async function cacheFor(slug, title) {
  if (caches.has(slug)) {
    const existing = caches.get(slug);
    if (title) existing.title = title;
    return existing;
  }
  const cache = {
    slug,
    title: title || "",
    entries: new Map(),
    misses: new Set(),
    scanning: false,
    readers: new Set()
  };
  const stored = await chrome.storage.local.get("manga:" + slug);
  const saved = stored["manga:" + slug];
  if (saved) {
    cache.title = title || saved.title || "";
    for (const [id, entry] of saved.entries || []) cache.entries.set(id, entry);
    for (const id of saved.misses || []) cache.misses.add(id);
  }
  caches.set(slug, cache);
  return cache;
}

async function loadPages(source, chapter, entry) {
  const urls = await source.pages(chapter, entry.manga);
  return (urls || []).filter((url) => typeof url === "string" && url.startsWith("http"));
}

async function publishEntry(cache, sourceId, entry, reader) {
  const source = orderedSources().find((item) => item.id === sourceId);
  if (!source) return;
  const rows = (entry.chapters || []).filter((chapter) => sameChapter(reader.chapter, chapter.number));
  for (const row of rows) {
    if (!reader.port) return;
    const key = String(row.id);
    entry.pages = entry.pages || {};
    entry.inflight = entry.inflight || {};
    if (!entry.pages[key]) {
      if (!entry.inflight[key]) {
        entry.inflight[key] = loadPages(source, row, entry).finally(() => {
          delete entry.inflight[key];
        });
      }
      entry.pages[key] = await entry.inflight[key];
      await persist(cache);
    }
    const urls = entry.pages[key];
    if (!urls || !urls.length) continue;
    const extra = row.scanlator || row.branch || "";
    const hit = {
      id: `${sourceId}:${row.id}`,
      source: sourceId,
      chapter: row.number,
      label: extra ? `${entry.label} · ${extra}` : entry.label,
      referer: absolute("/", source.origin || entry.manga.publicUrl || entry.manga.url),
      pages: urls
    };
    try { await noteReferer(hit); } catch { /* the panel can still load */ }
    try { reader.port.postMessage({ type: "hit", hit }); } catch { /* tab closed */ }
  }
}

function publishAll(cache, reader) {
  return Promise.all([...cache.entries].map(([id, entry]) =>
    publishEntry(cache, id, entry, reader).catch(() => {})
  ));
}

function scoreManga(query, manga) {
  const names = [manga.title, ...(manga.altTitles || [])].filter(Boolean);
  return names.reduce((best, name) => Math.max(best, scoreTitle(query, name)), 0);
}

async function learn(source, title) {
  const searched = await source.search(title);
  const ranked = (searched || [])
    .map((manga) => ({ manga, score: scoreManga(title, manga) }))
    .filter((row) => row.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return null;
  const manga = await source.details(best.manga);
  if (!manga || !manga.chapters) return null;
  return {
    manga,
    chapters: manga.chapters,
    pages: {},
    label: source.label || source.id
  };
}

async function scan(cache) {
  if (cache.scanning) return;
  cache.scanning = true;
  try {
    const list = orderedSources();
    await pool(list, 4, async (source) => {
      if (cache.entries.has(source.id) || cache.misses.has(source.id)) return;
      let learned = null;
      try {
        learned = await learn(source, cache.title);
      } catch {
        return;
      }
      if (!learned) {
        cache.misses.add(source.id);
        await persist(cache);
        return;
      }
      cache.entries.set(source.id, learned);
      await persist(cache);
      await Promise.all([...cache.readers].map((reader) =>
        publishEntry(cache, source.id, learned, reader).catch(() => {})
      ));
    });
  } catch (error) {
    const text = error.message || "Parser failed";
    for (const reader of cache.readers) {
      try { reader.port.postMessage({ type: "error", error: text }); } catch { /* tab closed */ }
    }
  } finally {
    cache.scanning = false;
  }
}

async function pool(items, limit, fn) {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

chrome.alarms.clear("stop-parser");

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "find") return;
  port.onMessage.addListener(async (message) => {
    try {
      if (!message || !message.slug || message.chapter == null) return;
      const cache = await cacheFor(message.slug, message.title);
      const reader = { port, chapter: message.chapter };
      cache.readers.add(reader);
      port.onDisconnect.addListener(() => cache.readers.delete(reader));
      publishAll(cache, reader);
      scan(cache);
    } catch (error) {
      try { port.postMessage({ type: "error", error: error.message || "Parser failed" }); } catch { /* tab closed */ }
    }
  });
});

async function dropClosed() {
  const tabs = await chrome.tabs.query({
    url: ["https://comick.dev/comic/*", "https://comick.live/comic/*"]
  });
  const open = new Set(tabs.map((tab) => slugFromUrl(tab.url)).filter(Boolean));
  for (const slug of caches.keys()) {
    if (open.has(slug)) continue;
    caches.delete(slug);
    chrome.storage.local.remove("manga:" + slug);
  }
}

async function stopIfIdle() {
  await dropClosed();
}

function scheduleStop() {
  chrome.alarms.create("stop-parser", { when: Date.now() + 15000 });
}

chrome.tabs.onRemoved.addListener(() => scheduleStop());
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.url) scheduleStop();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "stop-parser") stopIfIdle();
});
