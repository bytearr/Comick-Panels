import test from "node:test";
import assert from "node:assert/strict";
import { mangapill } from "../parsers/mangapill.js";
import { mangakatana } from "../parsers/mangakatana.js";
import { decodeHtml } from "../parsers/html.js";
import { mangadex } from "../parsers/mangadex.js";

test("MangaPill search skips covers and decodes titles; chapters preserve groups and decimals", async (t) => {
  const requests = [];
  const html = [
    `<a href="/manga/1/a"><img data-src="cover.jpg"></a>
     <a href='/manga/1/a'><div>A &amp; B &#34;C&#34;</div></a>
     <a href="https://other.example/manga/1/a">Wrong host</a>`,
    `<a href="/chapters/1-100/a">Chapter 0</a>
     <a href="/chapters/1-101/a">Chapter 12.5</a>
     <a href="/chapters/1-201/a">Group 2 Chapter 12.5</a>
     <a href="/chapters/1-201/a">Group 2 Chapter 12.5</a>
     <a href="/chapters/1-202/a">Special</a>
     <a href="/chapters/2-100/a">Chapter 1</a>`
  ];
  t.mock.method(globalThis, "fetch", async (url) => { requests.push(url); return new Response(html.shift()); });
  const results = await mangapill.search("A & B");
  assert.equal(new URL(requests[0]).searchParams.get("q"), "A & B");
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'A & B "C"');
  const result = await mangapill.details(results[0]);
  assert.deepEqual(result.chapters.map((c) => c.number), [0, 12.5, 12.5]);
  assert.equal(result.chapters[2].scanlator, "Group 2");
});

test("MangaPill reads full lazy images in document order without covers or placeholders", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(`
    <img src="https://cdn.example/cover.jpg">
    <img class="lazy js-page" src="https://cdn.example/tiny.gif" data-src="https://cdn.example/2.jpg?a=1&amp;b=2">
    <img class='js-page' src='//cdn.example/1.jpg'>
    <img class='js-page' src='//cdn.example/1.jpg'>
    <img class='js-page' data-src='javascript:alert(1)'>`));
  assert.deepEqual(await mangapill.pages({ url: "https://mangapill.com/chapters/1/a" }),
    ["https://cdn.example/2.jpg?a=1&b=2", "https://cdn.example/1.jpg"]);
});

test("MangaKatana scopes chapters to the selected series and ignores recommendations", async (t) => {
  const html = [
    `<h3 class="title"><a href="https://mangakatana.com/manga/a.1">A &amp; B</a><span>Update chapter 9</span></h3>`,
    `<a href="/manga/a.1/c0">Chapter 0</a><a href="/manga/a.1/c1.5">Chapter 1.5</a>
     <a href="/manga/a.1/c1.5">Chapter 1.5</a><a href="/manga/a.1/fc">First chapter</a>
     <a href="/manga/a.1/cspecial">Special</a><a href="/manga/b.2/c1">Chapter 1</a>`
  ];
  t.mock.method(globalThis, "fetch", async () => new Response(html.shift()));
  const [manga] = await mangakatana.search("A & B");
  assert.equal(manga.title, "A & B");
  assert.deepEqual((await mangakatana.details(manga)).chapters.map((c) => c.number), [0, 1.5]);
});

test("MangaKatana extracts the reader array, never ads or remote code", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response(String.raw`
    <script>var ytaw=['https://cdn.example/ad.jpg'];
    var thzq=['https:\/\/cdn.example/2.jpg',"https://cdn.example/1.jpg",'https://cdn.example/1.jpg','javascript:alert(1)',];
    throw new Error('must not execute');</script>`));
  assert.deepEqual(await mangakatana.pages({ url: "https://mangakatana.com/manga/a.1/c1" }),
    ["https://cdn.example/2.jpg", "https://cdn.example/1.jpg"]);
  globalThis.fetch = async () => new Response("<html>Site Unavailable</html>");
  await assert.rejects(mangakatana.pages({ url: "https://mangakatana.com/manga/a.1/c1" }), /image list missing/);
});

test("MangaDex prefers original pages when data-saver also exists", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ baseUrl: "https://cdn.example", chapter: {
    hash: "h", data: ["original.png"], dataSaver: ["compressed.jpg"]
  } }));
  assert.deepEqual(await mangadex.pages({ id: "c" }), ["https://cdn.example/data/h/original.png"]);
});

test("HTML entities are decoded once and invalid code points cannot crash discovery", () => {
  assert.equal(decodeHtml("&#x1F600; &apos; &amp;quot; &#99999999;"), "😀 ' &quot; &#99999999;");
});
