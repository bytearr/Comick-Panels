import test from "node:test";
import assert from "node:assert/strict";
import { chapterFromPath, sameChapter, scoreTitle, scoreManga } from "../match.js";

test("chapter URLs preserve decimals, zero, and reject malformed suffixes", () => {
  for (const [path, expected] of [
    ["/comic/a/id-chapter-12-en", 12], ["/comic/a/id-chapter-12-5-en", 12.5],
    ["/comic/a/id-chapter-12.5-en", 12.5], ["/comic/a/id-chapter-0-en", 0],
    ["/comic/a/id-chapter-12.05", 12.05], ["/comic/a/id-chapter-12.5junk-en", null],
    ["/comic/chapter-99/id-chapter-2-en", 2],
    ["/comic/a", null], ["/comic/a/id-chapter-special-en", null]
  ]) assert.equal(chapterFromPath(path), expected, path);
});

test("unnumbered chapters never become chapter zero", () => {
  for (const value of [null, undefined, "", " ", "special"]) assert.equal(sameChapter(0, value), false);
  assert.equal(sameChapter(0, "0"), true);
  assert.equal(sameChapter(12.5, "12.50"), true);
  assert.equal(sameChapter(12, "12.5"), false);
});

test("title scores retain exact short and international titles", () => {
  assert.equal(scoreTitle("86", "86"), 100);
  assert.equal(scoreTitle("Berserk", "BERSERK"), 100);
  assert.equal(scoreTitle("Café", "Cafe"), 100);
  assert.equal(scoreTitle("進撃の巨人", "進撃の巨人"), 100);
  assert.equal(scoreTitle("進撃の巨人", "別の漫画"), 0);
  assert.equal(scoreTitle("My Hero", "My Heroes"), 0);
  assert.equal(scoreManga("Berserk", { title: "Other", altTitles: ["Berserk"] }), 99);
});
