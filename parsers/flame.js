import { MIN_SCORE, scoreManga } from "../match.js";
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

// Next.js deploys invalidate the old build-specific JSON routes.
async function pageData(path) {
  const id = await prefix();
  try {
    return await getJson(`${ORIGIN}/_next/data/${id}/${path}`);
  } catch (error) {
    if (!/HTTP 404\b/.test(error.message)) throw error;
    if (buildId === id) buildId = "";
    const fresh = await prefix();
    return getJson(`${ORIGIN}/_next/data/${fresh}/${path}`);
  }
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
    const data = await pageData("browse.json");
    return ((data.pageProps && data.pageProps.series) || []).map((series) => ({
      id: series.series_id,
      title: series.title || "",
      altTitles: altTitles(series.altTitles),
      url: `${ORIGIN}/series/${series.series_id}`
    })).filter((series) => scoreManga(query, series) >= MIN_SCORE);
  },

  async details(manga) {
    const data = await pageData(`series/${manga.id}.json?id=${manga.id}`);
    const chapters = ((data.pageProps && data.pageProps.chapters) || []).map((chapter) => ({
      id: chapter.chapter_id,
      number: chapter.chapter == null || String(chapter.chapter).trim() === "" ? NaN : Number(chapter.chapter),
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
    const data = await pageData(
      `series/${chapter.seriesId}/${chapter.token}.json?id=${chapter.seriesId}&token=${chapter.token}`
    );
    const images = (data.pageProps && data.pageProps.chapter && data.pageProps.chapter.images) || {};
    return Object.entries(images)
      .filter(([, image]) => image && image.name)
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, image]) => `https://cdn.flamecomics.xyz/uploads/images/series/${chapter.seriesId}/${chapter.token}/${image.name}`);
  }
};
