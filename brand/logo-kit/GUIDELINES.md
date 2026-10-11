# FitPal Coach — Logo Guidelines

## 1. The logo

**Idea.** An `f` and a `p` built on one stem: the coach and the client on the same backbone. The f's
crossbar runs straight into the top of the p's bowl, so the two letters read as one piece.

**Versions** (all in `master/`):

| Version | File | Use it for |
|---|---|---|
| Horizontal (primary) | `fitpal-coach-horizontal-*.svg` | Site header, documents, email signatures |
| Stacked | `fitpal-coach-stacked-*.svg` | Square spaces: social posts, shirts, signage |
| Symbol | `fitpal-coach-symbol-*.svg` | Avatars, watermarks, anywhere the name is already nearby |
| Wordmark | `fitpal-coach-wordmark-*.svg` | Rare: only where the symbol already appears close by |
| App icon | `fitpal-coach-app-icon.svg` | Home-screen icon (gold on graphite tile) |
| Favicon tile | `fitpal-coach-favicon-tile.svg` | Browser tabs (uses the small-size drawing) |

**Three drawings of the symbol.** These are deliberate differences, not mistakes. Use the right one:

- **Master**: on light grounds, at 32 px and above.
- **Small** (`-small-`): heavier strokes and wider gaps. Use it below 32 px.
- **Reversed** (`-reversed-`): about 4 % lighter, because light shapes on dark grounds look heavier
  than they are. Use it for every light-on-dark use. The `-white` and `-on-dark` lockups already
  use it.

## 2. Clear space

Keep **two stem widths** clear on every side. A stem width is the thickness of the symbol's vertical
stroke, so the zone scales with the logo. In the horizontal lockup that is about 40 % of the
symbol's height. The `-on-dark-preview` files show the minimum.

## 3. Minimum size

| Version | Screen | Print |
|---|---|---|
| Horizontal | 120 px wide | 30 mm wide |
| Stacked | 64 px wide | 18 mm wide |
| Symbol | 32 px (master) · 16 px (small drawing) | 6 mm |

## 4. Colour

| Name | Role | HEX | RGB | CMYK (approx.) |
|---|---|---|---|---|
| Gold | Symbol on dark grounds | `#D4AF37` | 212 175 55 | 0 17 74 17 |
| Graphite | Ground; one-colour logo on light | `#1C1A17` | 28 26 23 | 0 7 18 89 · rich black for large areas |
| Bone | Wordmark on dark grounds | `#F2EDE4` | 242 237 228 | 0 2 6 5 |
| Ink | Deepest ground (site) | `#14120F` | 20 18 15 | rich black |

These CMYK values are straight conversions from the screen colours. Proof them before printing. For a
spot-colour gold, match `#D4AF37` against a physical Pantone guide; a metallic such as Pantone 871 C
is the premium option.

**Approved pairs** (contrast ratio):

- Gold symbol + bone name on graphite: 8.26 : 1 and 14.89 : 1. **This is the primary logo.**
- Gold on black (the app's ground): 9.99 : 1.
- Graphite one-colour on bone or white: 14.89 : 1 and 17.36 : 1.
- White one-colour on a photo: only on a calm, dark area.

**Never put gold on light grounds.** Gold on white is 2.10 : 1 and gold on bone is 1.80 : 1. Both are
below the 3 : 1 minimum for graphics, so the mark disappears. On light grounds, use graphite.

## 5. Typography

- The wordmark is **Archivo**: **FitPal** in Bold (700), *Coach* in Regular (400), set with the font's
  own kerning. It is outlined in the files. Never retype it.
- Archivo is the site's typeface and is licensed under the SIL Open Font License, which allows use in
  a logo. Fall back to the system sans stack in `site-coach/styles.css`.

## 6. Don'ts

- Don't stretch, squash or rotate the logo.
- Don't put gold on light backgrounds (see §4).
- Don't use the master drawing white-on-dark. Use `-reversed-` or the `-white` and `-on-dark` lockups.
- Don't add shadows, outlines, gradients or glows.
- Don't change the spacing or the size relationship between the symbol and the name.
- Don't retype "FitPal Coach" in another font next to the symbol.
- Don't use the old lightning-bolt mark anywhere.

## 7. Files

- `master/` holds the SVG masters (vector, outlined, no fonts or effects).
- `variants/` holds the symbol in one colour, square and on an app tile, with PNGs at 64, 512 and
  1024 px.
- `png/` holds the lockups as 1600 px PNGs.
- `web/` holds the favicon (SVG and ICO), PNG icons, the apple-touch icon (`icon-180.png`), the
  maskable icon, the notification badge (`badge-96.png`), a web manifest and a `<head>` snippet.
  The file names match what `frontend/public` and `site-coach` serve, so the snippet can be
  pasted as is.
- `presentation/` holds the board (`board.html`) and its slides as PNGs.
- `source/build_kit.py` regenerates every master from the geometry.
