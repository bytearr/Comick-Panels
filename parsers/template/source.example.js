// Copy this file to parsers/<id>.js, fill in the three methods, then register it
// in parsers/index.js. This copy is not imported, so it does not run.
//
// The background calls:
//   search(query)            -> [{ id, title, altTitles?, url }]
//   details(manga)           -> { ...manga, chapters: [{ id, number, title, url, scanlator? }] }
//   pages(chapter, manga)    -> ["https://..."] in reading order
//
// search runs with the ComicK series title. A score of 75 or higher on `title`
// or any `altTitles` entry is a hit. Return [] when the series is not on the site.
// Throw only when the request itself failed. A throw is retried. [] is remembered
// as a miss for that series.
//
// Chapter `number` is a finite float. 12.5 matches 12.5 only.
// `origin` is sent as the Referer on the page images.
// The service worker has no DOMParser. Read JSON, or pull fields out of HTML with
// a regex. fetch cannot set User-Agent.

import { getJson, getText } from "../http.js";

const ORIGIN = "https://example.com";

export const example = {
  id: "EXAMPLE",
  label: "Example",
  origin: ORIGIN,

  async search(query) {
    void query;
    void getJson;
    void getText;
    // const data = await getJson(`${ORIGIN}/search?q=${encodeURIComponent(query)}`);
    // return data.results.map((row) => ({
    //   id: row.id,
    //   title: row.title,
    //   altTitles: row.altTitles || [],
    //   url: `${ORIGIN}/series/${row.slug}`
    // }));
    return [];
  },

  async details(manga) {
    void manga;
    // const data = await getJson(manga.url);
    // return {
    //   id: manga.id,
    //   title: manga.title,
    //   altTitles: manga.altTitles,
    //   url: manga.url,
    //   publicUrl: manga.url,
    //   chapters: data.chapters.map((chapter) => ({
    //     id: chapter.id,
    //     number: Number(chapter.number),
    //     title: chapter.title || "",
    //     url: `${ORIGIN}/chapters/${chapter.id}`,
    //     scanlator: chapter.group || ""
    //   })).filter((chapter) => Number.isFinite(chapter.number))
    // };
    return { ...manga, chapters: [] };
  },

  async pages(chapter, manga) {
    void chapter;
    void manga;
    // const data = await getJson(chapter.url);
    // return data.images.filter((url) => url.startsWith("http"));
    return [];
  }
};
