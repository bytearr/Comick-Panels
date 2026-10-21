const ROOT_ID = "vash-panels";

function chapterFromPath(pathname) {
  const segment = String(pathname || "").split(/[?#]/)[0].split("/").filter(Boolean).at(-1) || "";
  const match = segment.match(/(?:^|-)chapter-(\d+(?:[.-]\d+)?)(?=-[a-z]{2}(?:$|[/?#])|$|[/?#])/i);
  return match ? Number(match[1].replace("-", ".")) : null;
}

function slugFromPath(pathname) {
  const parts = String(pathname || "").split("/").filter(Boolean);
  const index = parts.indexOf("comic");
  try { return index >= 0 ? decodeURIComponent(parts[index + 1] || "") : ""; } catch { return ""; }
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

const PREFER_KEY = "vash-host-source";
const titleCache = new Map();
let route = null;
let generation = 0;
let port = null;
let root = null;
let hits = new Map();
let selected = "";
let chosen = false;
let state = "idle";
let statusText = "";
let started = 0;
let request = null;

function preferredSource() {
  try { return sessionStorage.getItem(PREFER_KEY) || ""; } catch { return ""; }
}

function paint(hit) {
  if (!root || !hit) return;
  selected = hit.id;
  root.querySelector("select").value = selected;
  const stack = root.querySelector(".vash-pages");
  stack.replaceChildren();
  hit.pages.forEach((url, index) => {
    const figure = document.createElement("div");
    const img = document.createElement("img");
    img.alt = `Chapter ${hit.chapter}, page ${index + 1}`;
    img.loading = index < 2 ? "eager" : "lazy";
    img.decoding = "async";
    img.addEventListener("error", () => {
      if (!figure.isConnected || figure.querySelector("button")) return;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "vash-retry";
      retry.textContent = `Page ${index + 1} failed — retry image`;
      retry.addEventListener("click", () => {
        retry.remove();
        img.removeAttribute("src");
        img.src = url;
      });
      figure.appendChild(retry);
      setStatus("Some pages failed. Retry the image, refresh sources, or choose another source.");
    });
    img.src = url;
    figure.appendChild(img);
    stack.appendChild(figure);
  });
}

function setStatus(text) {
  statusText = text;
  const status = root?.querySelector(".vash-status");
  if (status) status.textContent = text;
}

function ensureShell() {
  const parent = readerRoot();
  if (!parent) return null;
  if (root?.parentElement === parent) return root;
  root?.remove();
  root = document.createElement("section");
  root.id = ROOT_ID;
  root.setAttribute("aria-label", "ComicK alternate panels");
  const toolbar = document.createElement("div");
  toolbar.className = "vash-toolbar";
  const select = document.createElement("select");
  select.className = "vash-hoster";
  select.setAttribute("aria-label", "Panel source");
  select.disabled = !hits.size;
  select.addEventListener("change", () => {
    const hit = hits.get(select.value);
    if (!hit) return;
    chosen = true;
    try { sessionStorage.setItem(PREFER_KEY, hit.source); } catch { /* Private mode. */ }
    paint(hit);
  });
  const refresh = document.createElement("button");
  refresh.type = "button";
  refresh.className = "vash-refresh";
  refresh.textContent = "Refresh sources";
  refresh.addEventListener("click", () => {
    if (request) connect(true);
    else { route = null; tick(); }
  });
  const status = document.createElement("div");
  status.className = "vash-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = statusText;
  const pages = document.createElement("div");
  pages.className = "vash-pages";
  toolbar.append(select, refresh);
  root.append(toolbar, status, pages);
  parent.prepend(root);
  for (const hit of hits.values()) addOption(hit);
  if (selected) paint(hits.get(selected));
  return root;
}

function addOption(hit) {
  if (!root) return;
  const select = root.querySelector("select");
  let option = [...select.options].find((item) => item.value === hit.id);
  if (!option) {
    option = document.createElement("option");
    option.value = hit.id;
    select.appendChild(option);
  }
  option.textContent = `${hit.label} (${hit.pages.length} pages)`;
  select.disabled = false;
  if (selected) select.value = selected;
}

function addHit(hit) {
  if (!hit || !Array.isArray(hit.pages) || !hit.pages.length || hit.chapter !== request?.chapter) return;
  const previous = hits.get(hit.id);
  hits.set(hit.id, hit);
  ensureShell();
  addOption(hit);
  const current = hits.get(selected);
  // Preserve a deliberate choice and don't jump between scanlation groups
  // merely because another result from the same provider arrived later.
  if (!selected || (!chosen && hit.source === preferredSource() && current?.source !== hit.source)) paint(hit);
  else if (selected === hit.id && previous && previous.pages.join("\n") !== hit.pages.join("\n")) paint(hit);
}

function alive() {
  return !!(chrome.runtime && chrome.runtime.id);
}

function connect(refresh = false) {
  if (!request || !alive()) return;
  const mine = ++generation;
  port?.disconnect();
  port = null;
  state = "searching";
  // Keep current pages visible until replacements arrive during a refresh.
  if (refresh) {
    hits = new Map();
    selected = "";
    chosen = false;
    root?.querySelector("select").replaceChildren();
    if (root) root.querySelector("select").disabled = true;
  }
  setStatus("Searching sources…");
  try {
    const current = chrome.runtime.connect({ name: "find" });
    port = current;
    current.onMessage.addListener((message) => {
      if (mine !== generation || route !== location.pathname || !message) return;
      if (message.type === "hit") addHit(message.hit);
      if (message.type === "error") { state = "done"; setStatus(message.error); }
      if (message.type === "status" && message.state === "done") {
        state = "done";
        if (!hits.size) root?.querySelector(".vash-pages").replaceChildren();
        const errors = Array.isArray(message.errors) ? message.errors : [];
        const summary = hits.size ? `${hits.size} chapter version${hits.size === 1 ? "" : "s"} available.` : "No matching chapter found. Try refreshing sources.";
        setStatus(summary + (errors.length ? ` ${errors.length} source${errors.length === 1 ? "" : "s"} failed: ${errors.join("; ")}` : ""));
      }
    });
    current.onDisconnect.addListener(() => {
      // Reading lastError prevents an unchecked runtime error on worker restart.
      const error = chrome.runtime.lastError;
      if (mine !== generation) return;
      port = null;
      state = "done";
      setStatus(error ? "Extension connection lost. Refresh sources or reload the tab." : "Source connection closed. Refresh sources to reconnect.");
    });
    current.postMessage({ ...request, refresh });
  } catch {
    state = "done";
    setStatus("Extension was reloaded. Reload this tab to reconnect.");
  }
}

async function prepare(mine, slug, chapter, title) {
  let titles = titleCache.get(slug);
  if (!titles) {
    titles = await seriesTitles(slug);
    if (titles.length) {
      titleCache.set(slug, titles);
      if (titleCache.size > 30) titleCache.delete(titleCache.keys().next().value);
    }
  }
  if (mine !== generation || route !== location.pathname) return;
  request = { slug, chapter, title, titles };
  connect();
}

function tick() {
  if (!alive()) return;
  const pathname = location.pathname;
  if (route !== pathname) {
    route = pathname;
    generation += 1;
    port?.disconnect();
    port = null;
    root?.remove();
    root = null;
    hits = new Map();
    selected = "";
    chosen = false;
    request = null;
    state = "waiting";
    statusText = "Preparing sources…";
    started = Date.now();
  }
  const chapter = chapterFromPath(pathname);
  const slug = slugFromPath(pathname);
  if (chapter == null || !slug) return;
  if (!ensureShell()) return;
  if (state !== "waiting") return;
  const title = pageTitle();
  const button = [...document.querySelectorAll("button")].find((el) => /^Ch\s*\d/i.test((el.innerText || "").trim()));
  const visible = button?.innerText.match(/(\d+(?:\.\d+)?)/);
  if (!title || (visible && Number(visible[1]) !== chapter && Date.now() - started < 2000)) return;
  state = "preparing";
  prepare(generation, slug, chapter, title).catch(() => {
    state = "done";
    setStatus("Could not prepare sources. Refresh sources to retry.");
  });
}

setInterval(tick, 400);
tick();
