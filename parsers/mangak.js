import { getJson, getText } from "./http.js";

const ORIGIN = "https://mangak.io";
const API = "https://api.mangak.io";

function chapterNumber(slug, name) {
  const fromSlug = String(slug || "").match(/chapter-(\d+(?:[.-]\d+)?)/i);
  if (fromSlug) return Number(fromSlug[1].replace("-", "."));
  const fromName = String(name || "").match(/(\d+(?:\.\d+)?)/);
  return fromName ? Number(fromName[1]) : NaN;
}

export const mangak = {
  id: "MANGAK",
  label: "MangaK",
  origin: ORIGIN,

  async search(query) {
    const html = await getText(`${ORIGIN}/search?q=${encodeURIComponent(query)}`);
    const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!raw) return [];
    const props = JSON.parse(raw[1]).props.pageProps;
    return (props.ssrItems || []).map((item) => ({
      id: item.id,
      title: item.name || "",
      altTitles: (item.altNames || []).map((alt) => alt.name).filter(Boolean),
      slug: item.slug,
      url: new URL(item.url, ORIGIN).href
    }));
  },

  async details(manga) {
    const data = await getJson(`${API}/titles/${manga.id}/chapters`);
    const chapters = ((data.data && data.data.chapters) || []).map((chapter) => ({
      id: chapter.id,
      number: chapterNumber(chapter.slug, chapter.name),
      title: chapter.name || "",
      url: new URL(chapter.url, ORIGIN).href
    })).filter((chapter) => Number.isFinite(chapter.number));
    return {
      id: manga.id,
      title: manga.title,
      altTitles: manga.altTitles || [],
      slug: manga.slug,
      url: manga.url,
      publicUrl: manga.url,
      chapters
    };
  },

  async pages(chapter) {
    const html = await getText(chapter.url);
    const raw = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!raw) return [];
    const props = JSON.parse(raw[1]).props.pageProps;
    const images = props.initialChapter && (props.initialChapter.images || props.initialChapter.pages) || [];
    const seen = new Set();
    return images.filter((url) => {
      if (typeof url !== "string" || !url.startsWith("http") || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  }
};
