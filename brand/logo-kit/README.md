# FitPal Coach logo kit — handover notes

The **One Spine** mark, made with the logo-design skill (`Code Projects/Tools/logo-design-skill`).
Usage rules are in `GUIDELINES.md`. Earlier concept rounds are in `../logo-concepts/`.

## Construction

The symbol is built from parameters in `source/build_kit.py` (`spine()`):

| Drawing | Stem | Hook inner radius | Bowl horizontals / curved side | Use |
|---|---|---|---|---|
| Master | 40 | 26 | 34 / 38 | Light grounds, 32 px and up |
| Small | 48 | 30 | 40 / 46 | Below 32 px; favicon |
| Reversed | 38 | 27 | 32 / 36 | All light-on-dark uses |

- The hook's inner arc ends exactly on the bowl's top edge. That makes one clean corner, with no notch
  where the f meets the p.
- The bowl's curved side is heavier than its horizontals so the stroke looks even. The f's crossbar
  is aligned with the p's bowl top.
- Every symbol is one compound path (`fill-rule="evenodd"` for the counter). There are no strokes,
  text, masks or filters, and one transform wrapper per path.

## Tests run

- `svg_audit.py` on all 24 masters: no warnings. Scores are 98–100. The 98 and 99 scores are
  informational notes about the wordmark lockups (point count, wide aspect ratio).
- `preview_sheet.py`: scale ladder 16–256 px, 16/32/48 px pixel test, one-colour, reversed, blur,
  mirrored and 180° rotation. The small drawing keeps the hook gap and the counter open at 16 px.
- Contrast was computed for every approved pair (see the guidelines). Gold fails on light grounds,
  so the guidelines forbid that pairing.

## Regenerating

```bash
pip install fonttools brotli uharfbuzz
python brand/logo-kit/source/build_kit.py site-coach/fonts/archivo-latin.woff2 brand/logo-kit/master
# then, with S = the logo-design skill's scripts/ folder:
python $S/export_variants.py brand/logo-kit/master/fitpal-coach-symbol-black.svg --name fitpal-coach-symbol \
  --title "FitPal Coach symbol" --mono "#D4AF37" --mono "#1C1A17" --icon-bg "#1C1A17" --icon-fg "#D4AF37" \
  --icon-scale 0.62 --optical-offset -0.01 --favicon-source brand/logo-kit/master/fitpal-coach-symbol-small-black.svg \
  --png 64 512 1024 --out-dir brand/logo-kit/variants
```

The kit then has two hand-made overrides:

1. `variants/*-white*` and `variants/*-mono-d4af37*` are replaced with the thinned `reversed` drawing.
2. `web/favicon.svg` is replaced with `master/fitpal-coach-favicon-tile.svg`, so the favicon has a
   graphite tile and stays visible in dark browser tabs. `web/favicon-*.png` and `favicon.ico` are
   rendered from it.
3. The script's `apple-touch-icon.png`, `maskable-512.png` and `site.webmanifest` are renamed to
   `icon-180.png`, `icon-maskable-512.png` and `manifest.json`, the names the app and the site
   serve; `manifest.json` and `head-snippet.html` reference those names.
4. `web/badge-96.png` is added by hand: the small drawing, white on transparency, 96 px. Android
   draws a notification badge from its alpha channel only, so an opaque tile would show as a
   white square. Render the small black master at 96 px and set every pixel's colour to white.

## Open items

- **Wired in.** The app (`frontend/public` icons and `badge-96.png`, `manifest.json`, `index.html`,
  `components/Logo.jsx`, `sw.js`) and the site (`site-coach` favicon SVG and ICO, `icon-180.png`,
  header and footer symbol on all five pages) use this kit. The web/ snippet and manifest use
  graphite `#1C1A17` for the theme colour, as the site does. The app's own manifest keeps `#000000`
  on purpose: it has to match the app's black UI (`App.jsx` sets theme-color at runtime), so only
  its icon tiles are graphite.
- **Native app icons are not regenerated.** `frontend/resources/icon.svg` is updated, but the
  Android and iOS icon files only change after `npx @capacitor/assets generate` (docs/MOBILE.md).
- **Trademark.** No clearance search has been done. Run one (Morocco's OMPIC, WIPO Global Brand
  Database, a reverse image search) before printing or registering.
- **Mockup placeholders.** In the presentation, the browser-tab address, social handle and business
  card ("Alex Morgan", `fitpalcoach.com`) are hard-coded in the skill's board script. They are only
  decoration for the mockups.
- **Print.** CMYK values are converted from screen colours. Proof them, and match the gold to a
  physical Pantone guide before ordering spot-colour print.
