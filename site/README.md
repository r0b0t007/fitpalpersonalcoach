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

## Deploy — Cloudflare Pages

The site is hosted on **Cloudflare Pages** (project `fitpal`), not on the Namecheap
box that runs the app. Pages gives a global CDN, free TLS, atomic deploys with
one-click rollback, and a preview URL per pull request.

**Note on URLs:** Pages serves `/foo.html` at `/foo` and 308-redirects the `.html`
form. Canonicals, hreflang and the sitemap therefore use the **extensionless**
paths (`/mentions-legales`, `/en/legal`); the check job greps for `.html` URLs to
stop that regressing. `_headers` carries the security and cache-control policy.

One-time setup:

1. **Cloudflare API token** — dashboard → My Profile → API Tokens → Create Token →
   *Edit Cloudflare Workers* template (or a custom token with **Account →
   Cloudflare Pages → Edit**). Save it as the `CLOUDFLARE_API_TOKEN` GitHub secret.
   `CLOUDFLARE_ACCOUNT_ID` is already set.
2. **Custom domain** — Pages project → *Custom domains* → add the apex. With the zone on
   Cloudflare nameservers this rewrites the apex to a proxied `CNAME → fitpal.pages.dev`
   in one click; if the zone lives elsewhere, add that CNAME at the other DNS host.
   Then send `www` to the apex: zone → *Rules* → *Redirect Rules* → **Redirect from WWW
   to root** template (301, keep *Preserve query string*), which matches the canonical
   tags — they are apex-only. Without it `www` inherits the apex CNAME, chains into
   Pages and serves a 522.
   **Status:** already done for `fitpal.ma`; redo only when re-pointing to a new domain.
3. Flip the `DEPLOY_SITE` repository variable to `true`.

> **The zone is on Cloudflare nameservers** (`braden`/`natasha.ns.cloudflare.com`),
> moved from NindoHost, which is what makes Universal SSL and the apex CNAME possible.
> Only `fitpal.ma`, `www` and `app` are proxied — the mail and cPanel records
> (`mail`, `webmail`, `cpanel`, `autodiscover`, `whm`, …) must stay **DNS-only**, since
> Cloudflare's proxy carries HTTP(S) only and would black-hole IMAP/SMTP and the cPanel
> ports. The `MX` records and the SPF `TXT` are unproxied by nature and were preserved
> through the migration.
>
> One consequence worth knowing: the SPF record still starts `v=spf1 +a …`, and `+a`
> now resolves to Cloudflare's Pages IPs rather than the mail server. Delivery still
> passes on `+mx` and `include:spf.web-hosting.com`, so nothing is broken today. But if
> mail is ever sent directly from the hosting box (PHP `mail()`, a cron job), add that
> IP explicitly instead of relying on `+a`:
>
> ```
> v=spf1 +a +mx +ip4:198.54.114.94 +ip4:198.54.116.94 include:spf.web-hosting.com ~all
> ```

`.github/workflows/deploy-site.yml` then runs on every push to main touching
`site/**`: HTML/SEO check job → `production`-environment approval → `wrangler pages
deploy` → health check on `/`, `/en/` and `/sitemap.xml`. Pull requests get their own
preview deployment (commented on the PR) without touching production. After the first
production deploy, submit `https://fitpal.ma/sitemap.xml` in Google Search Console and
Bing Webmaster Tools.
