import { MIN_SCORE, sameChapter, scoreManga } from "./match.js";
import { sources } from "./parsers/index.js";

const CACHE = "manga3:";
const CHAPTER_TTL = 15 * 60 * 1000;
const MISS_TTL = 10 * 60 * 1000;
const PAGE_TTL = 5 * 60 * 1000;
const MAX_SERIES = 30;
const caches = new Map();
const loading = new Map();
let ruleQueue = Promise.resolve();

function send(reader, message) {
  if (!reader.active) return;
  try { reader.port.postMessage(message); } catch { reader.active = false; }
}

// Session rules disappear when the browser closes. Serialize read/modify/write
// so simultaneous sources/tabs cannot overwrite each other's referers.
function noteReferer(hit, tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return Promise.resolve();
  const job = ruleQueue.catch(() => {}).then(async () => {
    const existing = await chrome.declarativeNetRequest.getSessionRules();
    const previous = existing.filter((rule) =>
      rule.condition.tabIds?.includes(tabId) && rule.action.requestHeaders?.[0]?.value === hit.referer
    );
    const domains = [...new Set([
      ...previous.flatMap((rule) => rule.condition.requestDomains || []),
      ...hit.pages.map((page) => new URL(page).hostname)
    ])];
    const kept = existing.filter((rule) => !(
      rule.condition.tabIds?.includes(tabId) && rule.action.requestHeaders?.[0]?.value === hit.referer
    ));
    let id = 1;
    const used = new Set(kept.map((rule) => rule.id));
    while (used.has(id)) id += 1;
    const rule = {
      id, priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "referer", operation: "set", value: hit.referer }] },
      condition: { requestDomains: domains, tabIds: [tabId], resourceTypes: ["image"] }
    };
    // Bound rule count while retaining the most recently used source/tab rules.
    const next = [...kept, rule].slice(-90);
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: existing.map((item) => item.id), addRules: next
    });
  });
  ruleQueue = job;
  return job;
}

function persist(cache) {
  cache.writes = (cache.writes || Promise.resolve()).catch(() => {}).then(() => {
    const entries = [...cache.entries].map(([id, entry]) => [id, {
      manga: entry.manga, chapters: entry.chapters, label: entry.label, updatedAt: entry.updatedAt
    }]);
    // Signed image URLs are deliberately memory-only and short-lived.
    return chrome.storage.local.set({ [CACHE + cache.slug]: {
      title: cache.title, titles: cache.titles, entries,
      misses: [...cache.misses], accessedAt: Date.now()
    } });
  });
  return cache.writes;
}

async function cacheFor(slug, title) {
  if (caches.has(slug)) return caches.get(slug);
  if (loading.has(slug)) return loading.get(slug);
  const pending = (async () => {
    const cache = { slug, title, titles: [], entries: new Map(), misses: new Map(), jobs: new Map(), readers: new Set() };
    const stored = await chrome.storage.local.get(CACHE + slug);
    const saved = stored[CACHE + slug];
    if (saved) {
      cache.title = title || saved.title || "";
      cache.titles = Array.isArray(saved.titles) ? saved.titles : [];
      for (const [id, entry] of saved.entries || []) {
        if (entry?.manga && Array.isArray(entry.chapters)) cache.entries.set(id, entry);
      }
      for (const [id, time] of saved.misses || []) cache.misses.set(id, time);
    }
    caches.set(slug, cache);
    return cache;
  })();
  loading.set(slug, pending);
  try { return await pending; } finally { loading.delete(slug); }
}

function searchQueries(title, titles) {
  const seen = new Set();
  return [title, ...(titles || [])].map((name) => String(name || "").replace(/\s+/g, " ").trim())
    .filter((name) => {
      const key = name.toLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);
}

async function learn(source, queries) {
  let failure = null;
  for (const query of queries) {
    try {
      const searched = await source.search(query);
      const ranked = (searched || []).map((manga) => ({
        manga, score: Math.max(...queries.map((name) => scoreManga(name, manga)))
      })).filter((row) => row.score >= MIN_SCORE).sort((a, b) => b.score - a.score);
      // A dead first result should not hide another equally plausible edition.
      for (const candidate of ranked.slice(0, 3)) {
        try {
          const manga = await source.details(candidate.manga);
          if (!manga || !Array.isArray(manga.chapters) || !manga.chapters.length) continue;
          return { manga, chapters: manga.chapters, label: source.label || source.id, updatedAt: Date.now() };
        } catch (error) { failure = error; }
      }
    } catch (error) { failure = error; }
  }
  // A partial network failure is not a definitive "no matching title".
  if (failure) throw failure;
  return null;
}

async function entryFor(cache, source) {
  const current = cache.entries.get(source.id);
  if (current && Date.now() - current.updatedAt < CHAPTER_TTL) return current;
  if (Date.now() - cache.misses.get(source.id) < MISS_TTL) return null;
  if (cache.jobs.has(source.id)) return cache.jobs.get(source.id);
  const job = (async () => {
    let entry;
    if (current) {
      const manga = await source.details(current.manga);
      if (!Array.isArray(manga?.chapters)) throw new Error("Invalid chapter list");
      entry = { manga, chapters: manga.chapters, label: current.label, updatedAt: Date.now() };
    } else entry = await learn(source, searchQueries(cache.title, cache.titles));
    if (entry) cache.entries.set(source.id, entry);
    else cache.misses.set(source.id, Date.now());
    await persist(cache).catch(() => {}); // Storage quota must not prevent reading.
    return entry;
  })();
  cache.jobs.set(source.id, job);
  try { return await job; } finally { cache.jobs.delete(source.id); }
}

async function publishEntry(source, entry, reader) {
  const rows = entry.chapters.filter((row) => sameChapter(reader.chapter, row.number));
  let failure = null;
  for (const row of rows) {
    if (!reader.active) return;
    try {
      const key = String(row.id);
      entry.pages ||= new Map();
      entry.inflight ||= new Map();
      let pages = entry.pages.get(key);
      if (!pages || Date.now() - pages.time >= PAGE_TTL) {
        if (!entry.inflight.has(key)) {
          const job = Promise.resolve().then(() => source.pages(row, entry.manga)).then((urls) => {
            const values = [...new Set((urls || []).filter((url) => {
              try { return typeof url === "string" && new URL(url).protocol === "https:"; } catch { return false; }
            }))];
            const result = { urls: values, time: Date.now() };
            if (values.length) entry.pages.set(key, result);
            return result;
          }).finally(() => entry.inflight.delete(key));
          entry.inflight.set(key, job);
        }
        pages = await entry.inflight.get(key);
      }
      if (!pages.urls.length) continue;
      if (!reader.active) return;
      const extra = row.scanlator || row.branch || "";
      const hit = {
        id: `${source.id}:${row.id}`, source: source.id, chapter: Number(row.number),
        label: extra ? `${entry.label} · ${extra}` : entry.label,
        referer: new URL("/", source.origin || entry.manga.publicUrl || entry.manga.url).href,
        pages: pages.urls
      };
      try { await noteReferer(hit, reader.tabId); } catch { /* Images may still load without a referer. */ }
      send(reader, { type: "hit", hit });
    } catch (error) { failure = error; }
  }
  if (failure) throw failure;
}

async function pool(items, limit, fn) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) await fn(items[cursor++]);
  }));
}

async function runReader(cache, reader) {
  send(reader, { type: "status", state: "searching" });
  const errors = [];
  await pool(sources, 4, async (source) => {
    if (!reader.active) return;
    try {
      const entry = await entryFor(cache, source);
      if (entry && reader.active) await publishEntry(source, entry, reader);
    } catch (error) { errors.push(`${source.label}: ${error.message || "Request failed"}`); }
  });
  send(reader, { type: "status", state: "done", errors });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "find") return;
  let reader = null;
  let cache = null;
  let disconnected = false;
  let generation = 0;
  const detach = () => {
    if (reader) { reader.active = false; cache?.readers.delete(reader); }
  };
  port.onDisconnect.addListener(() => { disconnected = true; generation += 1; detach(); });
  port.onMessage.addListener(async (message) => {
    const mine = ++generation;
    detach();
    try {
      if (!message || typeof message.slug !== "string" || !message.slug || !Number.isFinite(message.chapter)) return;
      const next = await cacheFor(message.slug, message.title || "");
      if (disconnected || mine !== generation) return;
      cache = next;
      const before = searchQueries(cache.title, cache.titles).join("\n");
      cache.title = message.title || cache.title;
      if (Array.isArray(message.titles)) cache.titles = message.titles;
      if (before !== searchQueries(cache.title, cache.titles).join("\n")) cache.misses.clear();
      reader = { port, chapter: message.chapter, tabId: port.sender?.tab?.id, active: true };
      const current = reader;
      cache.readers.add(current);
      if (message.refresh) {
        send(current, { type: "status", state: "searching" });
        await Promise.allSettled([...cache.jobs.values()]);
        if (!current.active) return;
        cache.entries.clear();
        cache.misses.clear();
        await persist(cache).catch(() => {});
      }
      if (current.active) await runReader(cache, current);
    } catch (error) {
      if (!disconnected && mine === generation) {
        try { port.postMessage({ type: "error", error: error.message || "Parser failed" }); } catch { /* Closed. */ }
      }
    }
  });
});

async function prune() {
  const saved = await chrome.storage.local.get(null);
  const active = new Set([...caches].filter(([, cache]) => cache.readers.size).map(([slug]) => CACHE + slug));
  const rows = Object.keys(saved).filter((key) => key.startsWith(CACHE))
    .sort((a, b) => (saved[b].accessedAt || 0) - (saved[a].accessedAt || 0));
  const remove = rows.slice(MAX_SERIES).filter((key) => !active.has(key));
  remove.push(...Object.keys(saved).filter((key) => key.startsWith("manga2:")));
  await chrome.storage.local.remove(remove);
  for (const [slug, cache] of caches) {
    if (!cache.readers.size && !cache.jobs.size) {
      await cache.writes?.catch(() => {});
      caches.delete(slug);
    }
  }
}

chrome.alarms.create("prune-panels", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "prune-panels") prune().catch(() => {});
});
// Remove the global image-header rules left by versions before 0.6.
chrome.declarativeNetRequest.getDynamicRules().then((rules) => {
  if (rules.length) return chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rules.map((rule) => rule.id) });
}).catch(() => {});
chrome.alarms.clear("stop-parser");

chrome.tabs.onRemoved.addListener((tabId) => {
  ruleQueue = ruleQueue.catch(() => {}).then(async () => {
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const ids = rules.filter((rule) => rule.condition.tabIds?.includes(tabId)).map((rule) => rule.id);
    if (ids.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
  }).catch(() => {});
});
