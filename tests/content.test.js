import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { chapterFromPath } from "../match.js";

const script = await readFile(new URL("../content.js", import.meta.url), "utf8");
// Small DOM fixture for the reader's actual script (no extracted/reimplemented
// navigation logic). Real Chrome layout/network testing remains manual.
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ""; this.textContent = ""; }
  get parentElement() { return this.parent; }
  get isConnected() { return !!this.parent; }
  get options() { return this.children; }
  append(...nodes) { nodes.forEach((node) => this.appendChild(node)); }
  appendChild(node) { node.parent = this; this.children.push(node); return node; }
  prepend(node) { node.parent = this; this.children.unshift(node); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  replaceChildren(...nodes) { this.children.forEach((child) => { child.parent = null; }); this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  emit(type) { for (const fn of this.listeners[type] || []) fn(); }
  querySelector(selector) {
    const matches = (node) => selector.startsWith(".") ? node.className === selector.slice(1) : node.tagName === selector;
    for (const child of this.children) { if (matches(child)) return child; const nested = child.querySelector(selector); if (nested) return nested; }
    return null;
  }
}
function event() { const listeners = []; return { addListener(fn) { listeners.push(fn); }, emit(value) { listeners.forEach((fn) => fn(value)); } }; }
function setup() {
  let parent = new Element("main");
  const ports = [], timers = [], requests = [];
  const location = { origin: "https://comick.dev", pathname: "/comic/alpha/id-chapter-1-en" };
  const document = {
    title: "Ch. 1 - Alpha - ComicK",
    createElement: (tag) => new Element(tag),
    getElementById: (id) => id === "images-reader-container" ? parent : null,
    querySelector: () => null, querySelectorAll: () => []
  };
  const memory = new Map();
  const context = vm.createContext({
    chrome: { runtime: { id: "test-extension", connect() {
      const port = { onMessage: event(), onDisconnect: event(), postMessage(message) { requests.push(message); }, disconnect() { this.onDisconnect.emit(); } };
      ports.push(port); return port;
    } } }, document, location, URL, AbortSignal, Date,
    sessionStorage: { getItem: (key) => memory.get(key), setItem: (key, value) => memory.set(key, value) },
    fetch: async () => ({ ok: false }), setInterval: (fn) => timers.push(fn)
  });
  vm.runInContext(script, context);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return { context, ports, requests, location, document, settle,
    tick() { timers[0](); }, root: () => parent.children[0],
    remount() { parent = new Element("main"); timers[0](); },
    hit(index, id = "SOURCE:a", source = "SOURCE", pages = ["https://images.example/page.jpg"]) {
      ports[index].onMessage.emit({ type: "hit", hit: { id, source, chapter: 1, label: id, pages } });
    }
  };
}

test("switching series at the same chapter number starts a new request and ignores old hits", async () => {
  const app = setup();
  await app.settle();
  app.hit(0);
  app.location.pathname = "/comic/beta/id-chapter-1-en";
  app.document.title = "Ch. 1 - Beta - ComicK";
  app.tick(); await app.settle();
  assert.equal(app.requests.length, 2);
  assert.equal(app.requests[1].slug, "beta");
  app.hit(0, "STALE:a");
  assert.equal(app.root().querySelector("select").options.length, 0);
  app.hit(1, "FRESH:a");
  assert.equal(app.root().querySelector("select").value, "FRESH:a");
});

test("back navigation from a series page and a replaced reader both recover", async () => {
  const app = setup(); await app.settle(); app.hit(0);
  app.remount();
  assert.equal(app.root().querySelector("select").value, "SOURCE:a");
  assert.ok(app.root().querySelector("img"));
  assert.equal(app.requests.length, 1);
  app.location.pathname = "/comic/alpha"; app.tick();
  assert.equal(app.root(), undefined);
  app.location.pathname = "/comic/alpha/id-chapter-1-en"; app.tick(); await app.settle();
  assert.equal(app.requests.length, 2);
});

test("new groups do not replace a selected release, and refresh sends an invalidation request", async () => {
  const app = setup(); await app.settle(); app.hit(0);
  app.hit(0, "SOURCE:b");
  const select = app.root().querySelector("select");
  assert.equal(select.value, "SOURCE:a");
  select.value = "SOURCE:b"; select.emit("change");
  app.hit(0, "OTHER:c", "OTHER");
  assert.equal(select.value, "SOURCE:b");
  app.root().querySelector(".vash-refresh").emit("click");
  assert.equal(app.requests.at(-1).refresh, true);
  assert.equal(select.disabled, true);
  app.hit(1, "SOURCE:new");
  assert.equal(select.value, "SOURCE:new");
});

test("a disconnected worker exposes reconnect feedback and image errors expose retries", async () => {
  const app = setup(); await app.settle(); app.hit(0);
  const image = app.root().querySelector("img");
  assert.equal(image.alt, "Chapter 1, page 1");
  image.emit("error");
  assert.ok(app.root().querySelector(".vash-retry"));
  app.root().querySelector(".vash-retry").emit("click");
  assert.equal(app.root().querySelector(".vash-retry"), null);
  app.ports[0].onDisconnect.emit();
  assert.match(app.root().querySelector(".vash-status").textContent, /reconnect/);
});

test("content and background agree on decimal chapter URL parsing", () => {
  const app = setup();
  for (const path of ["/comic/a/id-chapter-12.5-en", "/comic/a/id-chapter-12-5-en", "/comic/a/id-chapter-0-en", "/comic/a/id-chapter-12oops-en"]) {
    app.context.input = path;
    assert.equal(vm.runInContext("chapterFromPath(input)", app.context), chapterFromPath(path));
  }
});
