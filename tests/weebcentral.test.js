import test from "node:test";
import assert from "node:assert/strict";
import { weebcentral } from "../parsers/weebcentral.js";

test("Weeb Central search keeps series titles and drops other hosts", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(String(url));
    return new Response(`
      <a href="/series/01J76XYDMR2777KEM5BKTBBK83/A-B">
        <img alt="wrong cover">
        <div class="text-lg z-20">A &amp; B &#34;C&#34;</div>
      </a>
      <a href="https://evil.example/series/01J76XYDMR2777KEM5BKTBBK83/Nope"><div class="text-lg">Nope</div></a>
      <a href="/series/short/Nope"><div class="text-lg">Nope</div></a>`);
  });
  const results = await weebcentral.search("A & B");
  assert.equal(new URL(requests[0]).searchParams.get("text"), "A & B");
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'A & B "C"');
  assert.equal(results[0].id, "01J76XYDMR2777KEM5BKTBBK83");
});

test("Weeb Central chapters keep zero, decimals, and the official badge", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(`
    <a href="/chapters/01J76XZ10DCBD20MT6SYJWYBGG">
      <img src="/static/images/chapter-badge-official.svg"><span>Chapter 0</span>
    </a>
    <a href="/chapters/01J76XZ4ACY0H1WS90C7Z6AD30"><span>Chapter 12.5</span></a>
    <a href="/chapters/01J76XZ4ACY0H1WS90C7Z6AD30"><span>Chapter 12.5</span></a>
    <a href="/chapters/01J76XZ4ACZDBCWBAK7446DJC5"><span>Extra</span></a>
    <a href="https://evil.example/chapters/01J76XZ4AAAA"><span>Chapter 3</span></a>`));
  const result = await weebcentral.details({ id: "01J76XYDMR2777KEM5BKTBBK83", url: "https://weebcentral.com/series/01J76XYDMR2777KEM5BKTBBK83/A" });
  assert.deepEqual(result.chapters.map((chapter) => [chapter.number, chapter.scanlator]), [
    [0, "Official"],
    [12.5, ""]
  ]);
});

test("Weeb Central reads reader images in order and skips logos", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(String(url));
    return new Response(`
      <img src="/static/images/brand.png">
      <img src="https://official.lowee.us/manga/A/0124-002.png?a=1&amp;b=2">
      <img src="https://official.lowee.us/manga/A/0124-001.png">
      <img src="https://official.lowee.us/manga/A/0124-001.png">
      <img src="javascript:alert(1)">`);
  });
  assert.deepEqual(await weebcentral.pages({ id: "01J76XZ4ACY0H1WS90C7Z6AD30" }), [
    "https://official.lowee.us/manga/A/0124-002.png?a=1&b=2",
    "https://official.lowee.us/manga/A/0124-001.png"
  ]);
  assert.match(requests[0], /\/chapters\/01J76XZ4ACY0H1WS90C7Z6AD30\/images\?is_prev=False$/);
});
