import test from "node:test";
import assert from "node:assert/strict";
import { mangadex } from "../parsers/mangadex.js";

test("MangaDex ignores unnumbered/external chapters and retains zero, decimals and groups", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ data: [
    { id: "null", attributes: { chapter: null, pages: 10 } },
    { id: "blank", attributes: { chapter: "", pages: 10 } },
    { id: "external", attributes: { chapter: "1", pages: 0 } },
    { id: "zero", attributes: { chapter: "0", pages: 10 } },
    { id: "decimal", attributes: { chapter: "1.5", pages: 10 }, relationships: [{ type: "scanlation_group", attributes: { name: "Group" } }] }
  ] }));
  const result = await mangadex.details({ id: "series", title: "Title" });
  assert.deepEqual(result.chapters.map((row) => row.number), [0, 1.5]);
  assert.equal(result.chapters[1].scanlator, "Group");
});

test("MangaDex data-saver fallback and incomplete page responses", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ baseUrl: "https://cdn.example", chapter: { hash: "hash", data: [], dataSaver: ["1.jpg"] } }));
  assert.deepEqual(await mangadex.pages({ id: "chapter" }), ["https://cdn.example/data-saver/hash/1.jpg"]);
  globalThis.fetch = async () => Response.json({ chapter: {} });
  assert.deepEqual(await mangadex.pages({ id: "chapter" }), []);
});

test("FlameComics rediscovers its Next.js build after a 404", async (t) => {
  const { flame } = await import("../parsers/flame.js?fixture");
  let homes = 0;
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requests.push(url);
    if (url === "https://flamecomics.xyz/") return new Response(`/_next/static/${++homes === 1 ? "old" : "new"}/_buildManifest.js`);
    if (url.includes("/old/")) return new Response("", { status: 404 });
    return Response.json({ pageProps: { series: [{ series_id: "1", title: "Berserk" }] } });
  });
  assert.equal((await flame.search("Berserk"))[0].id, "1");
  assert.equal(homes, 2);
  assert.ok(requests.some((url) => url.includes("/new/browse.json")));
});

test("Flame missing series share a build check and do not retry an unchanged build", async (t) => {
  const { flame } = await import("../parsers/flame.js?missing-series");
  let homes = 0;
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === "https://flamecomics.xyz/") {
      homes++;
      return new Response("/_next/static/current/_buildManifest.js");
    }
    paths.push(url);
    if (url.endsWith("browse.json")) return Response.json({ pageProps: { series: [] } });
    return new Response("", { status: 404 });
  });
  await flame.search("Berserk");
  const results = await Promise.allSettled([flame.details({ id: "missing-a" }), flame.details({ id: "missing-b" })]);
  assert.ok(results.every((result) => result.status === "rejected"));
  await assert.rejects(flame.details({ id: "missing-c" }), /HTTP 404/);
  assert.equal(homes, 2, "one initial discovery and one shared recheck");
  assert.equal(paths.filter((url) => url.includes("/series/")).length, 3, "one JSON request per missing series");
});
