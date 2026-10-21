import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { MIN_SCORE, sameChapter, scoreManga } from "../match.js";

const sourceText = await readFile(new URL("../background.js", import.meta.url), "utf8");
const stripImports = (source) => source.replace(/^import .*;\r?\n/gm, "");
const script = stripImports(sourceText);
function event() {
  const listeners = [];
  return { addListener(fn) { listeners.push(fn); }, async emit(...args) { await Promise.all(listeners.map((fn) => fn(...args))); } };
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function setup(overrides = {}) {
  let now = 1000000;
  const stored = {};
  const calls = { search: 0, details: 0, pages: 0, reads: 0 };
  let rules = [];
  const source = {
    id: "TEST", label: "Test", origin: "https://source.example",
    async search(query) { calls.search++; return [{ id: "series", title: query }]; },
    async details(manga) { calls.details++; return { ...manga, chapters: [{ id: "ch1", number: "1" }] }; },
    async pages() { calls.pages++; return ["https://images.example/1.jpg"]; },
    ...overrides
  };
  const chrome = {
    runtime: { onConnect: event() },
    storage: { local: {
      async get(key) { calls.reads++; await Promise.resolve(); return key == null ? structuredClone(stored) : { [key]: structuredClone(stored[key]) }; },
      async set(data) { Object.assign(stored, structuredClone(data)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key]; }
    } },
    declarativeNetRequest: {
      async getSessionRules() { return structuredClone(rules); },
      async updateSessionRules({ removeRuleIds = [], addRules = [] }) {
        rules = [...rules.filter((rule) => !removeRuleIds.includes(rule.id)), ...addRules];
        assert.equal(new Set(rules.map((rule) => rule.id)).size, rules.length);
      },
      async getDynamicRules() { return []; }, async updateDynamicRules() {}
    },
    alarms: { create() {}, clear() {}, onAlarm: event() },
    tabs: { onRemoved: event() }
  };
  const context = vm.createContext({ chrome, sources: [source], MIN_SCORE, sameChapter, scoreManga, URL,
    Date: class extends Date { static now() { return now; } } });
  vm.runInContext(script, context);
  function reader(tabId = 1) {
    const messages = [];
    const port = { name: "find", sender: { tab: { id: tabId } }, onMessage: event(), onDisconnect: event(), postMessage(message) { messages.push(message); } };
    chrome.runtime.onConnect.emit(port);
    return {
      messages, disconnect: () => port.onDisconnect.emit(),
      run: (extra = {}) => port.onMessage.emit({ slug: "series", title: "A Series", chapter: 1, ...extra }),
      hits: () => messages.filter((message) => message.type === "hit")
    };
  }
  return { context, reader, calls, source, stored, chrome, rules: () => rules, advance: (ms) => { now += ms; } };
}

test("two simultaneous tabs share discovery and pages and retain both referer rules", async () => {
  const app = setup();
  const a = app.reader(1), b = app.reader(2);
  await Promise.all([a.run(), b.run()]);
  assert.equal(app.calls.reads, 1);
  assert.equal(app.calls.search, 1);
  assert.equal(app.calls.pages, 1);
  assert.equal(a.hits().length, 1);
  assert.equal(b.hits().length, 1);
  assert.equal(app.rules().length, 2);
  assert.ok(app.rules().every((rule) => rule.condition.tabIds.length === 1));
  assert.equal(JSON.stringify(app.stored).includes("1.jpg"), false);
});

test("page URLs and chapter lists expire independently; refresh rediscovers", async () => {
  const app = setup();
  const a = app.reader();
  await a.run();
  app.advance(6 * 60 * 1000);
  await a.run();
  assert.equal(app.calls.pages, 2);
  assert.equal(app.calls.details, 1);
  app.advance(10 * 60 * 1000);
  await a.run();
  assert.equal(app.calls.details, 2);
  await a.run({ refresh: true });
  assert.equal(app.calls.search, 2);
  assert.equal(app.calls.pages, 4);
});

test("empty page responses are retried, not cached", async () => {
  let count = 0;
  const app = setup({ async pages() { return ++count === 1 ? [] : ["https://img.example/page.jpg"]; } });
  const a = app.reader();
  await a.run();
  assert.equal(a.hits().length, 0);
  await a.run();
  assert.equal(a.hits().length, 1);
});

test("disconnect during discovery prevents late page requests and messages", async () => {
  const gate = deferred(), entered = deferred();
  const app = setup({ async search(query) { entered.resolve(); await gate.promise; return [{ title: query }]; } });
  const a = app.reader();
  const run = a.run();
  await entered.promise;
  await a.disconnect();
  const count = a.messages.length;
  gate.resolve();
  await run;
  assert.equal(app.calls.pages, 0);
  assert.equal(a.messages.length, count);
});

test("network errors are reported and never remembered as definitive misses", async () => {
  let attempts = 0;
  const app = setup({ async search(query) {
    if (++attempts === 1) throw new Error("offline");
    return [{ title: query }];
  } });
  const a = app.reader();
  await a.run();
  assert.match(a.messages.at(-1).errors[0], /offline/);
  await a.run();
  assert.equal(a.hits().length, 1);
});

test("a short exact alternate title is accepted alongside a long title", async () => {
  const app = setup({ async search() { return [{ title: "86" }]; } });
  const a = app.reader();
  await a.run({ title: "A Very Long Translated Title", titles: ["86"] });
  assert.equal(a.hits().length, 1);
});

test("one broken scanlation does not suppress other releases", async () => {
  const app = setup({
    async details(manga) { return { ...manga, chapters: [{ id: "bad", number: 1 }, { id: "good", number: 1 }] }; },
    async pages(chapter) { if (chapter.id === "bad") throw new Error("broken release"); return ["https://img.example/ok.jpg"]; }
  });
  const a = app.reader();
  await a.run();
  assert.equal(a.hits().length, 1);
  assert.equal(a.hits()[0].hit.id, "TEST:good");
  assert.match(a.messages.at(-1).errors[0], /broken release/);
});

test("misses expire and refresh clears them immediately", async () => {
  let attempts = 0;
  const app = setup({ async search() { attempts++; return []; } });
  const a = app.reader();
  await a.run(); await a.run();
  assert.equal(attempts, 1);
  app.advance(11 * 60 * 1000);
  await a.run();
  assert.equal(attempts, 2);
  await a.run({ refresh: true });
  assert.equal(attempts, 3);
});

test("an alternate title cannot hijack results for the primary query", async () => {
  const queries = [], details = [];
  const app = setup({
    async search(query) {
      queries.push(query);
      return [{ id: "wrong", title: "86" }, { id: "right", title: "A Very Long Translated Title" }];
    },
    async details(manga) { details.push(manga.id); return { ...manga, chapters: [{ id: "ch1", number: 1 }] }; }
  });
  await app.reader().run({ title: "A Very Long Translated Title", titles: ["86"] });
  assert.deepEqual(queries, ["A Very Long Translated Title"]);
  assert.deepEqual(details, ["right"]);
});

test("short-title fallback is only accepted when that query is searched", async () => {
  const queries = [];
  const app = setup({ async search(query) { queries.push(query); return [{ title: "86" }]; } });
  const a = app.reader();
  await a.run({ title: "A Very Long Translated Title", titles: ["86"] });
  assert.deepEqual(queries, ["A Very Long Translated Title", "86"]);
  assert.equal(a.hits().length, 1);
});

test("an empty TTL refresh keeps persisted metadata and retries on the next request", async () => {
  const app = setup();
  const a = app.reader();
  await a.run();
  const previous = structuredClone(app.stored);
  app.advance(16 * 60 * 1000);
  let attempts = 0;
  app.source.details = async (manga) => {
    attempts++;
    return { ...manga, chapters: attempts === 1 ? [] : [{ id: "ch1", number: 1 }] };
  };
  await a.run();
  assert.deepEqual(app.stored, previous);
  assert.match(a.messages.at(-1).errors[0], /chapter list/i);
  await a.run();
  assert.equal(attempts, 2);
  assert.equal(a.hits().length, 2);
});

test("prune retains a cache if a reader attaches while a write is pending", async () => {
  const app = setup();
  const a = app.reader();
  await a.run(); await a.disconnect();
  const gate = deferred(), entered = deferred();
  app.context.pendingWrite = { catch() { entered.resolve(); return gate.promise; } };
  vm.runInContext('caches.get("series").writes = pendingWrite', app.context);
  const pruning = vm.runInContext("prune()", app.context);
  await entered.promise;
  await app.reader(2).run();
  gate.resolve(); await pruning;
  const reads = app.calls.reads;
  await app.reader(3).run();
  assert.equal(app.calls.reads, reads);
  assert.equal(app.calls.pages, 1);
});

test("the background test harness accepts CRLF source", () => {
  const crlf = sourceText.replace(/\r?\n/g, "\r\n");
  assert.doesNotThrow(() => new vm.Script(stripImports(crlf)));
});
