function slugFromSeries(url) {
  try {
    const parts = new URL(url, "https://vortexscans.org").pathname.split("/").filter(Boolean);
    const index = parts.indexOf("series");
    return index >= 0 ? decodeURIComponent(parts[index + 1] || "") : "";
  } catch {
    return "";
  }
}

function chapterSlug(chapter) {
  if (chapter.slug) return chapter.slug;
  try {
    const parts = new URL(chapter.url, "https://vortexscans.org").pathname.split("/").filter(Boolean);
    const last = decodeURIComponent(parts.at(-1) || "");
    if (last.startsWith("chapter-")) return last;
  } catch { /* number fallback */ }
  return `chapter-${chapter.number}`;
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

export function vtheme({ id, label, origin }) {
  const api = origin.replace("://", "://api.");

  return {
    id,
    label,
    origin,

    async search(query) {
      const data = await getJson(
        `${api}/api/query?searchTerm=${encodeURIComponent(query)}&perPage=20&page=1`
      );
      return (data.posts || []).map((post) => ({
        id: post.id,
        title: post.postTitle || "",
        slug: post.slug,
        url: `${origin}/series/${post.slug}`
      }));
    },

    async details(manga) {
      const chapters = [];
      for (let skip = 0; skip < 5000; skip += 900) {
        const data = await getJson(`${api}/api/chapters?postId=${manga.id}&take=900&skip=${skip}`);
        const rows = data.post && data.post.chapters || [];
        for (const row of rows) {
          if (row.isAccessible === false) continue;
          chapters.push({
            id: row.id,
            number: row.number,
            title: row.title || "",
            slug: row.slug
          });
        }
        if (rows.length < 900) break;
      }
      return {
        id: manga.id,
        title: manga.title,
        slug: manga.slug,
        url: manga.url,
        publicUrl: manga.url,
        chapters
      };
    },

    async pages(chapter, manga) {
      const series = manga.slug || slugFromSeries(manga.publicUrl || manga.url || chapter.url);
      const slug = chapterSlug(chapter);
      const data = await getJson(
        `${api}/api/chapter?mangaslug=${encodeURIComponent(series)}&chapterslug=${encodeURIComponent(slug)}`
      );
      const images = (data.chapter && data.chapter.images) || [];
      const seen = new Set();
      return images
        .slice()
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((image) => image.url)
        .filter((url) => {
          if (typeof url !== "string" || !url.startsWith("http") || seen.has(url)) return false;
          seen.add(url);
          return true;
        });
    }
  };
}
