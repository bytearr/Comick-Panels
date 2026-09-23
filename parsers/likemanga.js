import { getJson, getText } from "./http.js";

const ORIGIN = "https://likemanga.ink";

function decode(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&#039;", "'")
    .replaceAll("&quot;", "\"")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function chapterNumber(label) {
  const match = label.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : NaN;
}

export const likemanga = {
  id: "LIKEMANGA",
  label: "LikeManga",
  origin: ORIGIN,

  async search(query) {
    const text = await getText(`${ORIGIN}/?act=search&f[keyword]=${encodeURIComponent(query)}`);
    return [...text.matchAll(/title-manga"><a href="([^"]+)"[^>]*>([^<]+)/g)].map((match) => ({
      id: match[1],
      title: decode(match[2]).trim(),
      url: new URL(match[1], ORIGIN).href
    }));
  },

  async details(manga) {
    const page = await getText(manga.url);
    const idMatch = page.match(/manga_id" value="(\d+)"/);
    if (!idMatch) throw new Error("LikeManga id missing");
    const chapters = [];
    const seen = new Set();
    for (let pageNo = 1; pageNo <= 20; pageNo += 1) {
      const data = await getJson(
        `${ORIGIN}/?act=ajax&code=load_list_chapter&manga_id=${idMatch[1]}&page=${pageNo}`
      );
      const rows = [...String(data.list_chap || "").matchAll(/href="([^"]+)"[^>]*>([^<]+)/g)];
      let added = 0;
      for (const match of rows) {
        const href = decode(match[1]);
        if (seen.has(href)) continue;
        const number = chapterNumber(decode(match[2]));
        if (!Number.isFinite(number)) continue;
        seen.add(href);
        added += 1;
        chapters.push({
          id: href,
          number,
          title: "",
          url: new URL(href, ORIGIN).href
        });
      }
      if (!added) break;
    }
    return {
      id: manga.id,
      title: manga.title,
      url: manga.url,
      publicUrl: manga.url,
      chapters
    };
  },

  async pages(chapter) {
    const text = await getText(chapter.url);
    const seen = new Set();
    return [...text.matchAll(/https:\/\/[^"'\s]*mgread\.io\/manga\/[^"'\s]+/g)]
      .map((match) => match[0])
      .filter((url) => {
        if (seen.has(url)) return false;
        seen.add(url);
        return true;
      });
  }
};
