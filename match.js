const STOP = new Set(["the", "and", "with", "for", "from", "that", "this", "its", "into"]);

export function normTitle(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleWords(value) {
  return normTitle(value).split(" ").filter((word) => word.length > 2 && !STOP.has(word));
}

export const MIN_SCORE = 75;

function wordSet(value) {
  return new Set(titleWords(value));
}

// Exact normalized titles always match. Otherwise both sides have to share
// at least three whole words, and the shorter title has to be mostly the
// same words as the longer one. "heroes" does not match "hero".
export function scoreTitle(query, title) {
  const left = normTitle(query);
  const right = normTitle(title);
  if (!left || !right) return 0;
  if (left === right) return 100;
  const wanted = wordSet(query);
  const found = wordSet(title);
  if (!wanted.size || !found.size) return 0;
  let shared = 0;
  for (const word of wanted) if (found.has(word)) shared += 1;
  if (shared < 3) return 0;
  const overlap = Math.min(shared / wanted.size, shared / found.size);
  return Math.round(100 * overlap);
}

export function scoreManga(query, manga) {
  const titleScore = scoreTitle(query, manga && manga.title);
  const altScore = ((manga && manga.altTitles) || []).reduce(
    (best, name) => Math.max(best, scoreTitle(query, name)),
    0
  );
  if (titleScore >= altScore) return titleScore;
  return Math.max(0, altScore - 1);
}

export function sameChapter(wanted, number) {
  if (number == null || String(number).trim() === "") return false;
  const chapter = Number(number);
  return Number.isFinite(wanted) && Number.isFinite(chapter) && Math.abs(chapter - wanted) < 0.001;
}

export function chapterFromPath(pathname) {
  const segment = String(pathname || "").split(/[?#]/)[0].split("/").filter(Boolean).at(-1) || "";
  const match = segment.match(/(?:^|-)chapter-(\d+(?:[.-]\d+)?)(?=-[a-z]{2}(?:$|[/?#])|$|[/?#])/i);
  return match ? Number(match[1].replace("-", ".")) : null;
}
