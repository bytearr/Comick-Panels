import { MIN_SCORE, scoreManga } from "../match.js";
import { getJson, getText } from "./http.js";

const ORIGIN = "https://flamecomics.xyz";
let buildId = "";

let buildRequest = null;
let lastBuildCheck = -Infinity;
const BUILD_CHECK_INTERVAL = 60 * 1000;

async function prefix(force = false) {
  if (buildRequest) return buildRequest;
  if (buildId && !force) return buildId;
  buildRequest = (async () => {
    const html = await getText(`${ORIGIN}/`);
    const match = html.match(/_next\/static\/([^/]+)\/_buildManifest\.js/);
    if (!match) throw new Error("Flame build id missing");
    // Keep the known id until discovery succeeds, including on network errors.
    buildId = match[1];
    return buildId;
  })();
  try { return await buildRequest; } finally { buildRequest = null; }
}

// A 404 may be a missing series, not a deployment. Share and rate-limit
// homepage checks; only retry JSON when a different build was discovered.
async function pageData(path) {
  const id = await prefix();
  try {
    return await getJson(`${ORIGIN}/_next/data/${id}/${path}`);
  } catch (error) {
    if (!/HTTP 404\b/.test(error.message)) throw error;
    let fresh = buildId;
    if (buildRequest) fresh = await buildRequest;
    else if (buildId === id && Date.now() - lastBuildCheck >= BUILD_CHECK_INTERVAL) {
      lastBuildCheck = Date.now();
      fresh = await prefix(true);
    }
    if (fresh === id) throw error;
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
