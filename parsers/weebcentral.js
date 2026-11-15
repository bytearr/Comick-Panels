import { getText } from "./http.js";
import { attributes, httpsUrl, textOf } from "./html.js";

const ORIGIN = "https://weebcentral.com";

function seriesTitle(inner) {
  const heading = inner.match(/class="[^"]*\btext-lg\b[^"]*"[^>]*>([^<]*)</i);
  if (heading) {
    const title = textOf(heading[1]);
    if (title) return title;
  }
  const alt = inner.match(/\balt="([^"]*?)\s+cover"/i);
  return alt ? textOf(alt[1]) : "";
}

export const weebcentral = {
  id: "WEEBCENTRAL",
  label: "WeebCentral",
  origin: ORIGIN,

  async search(query) {
    const url = new URL("/search/data", ORIGIN);
    url.searchParams.set("text", query);
    url.searchParams.set("sort", "Best Match");
    url.searchParams.set("order", "Ascending");
    url.searchParams.set("official", "Any");
    url.searchParams.set("display_mode", "Full Display");
    const html = await getText(url);
    const found = new Map();
    for (const match of html.matchAll(/<a\b[^>]*href="([^"]*\/series\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const page = httpsUrl(match[1], ORIGIN);
      if (!page || new URL(page).origin !== ORIGIN) continue;
      const id = new URL(page).pathname.split("/")[2] || "";
      if (!/^[A-Za-z0-9]{20,}$/.test(id)) continue;
      const title = seriesTitle(match[2]);
      if (!title) continue;
      found.set(page, { id, title, url: page });
    }
    return [...found.values()];
  },

  async details(manga) {
    const html = await getText(`${ORIGIN}/series/${manga.id}/full-chapter-list`);
    const chapters = new Map();
    for (const match of html.matchAll(/<a\b[^>]*href="([^"]*\/chapters\/([^"/?#]+))"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const page = httpsUrl(match[1], ORIGIN);
      if (!page || new URL(page).origin !== ORIGIN) continue;
      const number = textOf(match[3]).match(/\bChapter\s+(\d+(?:\.\d+)?)\b/i);
      if (!number) continue;
      chapters.set(page, {
        id: match[2],
        url: page,
        number: Number(number[1]),
        title: textOf(match[3]),
        scanlator: /chapter-badge-official/.test(match[3]) ? "Official" : ""
      });
    }
    return { ...manga, publicUrl: manga.url, chapters: [...chapters.values()] };
  },

  async pages(chapter) {
    const html = await getText(`${ORIGIN}/chapters/${chapter.id}/images?is_prev=False`);
    const pages = [];
    for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
      const src = attributes(match[0]).src || "";
      if (!/^https:\/\//i.test(src)) continue;
      const url = httpsUrl(src, ORIGIN);
      if (url) pages.push(url);
    }
    return [...new Set(pages)];
  }
};
