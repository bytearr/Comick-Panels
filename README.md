# ComicK panels

Repo: <https://github.com/VashTetr/Comick-Panels>

Unpacked Manifest V3 extension for Chrome and Brave. On a [comick.dev](https://comick.dev) or [comick.live](https://comick.live) chapter it looks up the same chapter on other sites and draws those pages in the ComicK reader.

Nothing else has to be installed. There is no app, no Java process, and no build step.

## Sources

| Source | What it covers |
| --- | --- |
| VortexScans | Current English scanlations |
| LikeManga | English catalog, smaller than MangaK |
| MangaDex | English chapters only. Group name shows in the dropdown |
| FlameComics | About 170 series, including finished ones |
| MangaK | Large catalog (`mangak.io`) |

A dropdown appears above the ComicK pages when at least one source has that chapter. The last source you pick is reused on the next chapter in the same tab.

## Install

1. Use Chrome or Brave.
2. Open `chrome://extensions` or `brave://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.

Zip this folder if you are handing it to someone else.

After installing, open a chapter URL such as `https://comick.dev/comic/<slug>/<id>-chapter-1-en`. The first match can take a few seconds. Later chapters of the same series reuse the cached chapter list.

Reload the chapter tab after you reload the extension. Chrome drops the old content script until the page loads again.

## Limits

- The ComicK title has to match a source title closely. A miss is remembered for that series until you clear the extension's site data under `chrome://extensions`.
- Chapter `0` and prologues are skipped. `12.5` matches `12.5` only.
- MangaDex image URLs expire. If those pages stop loading, clear the extension's stored data and open the chapter again.
- FlameComics and MangaK change their page markup. A source that fails is skipped. The others still run.
- The reader hooks ComicK's `#images-reader-container`. A ComicK layout change can leave the dropdown missing.
- `https://*/*` is required. Page images come from hosts that are not known ahead of time, and some of those hosts reject a request that has no referer.

## Add a source

1. Copy `parsers/template/source.example.js` to `parsers/<id>.js`.
2. Set `id`, `label`, and `origin`. Implement `search`, `details`, and `pages`. The comments in the template are the return shape.
3. Import that file in `parsers/index.js` and append it to `sources`.
4. Reload the extension, then reload the ComicK chapter.

`parsers/template/` is not imported. A source only runs after it is listed in `index.js`.

If you want a site added and don't want to write the parser, [open an issue](https://github.com/VashTetr/Comick-Panels/issues) with the site URL. I'll probably add it.

## Layout

```
manifest.json      extension manifest, version, permissions
background.js      search, chapter match, page cache
content.js         dropdown and images on the ComicK chapter
content.css
match.js           title score and chapter number compare
parsers/           one file per source
parsers/template/  source.example.js, not loaded
LICENSE            MIT, covers this extension's code
```

## Disclaimer

I don't own ComicK, the source sites, or the pages this extension loads. That stays with whoever holds it. You use this at your own risk.

The copyright line in `LICENSE` is only for this extension's code. It is not a claim on ComicK, the source sites, or the pages.
