# FitPal Coach for Instagram coaches: one link in the bio

Design spec, 2026-11-01. Decided with the owner. It will be carried out in three Linear milestones
in the "FitPal Coach" project: M-A (redesign, in Claude Design), M-B (the build) and M-C
(go-to-market). The funnel and promotion plan is in `docs/growth/2026-11-funnel-and-promotion.md`.

## 1. Why

FitPal Coach was built for one solo trainer at a time, each onboarded by a WhatsApp call. The
buyer is now the **independent Instagram coach** in the francophone countries (Morocco, France,
Belgium) and Spain. That coach puts **one link in their bio**. A follower taps it, asks to train
with them, and is training in the app the same day. The coach collects money their own way.

The product can't do that today. A code check on 2026-11-01 found:

- **There is no link that can go in a bio.** Every invite (`?invite=<16hex>`, made by
  `Invite::mint`) works once and is made per person. At most 20 can be open, and
  `InviteGate::redeemable` marks a link spent once it has been used.
- **There is no public coach page.** A follower sees a logo and "{coach} invited you to train
  with them" (`views/Login.jsx`). `GET /api/invite` returns only `{coachName, full}`.
- **Clients can only sign up with a passkey,** and passkeys often fail inside Instagram's in-app
  browser. Nothing tells the follower to open Safari or Chrome: `lib/install.js:32` detects the
  web view only to change the install hint. `LoginLinkController` refuses anyone who isn't a coach.
- **The app is empty after joining.** The home screen says "{coach} is preparing your program"
  until the coach sends a program and the client accepts it.
- **The coach never hears anything.** Pushes go only to clients (`app/Push/Messages.php`). There
  is no messaging, no intake form, and the coach can't reply to a check-in.
- **Coaches can't sign up on their own.** `SELF_SERVE_COACH=0`, and checkout is still in Creem
  test mode (CHW-302). There is no free plan.
- **The client app carries all of openGym's power-user tracker:** progression-rule configuration,
  Greyskull LP, the recovery model, the 1,324-exercise library, imports, MCP pairing, and routine
  editing that overrides what the coach sent. That suits the coach's own authoring but is noise
  for a coached client.

## 2. Decisions

| Topic | Decision |
|---|---|
| Client payments | **Join only.** The coach collects money their own way (transfer, cash, CashPlus, their own Stripe). FitPal does not take a cut or hold money. |
| Join model | One reusable public link, then an intake, then a **request**. The coach taps **Accept**. No seat is used until then. Each coach can switch on auto-accept. |
| Client sign-in | **A 6-digit code by email** is the main path, with a link in the same mail as a backup. A passkey is offered afterwards as a faster sign-in. Inside Instagram, a prompt says to open the page in the browser. |
| Messaging | The coach **replies to a check-in** and **comments on a logged workout**, and the client is told by push, or by email if they have no push. A one-tap **WhatsApp** button covers everything else. No full chat. |
| Pricing | **Free for up to 3 clients**, no card. Above that, the existing tiers: Solo 10, Pro 30, Studio 75 clients at €19, €39 and €79 a month. The 14-day trial is dropped, because Free replaces it. |
| Market | Francophone countries (Morocco, France, Belgium) and Spain from the start. French is the lead language, with Spanish alongside; Darija only in marketing copy. |
| Redesign | All four surfaces: the coach's link page and join flow, the client app, the coach app, and fitpal.ma. Done in Claude Design with **Unsplash** photos. |
| Features cut for clients | **Hidden behind a `coached` flag, not deleted.** "Train myself", users without a coach, and the coach's own program editing all keep them. |

### What each decision costs, from the code check

1. **Free signup can't wait for Creem to go live.** `coachOptions` refuses self-serve signup unless
   `Plans::billingOn()`. That guard stays, because without it an instance with Creem off would
   give out coach accounts with no limit. A `FREE_CAP` (default 3) is enforced even with billing
   off, so Free signup can open before CHW-302. A paying coach who lapses drops to Free (can still
   edit, can't add a fourth client) instead of becoming read-only.
2. **Clients stop being passkey-only.** Client security becomes "whoever controls the inbox".
   `SECURITY.md` must say so.
3. **The emailed code beats the emailed link.** Tapping a link opens Safari or Chrome, which
   don't share cookies with Instagram's browser, so the follower would be signed in in the wrong
   place. Typing the code keeps them where they started. Passkeys and iOS web push work poorly or
   not at all inside the Instagram web view, and iOS push only works once the PWA is installed. So
   every "the client is told by push" also needs an email fallback.
4. **The server doesn't write a client's state.** `DataController` sends back exactly the bytes the
   app saved. A starter program therefore travels as an `Assignment` marked `auto`, and the client
   app applies it itself.
5. **Coach replies can't live in `S`.** The client's state is one blob where the last write wins,
   so a reply stored there would be overwritten. Replies get their own table.
6. **The docroot `.htaccess` exists only on the server** (it is excluded from rsync). The pretty
   URL needs one rewrite line added there by hand, and it must be recorded in
   `docs/DEPLOY_COACH_SUBDOMAIN.md`.
7. **The intake collects health data.** Injuries are special-category data under GDPR art. 9
   (France, Spain, Belgium). In Morocco, law 09-08 applies and processing must be declared to
   the CNDP (this ties into CHW-58's work). This needs an explicit consent checkbox, a retention
   rule, an update to the legal pages, and `Tenancy\Detach` must wipe the intake when a client
   is released.
8. **Scheduled jobs run every 5 minutes** (CHW-311). A "new request" push can arrive up to about
   5 minutes late. A scheduled command sends its mail synchronously, so batches stay small.

## 3. The flow

```
Instagram bio ── coach.fitpal.ma/c/<handle>    Laravel page: OG tags, coach card
                       │ location.replace
                       ▼
                /#/join/<handle>               React: intake → email → 6-digit code
                       │ POST /api/join/start, /api/join/verify
                       ▼
                join_requests (pending)  ──►  coach: push + email "New request"
                       │ coach taps Accept (or auto-accept)
                       ▼
          CoachLock + CoachSeat check  ──►  coach_id set, seat used
                       │ starter program as an auto Assignment
                       ▼
             Client Home: "Workout 1 · today"  ──►  first set logged (activation)
```

### 3.1 URL: `https://coach.fitpal.ma/c/<handle>`, rendered by Laravel

- **Why this origin:** the page is on the same origin as the app, so passkeys, the session cookie
  and the email-code session all live on coach.fitpal.ma. There is no second hostname and no
  redirect hop inside Instagram's browser.
- **Why server-rendered:** link previews in Instagram and WhatsApp need per-coach Open Graph tags
  in the server's HTML, which a `HashRouter` app can't produce.
- **How it's served:** `PublicPageController@show` (Blade) answers at `/api/c/{handle}`, which
  works without touching the server. The docroot `.htaccess` gets
  `RewriteRule ^c/([a-z0-9._]{3,30})/?$ /api/c/$1 [L]` for the short form.
- **What the page holds:** the OG tags, a small coach card in the language from
  `Accept-Language`, then `location.replace('/#/join/<handle>')`, with a `<noscript>` link as a
  fallback. Everything interactive stays in the React app and uses the existing `t()` packs.
- **Rejected:**
  - `fitpal.ma/@handle` would add a cross-site hop and split the brand across two origins.
  - A plain app route can't produce link previews.
- **Before launch:** check that Cloudflare Bot Fight Mode lets `facebookexternalhit` through.

### 3.2 Abuse limits on the public form

- **Throttles:** copy the three buckets in `LoginLinkController` (per email, per IP, per peer).
- **Bots:** a honeypot field and a minimum fill time of about 3 s. Both fail silently: the form
  answers `{ok:true}`.
- **Code attempts:** at most 5, and a code expires after 15 minutes.
- **Pending requests:** at most one per person per coach, and a cap per coach.
- **CAPTCHA (optional):** Cloudflare Turnstile, checked over HTTP so no new package is needed.
- **Pruning:** `fitpal:prune` deletes unverified requests after 24 hours and declined ones after
  30 days.

## 4. Keep, add, remove

| Area | Keep | Add | Remove or hide for coached clients |
|---|---|---|---|
| Joining | Seat caps, the coach lock on accept, releasing a client | The public page, intake with consent, the requests inbox, auto-accept, a starter program | Single-use invites stay, but only as "private invite" |
| Sign-in | Passkeys, offered after the first sign-in | The email code for clients, the in-app-browser prompt | Passkey as the *only* client path |
| Client app | Today's workout, logging, history, check-ins, photos, macros, Stats panels | Coach notes on check-ins and workouts, the WhatsApp button, "Workout 1 · today" | Routine editing, starter plans, imports and backup restore, MCP pairing, progression rules, the recovery, muscle-balance and effort panels, browsing the library and the muscles explorer, equipment and plates, combining routines, day overrides |
| Coach app | Today (attention list), Clients, Programs, the ClientDetail tabs | The Requests card and inbox, the public-page editor and share kit, replies, the daily digest and pushes | — |
| Pricing | Solo, Pro and Studio at €19, €39 and €79 | Free (3 clients, no card) | The 14-day trial |
| fitpal.ma | The brand, the legal pages, FR/EN/ES | The "one link" pitch, a "Start free" CTA pointing at `#/start?plan=free`, a demo video | "Book a call" as the only CTA; the spec-sheet bragging (Greyskull, 1,324 exercises); the FAQ line "no account to create", which is false |

## 5. Build phases (M-B)

Each phase ships on its own. They are ordered by how much each moves the funnel.

| # | Phase | Main pieces, and what they reuse |
|---|---|---|
| 1 | Free plan and card-less self-serve | `Plans::FREE_CAP`; `Entitlement::for` returns `free` (cap 3, writable); `Plans::offered()` lists Free first; `Start.jsx` accepts `?plan=free` and skips checkout; Free added to the `billing.jsx` PlanPicker; trial dropped |
| 2 | Public page, intake, email code, requests inbox | Tables `coach_pages` (handle, bio, whatsapp, open, auto_accept, starter_program_id) and `join_requests` (email, name, intake JSON, status); `login_links.code_hash`/`attempts`; `POST /api/join/start` and `/api/join/verify`; accept copies `InviteController::redeem` (`CoachLock::take`, then `CoachSeat::refusal(lock:true)`); `views/Join.jsx`, `lib/join.js`, `lib/inapp.js`, `views/coach/Requests.jsx`, `views/coach/PublicPage.jsx`, a code variant of `email/signin-link-*` |
| 3 | Starter program and auto-accept | `assignments.auto`; reuse `AssignmentController` and `PlanBundle`; a pure helper `lib/starter-accept.js` `applyStarter(S, bundle, today)` with its test (CONTRIBUTING rule), reusing the offer-apply code in `views/coach/sheets.jsx` |
| 4 | Simplified app for coached clients | `lib/features.js`, where `coached` is true for a client who has a coach and isn't a coach; it gates routes (`/library`, `/muscles`), makes Plan read-only, and trims Settings, Home and the StatsPanels (which stay prop-driven) |
| 5 | Coach pushes and daily digest | Derived `last_checkin` and `last_workout` in `UserState::derived`; a push when a coached client adds a check-in; `fitpal:coach-digest`, `dailyAt('07:00')` on the 5-minute tick; reuse `MemberCard::adherenceParts` and `checkinOverdue`; `users.last_digest` keeps it to one per day |
| 6 | Replies and WhatsApp | Table `coach_notes` (ref_type `checkin` or `workout`, ref_key, body of 1,000 characters at most, read_at); `Messages::coachNote` push, with at most one email a day as fallback; `lib/whatsapp.js` |

**Rules for every phase:**
- Every string goes through `t()`, with entries in all four packs.
- API error keys must pass `check-error-strings.mjs`. A message with a value in it is a `Say::f`
  template, for example `your plan allows {0} clients — upgrade to accept more`.
- New audit events (`coach.signup`, `join.request`, `join.verify`, `coach.request.accept`,
  `coach.request.decline`, `coach.request.auto`, `coach.page.save`, `login.code`,
  `coach.note.create`) get labels in `lib/audit.js`, and the floors are raised.
- `CrossTenantTest` and `TenancyTest` cover every new table.
- The public Blade page escapes the coach's bio, and a closed page answers 404.
- Each phase goes through writing-plans, then TDD, then a PR, then CI (`test.yml`).

CHW-302 (billing live) comes after phase 1 and no longer blocks coaches from signing up.

## 6. Redesign (M-A)

The Claude Design project is "FitPal Coach — Creator redesign". It starts from the existing
"FitPal Coach Design System" project, `DESIGN.md`, `PRODUCT.md` and `frontend/src/index.css`.

| Page | What it shows |
|---|---|
| `00-direction.html` | Two brand directions, an evolved gold-on-graphite "equipped pro" and a brighter creator-facing variant, plus the rules for type, colour and photos, and the Unsplash credits. The owner picks one. |
| `01-link-and-join.html` | The coach's page, the intake, email and code, the "open in browser" prompt, "request sent", and "accepted: workout 1 today". In French, with Spanish variants. |
| `02-client-app.html` | Today, workout logging, progress, the Coach tab (notes, WhatsApp), and the simplified You/Settings. |
| `03-coach-app.html` | Today with the Requests card, the inbox with the intake sheet, the page editor, the share kit, ClientDetail with replies, Programs, and Account/plan (Free badge, upgrade prompt at the cap). |
| `04-fitpal-ma.html` | The marketing site: hero, three steps, pricing, FAQ, "Start free". Desktop and mobile. |
| `05-instagram-kit.html` | Story and post templates and a QR card that coaches use to announce their link, carrying a "Coaché avec FitPal" mark. |

The photos are hotlinked from `images.unsplash.com` in the mock-ups and self-hosted in production;
the Unsplash licence allows both. No photo may suggest that a real person endorses FitPal.

## 7. Funnel metrics

Counted from `audit_events` and shown in a Filament widget. Nothing new is added to the app's
dependencies.

- **Coach:** signs up for Free, publishes a page, gets a first request, accepts a first client,
  that client logs workout 1 (**activation**, target within 7 days), 3 or more clients are
  training weekly at day 30, and the coach pays (hits the 3-client cap).
- **Follower:** views the page, sends a request, verifies the code, is accepted, and logs a first
  set. The time from first tap to first logged set is tracked.

## Appendix A: Competitors (researched 2026-11-01)

Prices come from vendor pages where marked as official, otherwise from third-party comparison
sites (marked 3P). Capterra and G2 refused the research agent (403), so complaints come from
search snippets, Trustpilot, and one analysis of App Store reviews.

| Competitor | Entry price / free plan | How clients join | Payments | Notes |
|---|---|---|---|---|
| ABC Trainerize | Free for 1 client; $9/mo for 2; Pro from $23/mo for 5 (official) | Trainerize.me public profile | Stripe add-on, $10/mo | Nutrition ($20–45), video and "Business" are paid add-ons |
| TrueCoach | ~$26–30/mo for 5 clients, no free plan (3P) | Public Coach Profile (Standard plan) | Stripe | 3,000+ exercise videos; reportedly can't build a workout on mobile |
| Everfit | **Free for 5 clients**; Pro $19/mo (official) | Packages, then an onboarding flow and Autoflow | Payments add-on from $9/mo | Autoflow add-on $29 per 30 clients; big price jumps between tiers |
| Kahunas | $35/mo (official) | **A shareable packages link**: sign up and pay, and the app stays locked until paid | Stripe or PayPal | Lead forms with email drips; $49 for each referred coach |
| Harbiz (Spain) | €14–19/mo for 5 (3P) | A purchase starts the program, a form, a welcome message and tags | Stripe; payments made outside can be recorded | Spain's incumbent; a standalone app costs €149–199/mo |
| PT Distinction | $19.90/mo for 3 clients (3P) | Forms | Built in | Has a learning curve |
| My PT Hub | ~€59/mo, unlimited clients (3P) | Invite | Built in | One flat price |
| Hevy Coach | ~$25/mo for 10 (3P) | Invite into the Hevy app | **None** | Strong logging UX |
| FitBudd | $15/mo for 2; branded app and site $79 (3P) | Branded site and checkout | Stripe, PayPal | Closest to "branded app plus storefront" |
| Stan Store | $29 / $99 a month | **The bio link is the store** | Built in | No workout delivery; pays referrers 20% recurring |
| Wazen (MENA) | Free for 5; $49 for 20 (official) | Public profile | — | Arabic with right-to-left layout; UAE/GCC |
| France | Hexfit €19–29, AZEOO €9, Fit'Distance €13 for 5 (3P) | — | — | French-language competitors |

**What every competitor has:** a program builder with templates, exercise videos, a logging app,
1:1 chat, check-in forms, progress photos, macros, an adherence dashboard, payments (Stripe), and
a free plan or trial.

**What wins solo creator-coaches:**
- A public page that converts.
- Fulfilment that happens by itself the moment someone joins (Harbiz, Everfit Autoflow).
- Challenges and group programs.
- Referral payouts.

**Where competitors fall short, which is our pitch:**
- Add-ons pile up on top of the base price.
- Client apps that crash or lose logged sets. These were 35% of critical App Store reviews across
  10 apps ([Coachway](https://coachway.io/articles/what-clients-say-about-coaching-apps/)).
- Clunky interfaces (Trainerize has a 3.5 TrustScore).
- No tool is French- or Darija-first.
- They take payments only through Stripe, which reportedly doesn't onboard companies registered
  in Morocco ([Kolonell](https://kolonell.com/fr/blog/paiement-en-ligne-pme-maroc-cmi-ou-stripe-2026)).
- Branded apps cost €149 a month or more.

**Sources:**
- Official pages: [Trainerize pricing](https://www.trainerize.com/pricing/),
  [TrueCoach pricing](https://truecoach.co/pricing/),
  [Everfit pricing](https://everfit.io/pricing),
  [Kahunas prices](https://help.kahunas.io/en/articles/214-what-are-the-prices-for-your-packages),
  [Kahunas payment link](https://help.kahunas.io/en/articles/24-can-i-send-clients-a-payment-link).
- Harbiz help pages:
  [Harbiz automations](https://intercom.help/harbiz-help/es/articles/9367418-automatizaciones-en-planes-de-suscripcion-y-productos-de-pago),
  [Harbiz external payments](https://intercom.help/harbiz-help/es/articles/10546966-como-registrar-pagos-externos-sin-stripe).
- Everfit help: [Everfit onboarding flow](https://help.everfit.io/en/articles/9651985-how-to-add-an-onboarding-flow-to-a-package).
- Other products: [TrueCoach public profiles](https://truecoach.co/features/public-profiles/),
  [Wazen](https://wazen.fit/).
- Third-party comparisons: [Coachway FR](https://coachway.io/fr/logiciel-coach-sportif/),
  [promealplan](https://www.promealplan.com/fr/blog/meilleur-logiciel-coachs-sportifs),
  [FitBudd on Everfit](https://www.fitbudd.com/insights/everfit-pricing-calculate-your-true-costs-in-2026).
- Reviews: [Trustpilot Trainerize](https://ie.trustpilot.com/review/trainerize.com).

## Appendix B: How Instagram coaches sell, and what they charge

**How the sale works:** a Reel or TikTok, then "comment KEYWORD", then an automatic DM, then a
link (Linktree, Stan, or WhatsApp). The program is delivered as a PDF or a Google Sheet over
WhatsApp. Coaches juggle about four tools for each check-in
([QuickCoach](https://www.quickcoach.fit/move-coaching-off-spreadsheets.html)).

**What coaches charge their clients:**
- **France:** €30–60 a month for a program with messaging, €80–150 with nutrition and check-ins
  ([coachway FR](https://coachway.io/fr/combien-coute-un-coach-sportif-en-ligne/)).
- **Spain:** €50–150 a month ([FitGeneration](https://fitgeneration.es/cuanto-vale-un-entrenador-personal-al-mes/)).
- **Morocco:** no published data. The estimate is 300–800 MAD a month, to be checked by
  mystery-shopping in M-C.

**Morocco:**
- 15.1M people use Instagram and 16.7M use TikTok
  ([MWN/DataReportal](https://www.moroccoworldnews.com/2025/11/267078/morocco-2026-digital-report-92-of-the-population-now-online/)).
- 75% of the population uses WhatsApp ([Hespress](https://fr.hespress.com/429594-429594.html)).
- An estimated 50–90% of e-commerce is still paid cash on delivery.
- There were about 60,000 content creators in 2023, 63% of them under 100k followers
  ([TelQuel](https://telquel.ma/2023/02/24/influence-les-dessous-dun-business-en-or-massif_1802566)).
