# FitPal marketing site — fitpal.ma

Static, no build step: hand-written HTML/CSS + one tiny JS file (mobile nav toggle).
FR is the primary locale at the root; EN lives under `/en/` with full reciprocal
hreflang (x-default → FR). Implements the validated Claude Design (black `#000`,
gold `#D4AF37`, no card icons, two trust cards). Canonical domain: **https://fitpal.ma**
(baked into canonicals, hreflang, OG/Twitter tags, JSON-LD, sitemap, robots).

## Remaining placeholders — complete before going live

- **WhatsApp number**: `wa.me/212600000000` in both landing pages is a placeholder —
  replace with the real number (international format, no `+` in `wa.me` links).
- **Contact mailbox**: create `contact@fitpal.ma` in cPanel (Email Accounts) — the
  mailto links and JSON-LD already point at it.
- **Legal pages**: complete the *(to be completed)* blocks (company name, address,
  registration number) in `mentions-legales.html` and `en/legal.html`.

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

## Deploy — fitpal.ma on the same Namecheap host as the app backend

The site shares the cPanel account with the app. One-time cPanel setup:

1. **Add the domain**: cPanel → *Domains* → create `fitpal.ma` as an addon domain.
   Set its document root to a dedicated folder (e.g. `fitpal.ma/` under home —
   NOT the account's `public_html/`, which belongs to the app). Note the exact path.
2. **SSL**: AutoSSL usually covers the new domain automatically; verify
   `https://fitpal.ma` serves before flipping the deploy switch.
3. **FTP**: either create a dedicated FTP account rooted at the site's document
   root (fill the `SITE_FTP_*` secrets), or reuse the shared `FTP_*` account and
   point `SITE_SERVER_DIR` at the document-root path as seen from that account.

GitHub repo settings:

| Where | Name | Value |
|---|---|---|
| Variables | `SITE_URL` | `https://fitpal.ma` |
| Variables | `SITE_SERVER_DIR` | the addon domain's document root, e.g. `fitpal.ma/` |
| Secrets (optional) | `SITE_FTP_SERVER` / `SITE_FTP_USERNAME` / `SITE_FTP_PASSWORD` | dedicated FTP account; falls back to `FTP_*` |
| Variables | `DEPLOY_SITE` | `true` — the master switch, set last |

`.github/workflows/deploy-site.yml` then deploys on every push to main touching
`site/**`: HTML/SEO check job → `production`-environment approval → FTPS sync →
health check on `/`, `/en/` and `/sitemap.xml`. After first deploy, submit
`https://fitpal.ma/sitemap.xml` in Google Search Console + Bing Webmaster Tools.
