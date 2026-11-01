# Outbound email templates

Branded HTML email for FitPal Coach: the outreach templates, and the reference markup of the mail
the backend sends.

## Outreach

Three files, same design, one per language:

| File | Language | CTA and footer link to |
|---|---|---|
| `coach-intro-fr.html` | French | `https://fitpal.ma/` |
| `coach-intro-en.html` | English | `https://fitpal.ma/en/` |
| `coach-intro-es.html` | Spanish | `https://fitpal.ma/es/` |

## The sign-in mail (generated, do not edit by hand)

`signin-link-{fr,en,es,de}.html` is the sign-in link mail exactly as the Laravel backend renders
it, for a sample coach "Ahmed", a sample code and a sample link (since CHW-331 the mail is headed
by a 6-digit code, with the link as its button): the app's four languages
(`frontend/src/lib/i18n-core.js`), with `en` the fallback for anything else. It is transactional,
not outreach: sent through Resend, text and HTML parts, in the coach's language. The design is
`E1 Sign-in mail` in the Claude Design project "FitPal Coach R4 screens" (CHW-234); the backend
sends the confirm-new-address and address-changed mails in the same markup.

The source is `backend/resources/views/mail/account.blade.php` and the words are
`backend/app/Mail/MailCopy.php`. `backend/tests/Feature/AccountMailTest.php` fails when these files
and the view drift apart. After changing either on purpose, regenerate them from `backend/`:

    MAIL_REFERENCE_WRITE=1 php artisan test --filter=AccountMailTest

Differences from the outreach templates, all deliberate:

- **The wordmark is gold, not bone**, as E1 has it.
- **The gutters are 24px at every width**: built for a phone first, 600px at most, held at 600 in
  desktop Outlook by an `<!--[if mso]>` table.
- **No web font.** The mail is about signing in, so opening it requests nothing from anyone else.
  Archivo shows where it is installed; the system stack stands in everywhere else.
- **The preheader is the body sentence**, so the inbox preview says what the mail is for rather than
  repeating the wordmark.
- **The confirm mail greets no one** ("Bonjour,"): it goes to an address nobody has proven yet,
  and the name is whatever the account typed.

## Why this folder is not inside `site-coach/`

Because `site-coach/` is the Cloudflare Pages deploy root, and **everything in it is publicly
served**. That is not a matter of configuration — it was tested on a preview deployment on
2026-09-17 and both mechanisms that look like they should work do not:

- **`.assetsignore` is silently ignored** by `wrangler pages deploy`. It is a Workers-assets
  feature. Wrangler uploaded the templates anyway *and* served `.assetsignore` itself as a file
  at `/.assetsignore`.
- **`_redirects` cannot shadow a real file.** Pages resolves static assets *before* consulting
  `_redirects`, so a `/email/* /404.html 404` rule 404s the bare directory while
  `/email/coach-intro-fr.html` keeps serving its contents.

So a file committed under `site-coach/` is public, and there is no way to opt out short of not
putting it there. Hence this directory, one level up.

The same reasoning applies to anything else that is *about* the site without being *part of* it:
press kits, ad copy, sales one-pagers. Keep them out of `site-coach/` and `site/`.

## Sending the outreach templates

These are **templates**, not campaigns. There is no ESP wired up and no tracking pixel.

1. Replace `[Prénom]` / `[First name]` / `[Nombre]`.
2. Replace the first body paragraph with a real observation about the recipient if you have one.
   The generic opener is the weakest part of the email and is the thing that makes it read as a
   template.
3. Paste the source as HTML into your mail client, or load it into whatever is sending.

**Send the plain-text version for genuinely cold first contact.** Branded HTML reads as a
campaign to spam filters and to people: it raises the odds of landing in Gmail's Promotions tab
and lowers reply rate. These templates are for the second touch onward, once the recipient is
expecting to hear from you. If you do send HTML cold, send it `multipart/alternative` with a
plain-text part.

## Design

The palette, type and spacing are copied from `site-coach/styles.css` so the email and the
landing page are recognisably the same product:

| Token | Value | Used for |
|---|---|---|
| `--graphite` | `#1C1A17` | ground |
| `--bone` | `#F2EDE4` | body text |
| `--muted` | `#A9A198` | footer |
| `--gold` | `#D4AF37` | eyebrow, links, CTA fill |
| `--ink` | `#14120F` | text on the CTA |
| `--rule-strong` | `#746C62` | hairlines |

All five text pairs clear WCAG AA (lowest is the footer at 6.81:1); the hairlines clear the 3:1
non-text minimum at 3.36:1. **If you change a colour here, re-check it** — the site has
`scripts/check-site-coach-contrast.mjs` for its own CSS, but it does not read this folder.

Two deliberate email-specific choices, both of which look like omissions and are not:

- **The wordmark is live text, not an image.** Gmail and Outlook block remote images from unknown
  senders by default, so an image-based logo would leave a broken box on first contact. The only
  image is the 2 KB symbol tile at `https://fitpal.ma/icon-180.png`, with empty `alt` so it disappears
  cleanly when blocked rather than leaving placeholder text.
- **The CTA has no Outlook VML fallback.** The button radius is 3px; Outlook rendering it square
  is imperceptible, so the usual `<!--[if mso]><v:roundrect>` block would add fragile markup for
  no visible gain.

Archivo is requested from Google Fonts for the clients that honour web fonts (Apple Mail), with
`'Segoe UI', Roboto, 'Helvetica Neue', Arial` behind it for the ones that do not (Gmail, Outlook).
The fallback is expected and fine — it costs the `wdth` condensation, not the layout.
