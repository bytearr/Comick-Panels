import { getJson } from "./http.js";

const API = "https://api.mangadex.org";
const RATINGS = ["safe", "suggestive", "erotica"];

function titleOf(attributes) {
  return attributes.title.en || Object.values(attributes.title)[0] || "";
}

function altTitles(attributes) {
  return (attributes.altTitles || [])
    .map((row) => Object.values(row)[0])
    .filter((title) => typeof title === "string" && title);
}

export const mangadex = {
  id: "MANGADEX",
  label: "MangaDex",
  origin: "https://mangadex.org",

  async search(query) {
    const url = new URL(`${API}/manga`);
    url.searchParams.set("limit", "10");
    url.searchParams.set("title", query);
    url.searchParams.append("availableTranslatedLanguage[]", "en");
    for (const rating of RATINGS) url.searchParams.append("contentRating[]", rating);
    const data = await getJson(url);
    return (data.data || []).map((manga) => ({
      id: manga.id,
      title: titleOf(manga.attributes),
      altTitles: altTitles(manga.attributes),
      url: `https://mangadex.org/title/${manga.id}`
    }));
  },

  async details(manga) {
    const chapters = [];
    for (let offset = 0; offset < 10000; offset += 500) {
      const url = new URL(`${API}/manga/${manga.id}/feed`);
      url.searchParams.set("limit", "500");
      url.searchParams.set("offset", String(offset));
      url.searchParams.append("translatedLanguage[]", "en");
      url.searchParams.append("order[chapter]", "asc");
      url.searchParams.append("includes[]", "scanlation_group");
      for (const rating of RATINGS) url.searchParams.append("contentRating[]", rating);
      const data = await getJson(url);
      const rows = data.data || [];
      for (const row of rows) {
        const number = Number(row.attributes.chapter);
        if (!Number.isFinite(number)) continue;
        if (!row.attributes.pages) continue;
        const group = (row.relationships || []).find((item) => item.type === "scanlation_group");
        chapters.push({
          id: row.id,
          number,
          title: row.attributes.title || "",
          scanlator: (group && group.attributes && group.attributes.name) || ""
        });
      }
      if (rows.length < 500) break;
    }
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
    const data = await getJson(`${API}/at-home/server/${chapter.id}`);
    const body = data.chapter || {};
    const files = body.data && body.data.length ? body.data : body.dataSaver || [];
    const mode = body.data && body.data.length ? "data" : "data-saver";
    return files.map((file) => `${data.baseUrl}/${mode}/${body.hash}/${file}`);
  }
};
