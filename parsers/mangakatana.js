import { getText } from "./http.js";
import { httpsUrl, links } from "./html.js";

const ORIGIN = "https://mangakatana.com";

export const mangakatana = {
  id: "MANGAKATANA",
  label: "MangaKatana",
  origin: ORIGIN,

  async search(query) {
    const html = await getText(`${ORIGIN}/?search=${encodeURIComponent(query)}&search_by=book_name`);
    const found = new Map();
    for (const heading of html.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi)) {
      for (const link of links(heading[1])) {
        const url = httpsUrl(link.href, ORIGIN);
        if (!url || new URL(url).origin !== ORIGIN || !/^\/manga\/[^/]+\.\d+$/.test(new URL(url).pathname) || !link.text) continue;
        found.set(url, { id: url, title: link.text, url });
      }
    }
    return [...found.values()];
  },

  async details(manga) {
    const html = await getText(manga.url);
    const chapters = new Map();
    const prefix = new URL(manga.url).pathname.replace(/\/$/, "") + "/c";
    for (const link of links(html)) {
      const url = httpsUrl(link.href, ORIGIN);
      if (!url || new URL(url).origin !== ORIGIN) continue;
      const path = new URL(url).pathname;
      if (!path.startsWith(prefix)) continue;
      const number = path.slice(prefix.length);
      if (!/^\d+(?:\.\d+)?$/.test(number)) continue;
      chapters.set(url, { id: url, url, number: Number(number), title: link.text });
    }
    return { ...manga, publicUrl: manga.url, chapters: [...chapters.values()] };
  },

  async pages(chapter) {
    const html = await getText(chapter.url);
    // Read only the site's image-array literal. Never execute remote JavaScript.
    const array = html.match(/\bvar\s+thzq\s*=\s*\[([\s\S]*?)\]\s*;/);
    if (!array) throw new Error("MangaKatana image list missing");
    const pages = [];
    for (const match of array[1].matchAll(/'([^'\\]*(?:\\.[^'\\]*)*)'|"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
      const value = (match[1] ?? match[2]).replace(/\\\//g, "/");
      const url = httpsUrl(value, ORIGIN);
      if (url && /^https?:/.test(value)) pages.push(url);
    }
    return [...new Set(pages)];
  }
};
