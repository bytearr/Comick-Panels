# ComicK panels

Repo: <https://github.com/bytearr/Comick-Panels>

Unpacked Manifest V3 extension for Chrome and Brave. On a [comick.dev](https://comick.dev) , [comick.live](https://comick.live), or [comick.io](https://comick.io) chapter it looks up the same chapter on other sites and draws those pages in the ComicK reader.

Nothing else has to be installed. There is no app, no Java process, and no build step.

## Sources

| Source | What it covers |
| --- | --- |
| VortexScans | Current English scanlations |
| LikeManga | English catalog, smaller than MangaK |
| MangaDex | English chapters only. Group name shows in the dropdown |
| FlameComics | About 170 series, including finished ones |
| MangaK | Large catalog (`mangak.io`) |

A toolbar above the ComicK pages shows search progress and a dropdown of matching chapter versions, including their page counts. The last source you explicitly pick is preferred on the next chapter in the same tab. New scanlation groups do not interrupt your current selection.

- **Refresh sources** searches the series again and reloads image URLs without clearing extension data. Existing pages stay visible during the search; they are cleared if the completed search finds no matching version.
- Failed images have a **retry image** button. If a signed URL expired, use **Refresh sources** instead.
- The first two images load immediately; later pages use browser-native lazy loading.
- Source failures are listed in the toolbar; working sources remain available.
- Navigation between chapters/series and browser Back/Forward are handled without reloading the tab. The script also starts on the ComicK homepage so navigating into a chapter works.

## Install

1. Use Chrome or Brave.
2. Open `chrome://extensions` or `brave://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this folder.

Zip this folder if you are handing it to someone else.

After installing, open a chapter URL such as `https://comick.dev/comic/<slug>/<id>-chapter-1-en`. The first match can take a few seconds. Later chapters of the same series reuse the cached chapter list.

Reload the chapter tab after you reload the extension. Chrome drops the old content script until the page loads again.

## Caching and limits

- Chapter lists refresh on the next request after 15 minutes. Missing series are retried after 10 minutes; network failures are not cached as misses. **Refresh sources** bypasses both caches for the current series.
- Image URLs are cached in memory for five minutes and never saved to disk. Refresh sources if an image URL expires sooner.
- Periodic cleanup keeps the 30 most recently saved series plus any actively read series. The old `manga2:` cache is removed automatically; no manual reset is needed when upgrading.
- Chapter `0` is supported when the provider explicitly numbers it. Unnumbered specials/prologues are not guessed. `12.5` matches `12.5` only; dotted and hyphenated decimal URLs are accepted.
- All current providers search English catalogs/chapters. Other chapter languages are not matched separately.
- Each source HTTP request has a 12-second timeout. A search may make multiple requests, so a full scan can take longer.
- Source markup, anti-bot checks, and availability can change. A failed source does not prevent other sources from loading.
- The reader hooks ComicK's `#images-reader-container`. A ComicK layout change can leave the toolbar missing.
- `https://*/*` is required because image hosts are not known ahead of time. Image referer rules apply only to the requesting ComicK tab and are removed when it closes. Source API requests omit cookies.

## Development and testing

There are no runtime dependencies and no build step. With Node.js 22 or newer:

```sh
npm test
npm run check
```

Tests exercise matching, source response fixtures, cache expiry, concurrent readers, disconnected ports, SPA navigation, source selection, and refresh/retry controls. They use mocked network/Chrome APIs and a minimal DOM fixture; they do not establish live provider availability or Chrome rendering correctness. GitHub Actions runs the tests on pushes and pull requests on Ubuntu and Windows (with CRLF checkout).

Before releasing, load the extension in Chrome/Brave and check:

1. Open a chapter directly, then navigate from the homepage into a chapter.
2. Switch to another series with the same chapter number; use Back/Forward and decimal chapters.
3. Select a scanlation group while other results arrive; confirm your selection stays put.
4. Use Refresh sources, retry a failed image, and check the error message when a provider is unavailable.
5. Open two chapter tabs, then close one and confirm the other still loads images.
6. Reload the extension and the chapter tab; verify sources are rediscovered and images load.

## Add a source

1. Copy `parsers/template/source.example.js` to `parsers/<id>.js`.
2. Set `id`, `label`, and `origin`. Implement `search`, `details`, and `pages`. The comments in the template are the return shape.
3. Import that file in `parsers/index.js` and append it to `sources`.
4. Reload the extension, then reload the ComicK chapter.

`parsers/template/` is not imported. A source only runs after it is listed in `index.js`.

If you want a site added and don't want to write the parser, [open an issue](https://github.com/bytearr/Comick-Panels/issues) with the site URL. I'll probably add it.

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
