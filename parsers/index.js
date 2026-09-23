// A contributed source is a file next to these imports.
// Copy parsers/template/source.example.js, then import it and append it below.
import { flame } from "./flame.js";
import { likemanga } from "./likemanga.js";
import { mangadex } from "./mangadex.js";
import { mangak } from "./mangak.js";
import { vtheme } from "./vtheme.js";

export const sources = [
  vtheme({
    id: "VORTEXSCANS",
    label: "VortexScans",
    origin: "https://vortexscans.org"
  }),
  likemanga,
  mangadex,
  flame,
  mangak
];
