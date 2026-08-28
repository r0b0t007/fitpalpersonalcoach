# FitPal marketing site

Static, no build step: hand-written HTML/CSS + one tiny JS file (mobile nav toggle).
FR is the primary locale at the root; EN lives under `/en/` with full reciprocal
hreflang (x-default → FR). Implements the validated Claude Design (black `#000`,
gold `#D4AF37`, no card icons, two trust cards).

## Placeholders — replace before going live

Two literals are used consistently everywhere (meta tags, JSON-LD, sitemap, robots,
site.js). Replace them repo-wide when the real name/domain are decided:

```bash
# from the repo root (adjust the replacements):
grep -rl 'fitpal.example' site/ | xargs sed -i 's/fitpal\.example/yourdomain.tld/g'
grep -rl 'FitPal' site/ | xargs sed -i 's/FitPal/YourName/g'
```

Also replace the contact placeholders: `contact@fitpal.example` (mailto links,
JSON-LD, legal pages) and the WhatsApp number `21600000000` (`wa.me` links), and
complete the *(to be completed)* blocks in both legal pages. The OG images
(`img/og-*.png`) carry the name in pixels — regenerate them from the SVG sources
in the session scratchpad (or ask Claude) if the name changes.

## Files

- `index.html` / `en/index.html` — landing pages (single `h1`, sections `h2`,
  features `h3`; FAQPage/SoftwareApplication/Organization/WebSite JSON-LD)
- `mentions-legales.html` / `en/legal.html` — legal + privacy + AGPL attribution
- `styles.css` — shared stylesheet (~11 KB), responsive at 900px/760px
- `site.js` — burger menu only; the site works with JS disabled
- `sitemap.xml` (with hreflang alternates) + `robots.txt`
- `img/screens/*.webp` — real app captures (gold theme) at 440px, ~20–28 KB each
- `img/og-*.png` — 1200×630 social cards, one per locale

## Local preview

```bash
cd site && python -m http.server 8090
# http://localhost:8090 (FR) · http://localhost:8090/en/ (EN)
```

## Deploy

`.github/workflows/deploy-site.yml`: on push to main touching `site/**`, an HTML/SEO
check job runs; the FTPS deploy job is opt-in behind the `DEPLOY_SITE` repository
variable + `production` environment approval, with `SITE_FTP_*` secrets (falling back
to `FTP_*`), `SITE_SERVER_DIR`, and a health check against `SITE_URL`. The site is
expected on its own domain — the app deploy already owns the app domain's
`public_html/`.
