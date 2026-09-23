const ROOT_ID = "vash-panels";

function chapterFromPath(pathname) {
  const raw = String(pathname || "");
  const at = raw.toLowerCase().lastIndexOf("chapter-");
  if (at < 0) return null;
  const segs = raw.slice(at + "chapter-".length).split(/[/?#]/)[0].split("-").filter(Boolean);
  if (!/^\d+$/.test(segs[0] || "")) return null;
  if (/^\d+$/.test(segs[1] || "") && (!segs[2] || /^[a-z]{2}$/i.test(segs[2]))) {
    return Number(`${segs[0]}.${segs[1]}`);
  }
  return Number(segs[0]);
}

function slugFromPath(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const index = parts.indexOf("comic");
  return index >= 0 ? decodeURIComponent(parts[index + 1] || "") : "";
}

function pageTitle() {
  const heading = document.querySelector("h1");
  const fromHeading = heading && heading.textContent.trim();
  const match = document.title.match(/^Ch\.\s*[0-9.]+(?:\s*\([^)]+\))?\s*-\s*(.+?)\s+-\s+/i);
  return (match && match[1].trim()) || fromHeading || "";
}

function plain(html) {
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

async function seriesTitles(slug) {
  try {
    const response = await fetch(`${location.origin}/comic/${encodeURIComponent(slug)}`, {
      credentials: "same-origin",
      headers: { accept: "text/html" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) return [];
    const html = await response.text();
    const names = [];
    const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/);
    if (h1) names.push(plain(h1[1]));
    const h2 = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>\s*<h2\b[^>]*>([\s\S]*?)<\/h2>/);
    if (h2) names.push(plain(h2[1]));
    for (const match of html.matchAll(/data-title-text="true">([^<]*)/g)) names.push(plain(match[1]));
    return names.filter(Boolean);
  } catch {
    return [];
  }
}

function readerRoot() {
  return document.getElementById("images-reader-container");
}

function clearRoot() {
  const node = document.getElementById(ROOT_ID);
  if (node) node.remove();
}

function paint(root, hit) {
  const stack = root.querySelector(".vash-pages");
  stack.replaceChildren();
  for (const url of hit.pages) {
    const img = document.createElement("img");
    img.alt = "";
    img.src = url;
    stack.appendChild(img);
  }
}

function ensureShell() {
  const existing = document.getElementById(ROOT_ID);
  if (existing && !existing.querySelector("select")) existing.remove();
  const parent = readerRoot();
  if (!parent) return null;
  const current = document.getElementById(ROOT_ID);
  if (current) return current;
  const root = document.createElement("div");
  root.id = ROOT_ID;
  const select = document.createElement("select");
  select.className = "vash-hoster";
  const sample = parent.querySelector("button");
  if (sample) {
    const style = getComputedStyle(sample);
    select.style.background = style.backgroundColor;
    select.style.color = style.color;
    select.style.border = style.border;
    select.style.borderRadius = style.borderRadius;
    select.style.font = style.font;
  }
  const pages = document.createElement("div");
  pages.className = "vash-pages";
  root.append(select, pages);
  root._hits = new Map();
  select.addEventListener("change", () => {
    const hit = root._hits.get(select.value);
    if (!hit) return;
    preferSource(hit.source || String(hit.id).split(":")[0]);
    paint(root, hit);
  });
  parent.prepend(root);
  return root;
}

const PREFER_KEY = "vash-host-source";

function preferredSource() {
  try { return sessionStorage.getItem(PREFER_KEY) || ""; } catch { return ""; }
}

function preferSource(source) {
  try { sessionStorage.setItem(PREFER_KEY, source); } catch { /* private mode */ }
}

function sameNumber(left, right) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.001;
}

function uiChapter() {
  const button = [...document.querySelectorAll("button")].find((el) => /^Ch\s*\d/i.test((el.innerText || "").trim()));
  if (!button) return null;
  const match = button.innerText.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function addHit(hit) {
  const live = chapterFromPath(location.pathname);
  if (!sameNumber(hit.chapter, live)) return;
  const root = ensureShell();
  if (!root) return;
  const select = root.querySelector("select");
  root._hits.set(hit.id, hit);
  let option = [...select.options].find((item) => item.value === hit.id);
  if (!option) {
    option = document.createElement("option");
    option.value = hit.id;
    select.appendChild(option);
  }
  option.textContent = hit.label;
  const source = hit.source || String(hit.id).split(":")[0];
  const want = preferredSource();
  const showing = root.querySelector(".vash-pages img");
  if (!want || source === want || !showing) {
    if (!want) preferSource(source);
    select.value = hit.id;
    paint(root, hit);
  }
}

function showError(text) {
  if (document.querySelector("#vash-panels select")) return;
  const parent = readerRoot();
  if (!parent) return;
  clearRoot();
  const root = document.createElement("div");
  root.id = ROOT_ID;
  const note = document.createElement("div");
  note.className = "vash-hoster";
  note.textContent = text;
  root.appendChild(note);
  parent.prepend(root);
}

let token = 0;
let port = null;
let requested = null;
let waitingFor = null;

function alive() {
  return !!(chrome.runtime && chrome.runtime.id);
}

function schedule() {
  if (!alive()) return;
  const chapterNow = chapterFromPath(location.pathname);
  if (sameNumber(chapterNow, waitingFor)) return;
  waitingFor = chapterNow;
  clearRoot();
  if (port) {
    port.disconnect();
    port = null;
  }
  const mine = ++token;
  const started = Date.now();
  const timer = setInterval(async () => {
    if (mine !== token) {
      clearInterval(timer);
      return;
    }
    const chapter = chapterFromPath(location.pathname);
    const visible = uiChapter();
    const title = pageTitle();
    const slug = slugFromPath(location.pathname);
    const settled = visible == null || sameNumber(visible, chapter) || Date.now() - started > 2000;
    if (chapter == null || !slug || !title || !readerRoot() || !settled) {
      if (Date.now() - started > 15000) {
        clearInterval(timer);
        waitingFor = null;
      }
      return;
    }
    clearInterval(timer);
    waitingFor = chapter;
    requested = chapter;
    const titles = await seriesTitles(slug);
    if (mine !== token) return;
    port = chrome.runtime.connect({ name: "find" });
    port.onMessage.addListener((message) => {
      if (mine !== token || !message) return;
      if (message.type === "hit") addHit(message.hit);
      if (message.type === "error") showError(message.error);
    });
    port.postMessage({ slug, title, titles, chapter });
  }, 300);
}

setInterval(() => {
  if (!alive()) return;
  const chapter = chapterFromPath(location.pathname);
  if (chapter == null || sameNumber(chapter, requested) || sameNumber(chapter, waitingFor)) return;
  schedule();
}, 400);

schedule();
