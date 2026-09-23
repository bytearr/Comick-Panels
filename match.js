const STOP = new Set(["the", "and", "with", "for", "from", "that", "this", "its", "into"]);

export function normTitle(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleWords(value) {
  return normTitle(value).split(" ").filter((word) => word.length > 2 && !STOP.has(word));
}

function sameWord(left, right) {
  return left === right || left.startsWith(right) || right.startsWith(left);
}

export function scoreTitle(query, title) {
  const wanted = titleWords(query);
  const found = titleWords(title);
  if (!wanted.length || !found.length) return 0;
  if (normTitle(query) === normTitle(title)) return 100;
  const hits = wanted.filter((word) => found.some((other) => sameWord(word, other))).length;
  return Math.round((100 * hits) / wanted.length);
}

export function sameChapter(wanted, number) {
  const chapter = Number(number);
  return Number.isFinite(wanted) && Number.isFinite(chapter) && Math.abs(chapter - wanted) < 0.001;
}

export function chapterFromPath(pathname) {
  const raw = String(pathname || "");
  const at = raw.toLowerCase().lastIndexOf("chapter-");
  if (at < 0) return null;
  const segs = raw.slice(at + "chapter-".length).split(/[/?#]/)[0].split("-").filter(Boolean);
  if (!/^\d+$/.test(segs[0] || "")) return null;
  if (/^\d+$/.test(segs[1] || "") && (!segs[2] || /^[a-z]{2}$/i.test(segs[2]))) {
    return Number(`${segs[0]}.${segs[1]}`);
  }
  return Number(segs[0]);
}
