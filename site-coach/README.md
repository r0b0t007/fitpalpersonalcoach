# site-coach — the FitPal Coach marketing site

Static FR/EN marketing site for **fitpal.ma**, the software sold to independent personal
trainers. Plain HTML/CSS/JS, no framework, no runtime dependencies.

**This directory is source, not the deployable.** `node scripts/build-site-coach.mjs`
writes `dist/site-coach/`, and that is what ships: minified CSS/JS under content-hashed
filenames, references rewritten, and the cache block in `_headers` regenerated
from those names. You can still open `site-coach/index.html` straight off disk to work on
it - the build changes no behaviour, only bytes.

## This is not the other two sites

The repo holds three separate marketing surfaces. Mixing them up replaces a live site with the
wrong product, so the difference is worth stating plainly:

| Directory | Product | Domain | Buyer | Brand |
|---|---|---|---|---|
| `site/` | FitPal, white-label member app | gym.fitpal.ma | Gym owners | Gold `#D4AF37` on black |
| **`site-coach/`** | **FitPal Coach, the software** | **fitpal.ma** | **Independent coaches** | **Gold `#D4AF37` on warm graphite** |
| `website/` | openGym (upstream's own site) | not deployed from here | — | Green `#32d74b` |

`deploy-site.yml` publishes `site/`; `deploy-site-coach.yml` publishes this directory. They are
separate Cloudflare Pages projects (`fitpal` and `fitpal-coach`) behind separate repository
variables (`DEPLOY_SITE` and `DEPLOY_SITE_COACH`).

The accent is the app's gold, so this reads as the same brand family. What keeps it from being a
copy of `site/` is the ground (warm graphite `#1C1A17`, not pure black) and the typography: Archivo
variable pushed to wght 800 / wdth 68, visible rules, numbered sections. `site/` is a system-font
site; this one is a field manual.

## Layout

```
index.html              FR landing (root locale)
en/index.html           EN landing
mentions-legales.html   FR legal
en/legal.html           EN legal
styles.css              the whole design system, one file
site.js                 menu, scroll reveal, hero video
img/screens/*.png       real app screenshots (see below). The two CLIENT screens exist
                        per locale (`-fr` / `-en`); the coach screens do not, because the
                        dashboard is English-only and the spec sheet says so.
img/og-{fr,en}.png      1200x630 social cards
img/promo-poster-{fr,en}.jpg  hero video poster (a frame lifted from the render)
img/coach-hero.jpg      hero portrait beside the headline (stock, illustrative)
img/coaches.jpg         the full-bleed photo band (stock, illustrative — both in NOTICE.md)
assets/promo-{fr,en}.mp4      the hero loop, 16.8s, silent, 1920x1080
favicon.svg  icon-180.png  robots.txt  sitemap.xml  _headers
```

Design decisions and their reasoning live in `DESIGN.md` and `PRODUCT.md` at the repo root.

## The screenshots are real, and regenerating them is scripted

Every product claim on the page is attached to a screenshot of the actual app. None of them are
mockups. They were filmed off a local throwaway instance through `frontend/dev/capture-boot.html`,
the same harness the tutorial videos use, which freezes every CSS transition and animation so the
output is deterministic.

To refilm them, see `docs/VIDEO_CAPTURE.md`. Two things that are specific to these shots:

- **Film at 360x780 with `--force-device-scale-factor=2`**, giving 720x1560 files. Two reasons,
  and both matter:
  - **360x780 is exactly 9:19.5**, the aspect of the device frame the site and the film both
    use, so a capture fills the phone screen with zero cropping.
  - **2x, not 1x.** The tutorial pipeline films at 1x because its mockup's screen box is
    exactly 359x776 — 1:1, no resampling. Neither surface here is 1:1: the film draws its phone
    about 420x910 on a 1920x1080 frame, and the site's `--dev-w` is 300px. A 720-wide source
    downscales into both, which is the right direction; a 359-wide 1x capture would have to be
    *upscaled* into the film, which is the softness `docs/VIDEO_CAPTURE.md` exists to prevent.
    2x also doubles as the site's retina asset.

  Under 1000px the app renders its real phone layout (single column, full-width tab bar), not a
  shrunken desktop, so these are genuine phone screens rather than squeezed ones.
- **The client screens must be shot in BOTH languages.** `client-home` and `client-stats` ship
  as `-fr` and `-en` pairs. They were English-only once, which meant the French landing page
  showed a French coach what his client sees *in English*, about a thousand pixels above a spec
  row promising the client app in French. For a buyer looking for a reason to dismiss, that was
  the cheapest one available.

  The app's language is `S.lang` in the persisted store, so it comes from the server copy of the
  client's state. Set it before capturing:

  ```bash
  node -e "const fs=require('fs'),p=process.argv[1];
    const s=JSON.parse(fs.readFileSync(p,'utf8')); s.lang='fr';
    fs.writeFileSync(p, JSON.stringify(s))" "$DATA_DIR/state-demo-karim.json"
  ```

  Restart the API afterwards — it holds state in memory. The coach screens stay English on
  purpose; `frontend/` coach surfaces use raw strings rather than `t()`, which `CLAUDE.md`
  documents as deliberate.
- **"Training now" cannot be seeded.** It reads in-memory presence with a ~70 second TTL, so
  `seed-demo.mjs` cannot fake it. Have a demo client POST `/api/activity` immediately before the
  capture and the live state on the screenshot is genuinely real.
- **Always verify which screen you actually captured.** A capture can silently land on the app's
  default route instead of the one you asked for, and the resulting PNG looks perfectly fine
  until someone reads it. This shipped a dashboard crop labelled as the client roster once.
  The harness already tells you: it writes `data-dbg` onto `<html>` with the resolved `hash` and
  the screen's text. Read it, don't eyeball the image:

  ```bash
  chrome --headless=new --dump-dom ... "http://localhost:5173/capture-boot.html?..." \
    | grep -o 'data-dbg="[^"]*"'
  # expect: "hash":"#/clients"  and text starting "Clients 6 clients Invite ..."
  ```

  Adding `&do=wait:1800` gives the SPA time to settle on the requested route after the cookie is
  planted, which is what the failed attempt was missing.

## Every app screen is in a phone — the film is not

`.device` wraps all four screenshots: a 1px outline, an ink bezel, a small speaker slot, and a
screen at `aspect-ratio: 9 / 19.5`.

It does **not** wrap the hero film, which is 1920x1080 and sits unframed at the container's full
width. The film's own frames already hold phones, drawn in this same geometry — framing the film
would nest a phone inside a phone, and would crop a landscape picture to a 9:19.5 slot, throwing
away most of every frame. `DESIGN.md` states the rule; this is the same rule, not an exception.

Three things worth knowing before changing it:

- **The ratio is measured, not chosen.** 9:19.5 is the app's own phone viewport, so the captures
  and the film fill the screen with no cropping and no letterbox. Change the ratio and everything
  inside starts getting cropped silently by `object-fit: cover`.
- **The hero photo's two-column breakpoint is 1040px, not 1000px.** Chrome matches media
  queries against `innerWidth` (scrollbar included) but lays out against `clientWidth`, so a
  1000px rule fires with 985px of room; the photo's grid track collapsed to `0px` and its
  caption spilled 78px, giving the page a horizontal scrollbar. Do not lower it back.
- **`--dev-w` lives on the CONTAINER** (`.feat .shot-wrap`), not on `.device`,
  because the caption reads it too (`max-width`). Set it on the device and the caption stops
  matching the phone it labels.
- **The geometry is borrowed, the skin is not.** It comes from the house component the ten
  tutorial videos use, which wears a gradient bezel under a five-layer shadow. This one is a flat
  outline: a glossy phone would be the one glossy thing on a page built to look like a manual.

The flat `.shot` treatment this replaced is gone, and with it the signal that separated evidence
from atmosphere — so that claim now lives in the visible caption under every device.

## The hero video

`assets/promo-{fr,en}.mp4` is a 16.8-second silent loop built with HyperFrames. The project lives
**outside this repo**, at `../fitpal-coach-videos/videos/fitpal-coach-site-hero`, following the
same convention as the ten tutorial episodes (`docs/VIDEO_CAPTURE.md`).

Four things about it that are not obvious:

- **It is landscape because the type is the script.** It was built portrait, to sit in a phone
  beside the hero copy. In that track a 16:9 film resolves to ~530px wide and a 9:19.5 one to
  ~355px — and with no voiceover, every word of the argument is on screen. Both were too small
  to read. It was re-laid-out at 1920x1080 (not resized — five frames recomposed) and the hero
  stacked, which puts it near 1000px. The opening title frame was cut in the process: it said
  the same three words as the page headline sitting directly above it, which is a poor use of
  the first three seconds. That is where 20s became 16.8s.
- **It is silent on purpose, and that is what shapes it.** A hero video autoplays muted, so a
  film that needs sound is a film nobody hears. There is no voiceover, no music, no SFX
  (`music: none` plus no `SCRIPT.md` is HyperFrames' canonical silent marker). Type and motion
  carry the whole argument, and every frame ends on at least half a second of complete stillness
  because continuous motion in peripheral vision is what makes a hero loop irritating by the
  third pass.
- **There are two renders because the type IS the script.** With no voiceover, one file cannot
  serve both locales. Each copy string is authored as `<span data-i18n="04.2">…</span>` and
  `localize.mjs fr|en` swaps them by key; it is strict, so an unknown key or an unused one fails
  rather than shipping a half-translated video. Every layout is measured against the French
  string, which is longer in every beat.
- **The fonts are staged locally, not fetched.** `stage-fonts.mjs` puts Archivo's latin and
  latin-ext subsets in the project's `assets/fonts/` and rewrites each frame's `@font-face`.
  Without it the render silently falls back to a system sans and loses the `wdth 68`
  condensation that is most of the visual identity. Paths must be root-relative
  (`assets/fonts/…`), not `../../` — compositions are served with the project root as base URL.

To rebuild: `node stage-fonts.mjs && npx hyperframes check && npx hyperframes render --output
renders/video-en.mp4`, then `node localize.mjs fr` and render again, then lift a poster frame
with ffmpeg and `node localize.mjs en` to restore the source.

## Contrast is verified, not asserted

`node scripts/check-site-coach-contrast.mjs` reads the hexes straight out of `styles.css` and
fails on any pair below WCAG 2.2 AA. It runs in CI. Two rules it encodes:

- Gold fills always take an `--ink` label. Bone on gold measures 1.80:1 and fails badly, so the
  script asserts that pair *stays* failing — if it ever starts passing, the palette drifted.
- `--gold-deep` (`#6F5A1C`) exists only for the one light section. Gold on bone is also 1.80:1,
  and even the app's darker gold `#A5821F` only reaches 3.10:1, so the light ground needs its own
  much darker value. It lands at 5.71:1.

The accent system is **two tokens, not three**. Gold is 8.26:1 on the graphite ground at any size,
so it needs no lighter variant for small text; the orange it replaced was 4.62:1 and needed a
whole extra token to rescue 12px labels. The primary button's hover does not tint the gold either
— it inverts the plate (ink fill, gold label), which uses two ratios the checker already asserts
and costs no token at all.

## Two gotchas

**Automated contrast checkers fail the landing pages, and they are wrong.** The first-visit hero
intro fades in, so an auditor sampling mid-animation reports the hero as failing at a different
ratio every run. Measured at rest with all animations finished, everything passes. The legal
pages, which have no intro, audit clean. Audit with reduced motion, or after animations settle.

**Extensionless URLs.** Cloudflare Pages serves `/foo.html` at `/foo` and 308-redirects the
`.html` form, so canonicals, hreflangs, the sitemap and internal links all use the extensionless
spelling. CI greps for `.html` URLs and fails the build if one reappears. The consequence is that
a plain local static server cannot follow the legal-page links; that is expected.

## Local preview

```bash
cd site-coach && python3 -m http.server 8080
```

No build, no watch, no dependencies. Edit and reload.

Bump the `?v=` on `styles.css` and `site.js` when you change either — the browser cache-bust is
manual, the same convention `website/` uses.

## Still open

**These block deployment, by design.** `deploy-site-coach.yml` has a gate that fails the build
while any of them is still present, because the page's only conversion is a call and the call is
booked through the details below — ship them as placeholders and every visitor who reaches the
ask hits a dead end. That is the one failure no other check in the job can see.

- `wa.me/212600000000` is a placeholder. So is `contact@fitpal.ma`.
- Company name, address, legal form and registration number in both legal pages are bracketed
  markers (`[raison sociale a completer]`, `[legal form and capital]`, and so on).

Not a blocker:

- The coach dashboard is English-only in the product; the spec sheet says so rather than hiding it.
