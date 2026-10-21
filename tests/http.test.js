import test from "node:test";
import assert from "node:assert/strict";
import { getJson, getText } from "../parsers/http.js";

test("source requests have a timeout, omit cookies, and parse the expected body", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(options);
    return new Response(String(url).endsWith("json") ? '{"ok":true}' : "<html>ok</html>");
  });
  assert.deepEqual(await getJson("https://example.com/json"), { ok: true });
  assert.equal(await getText("https://example.com/html"), "<html>ok</html>");
  for (const options of calls) {
    assert.equal(options.credentials, "omit");
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test("HTTP and malformed JSON errors remain visible to callers", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("", { status: 429 }));
  await assert.rejects(getJson("https://example.com/"), /HTTP 429/);
  globalThis.fetch = async () => new Response("not JSON");
  await assert.rejects(getJson("https://example.com/"), SyntaxError);
});
