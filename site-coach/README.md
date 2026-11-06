# site-coach — the FitPal Coach marketing site

Static FR/EN/ES marketing site for **fitpal.ma**, the software sold to independent coaches who
find their clients on Instagram. Its one conversion is "Commencer gratuitement", the self-serve
Free plan (CHW-342; `PRODUCT.md`). Plain HTML/CSS/JS, no framework, no runtime dependencies.

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
es/index.html           ES landing
mentions-legales.html   FR legal          conditions.html   FR terms
en/legal.html           EN legal          en/terms.html     EN terms
es/legal.html           ES legal          es/terms.html     ES terms
logiciel-coach-sportif.html  FR guide  } a pair (hreflang): what a tool must do for a coach whose
es/app-entrenadores-personales.html     } clients come from Instagram (CHW-352)
alternative-trainerize.html   FR  } a pair: comparison with Trainerize
en/trainerize-alternative.html EN }
alternative-everfit.html      FR    comparison with Everfit
es/alternativa-harbiz.html    ES    comparison with Harbiz
                        The comparisons quote competitors' prices from their own pages on a
                        stated date, and all six repeat FitPal's own prices by hand: when
                        either changes, update them with the landings' pricing section.
                        `grep -rn "19&nbsp;€\|39&nbsp;€\|79&nbsp;€" site-coach` lists every copy.
404.html                not found, noindex
styles.css              the whole design system, one file
site.js                 scroll reveal, nothing else (CHW-342 removed the menu and the hero loop)
img/screens/*.png       real app screenshots (see below), 720x1560, one per locale:
                        public-page, request, client-day1.
                        Their AVIF/WebP variants come from `python scripts/build-images.py`.
img/hero-lift.jpg       hero photograph, 1920x1080      } stock, Vitaly Gariev on Unsplash,
img/side-client.jpg     section 02, client side, 1600   } NOTICE.md. AVIF/WebP variants from
img/side-coach.jpg      section 02, coach side, 1600    } build-images.py.
img/demo-poster-{fr,es}.jpg  the demo film's poster, 1280x720, the frame at 1.5s
img/og-{fr,en,es}.png   1200x630 social cards, one layout in three languages, all ending in
                        fitpal.ma (rendered from an HTML card in headless Chrome, Archivo)
assets/demo-{fr,es}.{mp4,webm}  the 47s demo film with voice-over, 1280x720 (see below)
favicon.svg  icon-180.png  robots.txt  sitemap.xml  _headers
```

**The EN page has no demo film.** There is no English render of the demo
(`../fitpal-coach-videos/videos/fitpal-coach-demo-join/build.mjs` builds FR and ES only), so
`en/index.html` keeps section 06's heading and its two buttons and drops the video. When an EN
render exists, encode it as below and copy the FR page's `<figure>` into the EN page.

Design decisions and their reasoning live in `DESIGN.md` and `PRODUCT.md` at the repo root.

## The screenshots are real, and regenerating them is scripted

Every product claim on the page is attached to a screenshot of the actual app. None of them are
mockups. The design (Claude Design, CHW-342) drew its phone screens in HTML; each was replaced by a
capture before it shipped.

The three CHW-342 captures come from the demo film's own run, filmed off a local throwaway
instance through `frontend/dev/capture-boot.html`:
`../fitpal-coach-videos/videos/fitpal-coach-demo-join/assets/<lang>/`

| Site file | Film capture | What it shows |
|---|---|---|
| `public-page-<lang>.png` | `01-page.png` | the demo coach's public page (hero and step 1) |
| `request-<lang>.png` | `c3-request-open.png` | a request in the coach's inbox, Accept and Decline (step 2) |
| `client-day1-<lang>.png` | `08-home.png` | the client's home, "Séance 1 · aujourd'hui" (step 3) |

The demo accounts are Karim and Sara in French (`coach.fitpal.ma/c/karim.coach`), Javier and Lucía
in Spanish (`javier.coach`), Jake and Emma in English (`jake.coach`; Karim's page and starter
program translated, Sara's answers). **The hero caption prints the handle, so it must match the
capture.** The FR and ES sets come from the demo film's captures (`fitpal-coach-videos`, CHW-346);
the EN set was filmed for this page on the same local instance: the public page and the request
through `capture-boot.html`, the client's home in a 360x780 @2x mobile emulation instead, because
the client's tab bar does not render inside the harness's iframe (Sara's home filmed through it
lacks the bar too), and the FR/ES `08-home` shots have it.

The coach's portrait in those captures is a stock photograph (Vitaly Gariev, Unsplash; the same
file is `assets/brand/coach-photo.jpg` in the film project), credited in the footer and NOTICE.md.

To refilm, see `docs/VIDEO_CAPTURE.md`. Things specific to these shots:

- **Film at 360x780 with `--force-device-scale-factor=2`**, giving 720x1560 files. 360x780 is
  exactly 9:19.5, the aspect of the device frame, so a capture fills the phone screen with zero
  cropping; 2x means every placement on the site downscales, never upscales.

  Under 1000px the app renders its real phone layout (single column, full-width tab bar), not a
  shrunken desktop, so these are genuine phone screens rather than squeezed ones.
- **Every capture is shot in every language.** A French coach must see the app in French, a
  thousand pixels above a row promising the app in French. The app's language is `S.lang` in the
  persisted store: set it on the capture instance's accounts before each language's shots.
- **Always verify which screen you actually captured.** A capture can silently land on the app's
  default route instead of the one you asked for, and the resulting PNG looks perfectly fine
  until someone reads it. The harness writes `data-dbg` onto `<html>` with the resolved `hash`
  and the screen's text. Read it, don't eyeball the image:

  ```bash
  chrome --headless=new --dump-dom ... "http://localhost:5173/capture-boot.html?..." \
    | grep -o 'data-dbg="[^"]*"'
  ```

  Adding `&do=wait:1800` gives the SPA time to settle on the requested route after the cookie is
  planted.

## Every app screen is in a phone — the film is not

`.device` wraps every screenshot: a 1px outline, an ink bezel, a small speaker slot, and a
screen at `aspect-ratio: 9 / 19.5`. Under each one is a caption ("Capture de l'app").

It does **not** wrap the demo film, which is 16:9 and sits unframed at the container's full
width. The film's own frames already hold phones, drawn in this same geometry; framing the film
would nest a phone inside a phone. `DESIGN.md` states the rule.

Things worth knowing before changing it:

- **The ratio is measured, not chosen.** 9:19.5 is the app's own phone viewport, so the captures
  fill the screen with no cropping and no letterbox. Change the ratio and everything inside starts
  getting cropped silently by `object-fit: cover`.
- **The hero's two-column breakpoint is 1040px, not 1000px.** Chrome matches media queries
  against `innerWidth` (scrollbar included) but lays out against `clientWidth`, so a 1000px rule
  fires with 985px of room; the second grid track once collapsed to `0px` and its caption spilled,
  giving the page a horizontal scrollbar. Do not lower it back.
- **`--dev-w` lives on the figure** (`.shot`), not on `.device`, because the caption reads it
  too (`max-width`). Set it on the device and the caption stops matching the phone it labels.
  Hero 300px (250 on a phone), steps 220px from 900px (250 below).
- **The geometry is borrowed, the skin is not.** It comes from the house component the tutorial
  videos use, which wears a gradient bezel under a five-layer shadow. This one is a flat outline:
  a glossy phone would be the one glossy thing on a page built to look like a manual. (The design
  export drew a drop shadow; it was not carried over.)

## The demo film

`assets/demo-{fr,es}.{mp4,webm}` is the 47-second demo (link, request, accept, workout 1) with a
voice-over and burned-in captions, cut for the web from the 1920x1080 renders in
`../fitpal-coach-videos/videos/fitpal-coach-demo-join/renders/demo-<lang>-h.mp4`:

```bash
ffmpeg -i demo-fr-h.mp4 -vf scale=1280:720:flags=lanczos -c:v libx264 -preset slow -crf 25 \
  -profile:v high -pix_fmt yuv420p -c:a aac -b:a 96k -ac 2 -movflags +faststart demo-fr.mp4
ffmpeg -i demo-fr-h.mp4 -vf scale=1280:720:flags=lanczos -c:v libsvtav1 -crf 42 -preset 6 \
  -pix_fmt yuv420p -c:a libopus -b:a 64k -ac 2 demo-fr.webm
ffmpeg -ss 1.5 -i demo-fr-h.mp4 -frames:v 1 -vf scale=1280:720:flags=lanczos -q:v 4 demo-poster-fr.jpg
```

The two videos go in `assets/`, the poster in `img/`. The same for `es`.

About 2.0 MB (H.264) and 1.45 MB (AV1) each. It ships with `controls`, `preload="none"` and
`playsinline`, and no autoplay: it has a voice-over, so it plays only when pressed, and nobody
downloads 2 MB they did not ask for. That is also why `site.js` no longer touches video. The
poster is a plain JPEG rather than a `<picture>` because `<video poster>` takes one URL; it is not
in `build-images.py`'s POSTERS list, which would shrink it to 800px for a slot that is 1088px wide.

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

## Gotchas

**Automated contrast checkers fail the landing pages, and they are wrong.** The first-visit hero
intro fades in, so an auditor sampling mid-animation reports the hero as failing at a different
ratio every run. Measured at rest with all animations finished, everything passes. The legal
pages, which have no intro, audit clean. Audit with reduced motion, or after animations settle.
The hero copy also sits on a photograph: the checker cannot see that, so the shade is ink at 96%
under the copy and the phone's caption has its own ink plate.

**Headless Chrome cannot screenshot a 390px page directly on Windows.** The window has a minimum
width, so `--window-size=390,…` lays the page out wider and crops it, and the result looks like a
page overflowing its viewport. Load the page in a 390px `<iframe>` inside a wider window instead.

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
manual, the same convention `website/` uses. (The landings, the 404 and the CHW-352 pages are on `styles.css?v=20`;
the legal pages still say `?v=18`, which only matters to a local preview: the build replaces both
with the hashed name.)

## Still open

**These block deployment, by design.** `deploy-site-coach.yml` has a gate that fails the build
while any of them is still present, because the page's second button is WhatsApp and the footer's
Contact is the mailbox below — ship them as placeholders and a visitor with a question hits a dead
end. That is the one failure no other check in the job can see.

- `wa.me/212600000000` is a placeholder. So is `contact@fitpal.ma`.
- Company name, address, legal form and registration number in both legal pages are bracketed
  markers (`[raison sociale a completer]`, `[legal form and capital]`, and so on).
