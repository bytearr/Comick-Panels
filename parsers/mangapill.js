import { getText } from "./http.js";
import { attributes, httpsUrl, links } from "./html.js";

const ORIGIN = "https://mangapill.com";

export const mangapill = {
  id: "MANGAPILL",
  label: "MangaPill",
  origin: ORIGIN,

  async search(query) {
    const html = await getText(`${ORIGIN}/search?q=${encodeURIComponent(query)}`);
    const found = new Map();
    for (const link of links(html)) {
      const url = httpsUrl(link.href, ORIGIN);
      if (!url || new URL(url).origin !== ORIGIN || !/^\/manga\/\d+\//.test(new URL(url).pathname) || !link.text) continue;
      found.set(url, { id: url, title: link.text, url });
    }
    return [...found.values()];
  },

  async details(manga) {
    const html = await getText(manga.url);
    const chapters = new Map();
    const seriesId = new URL(manga.url).pathname.split("/")[2];
    for (const link of links(html)) {
      const url = httpsUrl(link.href, ORIGIN);
      if (!url || new URL(url).origin !== ORIGIN || !new URL(url).pathname.startsWith(`/chapters/${seriesId}-`)) continue;
      const match = link.text.match(/\bChapter\s+(\d+(?:\.\d+)?)(?=\s|:|$)/i);
      if (!match) continue;
      const group = link.text.match(/\bGroup\s+\d+/i);
      chapters.set(url, { id: url, url, number: Number(match[1]), title: link.text, scanlator: group?.[0] || "" });
    }
    return { ...manga, publicUrl: manga.url, chapters: [...chapters.values()] };
  },

  async pages(chapter) {
    const html = await getText(chapter.url);
    const pages = [];
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const attrs = attributes(match[0]);
      if (!(attrs.class || "").split(/\s+/).includes("js-page")) continue;
      // The lazy-load attribute contains the full reader image, not a cover/placeholder.
      const url = httpsUrl(attrs["data-src"] || attrs.src, ORIGIN);
      if (url) pages.push(url);
    }
    return [...new Set(pages)];
  }
};
