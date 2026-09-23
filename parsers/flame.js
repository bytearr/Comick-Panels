import { getJson, getText } from "./http.js";

const ORIGIN = "https://flamecomics.xyz";
let buildId = "";

async function prefix() {
  if (buildId) return buildId;
  const html = await getText(`${ORIGIN}/`);
  const match = html.match(/_next\/static\/([^/]+)\/_buildManifest\.js/);
  if (!match) throw new Error("Flame build id missing");
  buildId = match[1];
  return buildId;
}

function altTitles(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((title) => typeof title === "string");
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((title) => typeof title === "string") : [];
  } catch {
    return [];
  }
}

export const flame = {
  id: "FLAMECOMICS",
  label: "FlameComics",
  origin: ORIGIN,

  async search(query) {
    const id = await prefix();
    const data = await getJson(`${ORIGIN}/_next/data/${id}/browse.json`);
    return ((data.pageProps && data.pageProps.series) || []).map((series) => ({
      id: series.series_id,
      title: series.title || "",
      altTitles: altTitles(series.altTitles),
      url: `${ORIGIN}/series/${series.series_id}`
    }));
  },

  async details(manga) {
    const id = await prefix();
    const data = await getJson(`${ORIGIN}/_next/data/${id}/series/${manga.id}.json?id=${manga.id}`);
    const chapters = ((data.pageProps && data.pageProps.chapters) || []).map((chapter) => ({
      id: chapter.chapter_id,
      number: Number(chapter.chapter),
      title: chapter.title || "",
      token: chapter.token,
      seriesId: manga.id
    })).filter((chapter) => Number.isFinite(chapter.number) && chapter.token);
    return {
      id: manga.id,
      title: manga.title,
      altTitles: manga.altTitles || [],
      url: manga.url,
      publicUrl: manga.url,
      chapters
    };
  },

  async pages(chapter) {
    const id = await prefix();
    const data = await getJson(
      `${ORIGIN}/_next/data/${id}/series/${chapter.seriesId}/${chapter.token}.json?id=${chapter.seriesId}&token=${chapter.token}`
    );
    const images = (data.pageProps && data.pageProps.chapter && data.pageProps.chapter.images) || {};
    return Object.entries(images)
      .filter(([, image]) => image && image.name)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, image]) => `https://cdn.flamecomics.xyz/uploads/images/series/${chapter.seriesId}/${chapter.token}/${image.name}`);
  }
};
