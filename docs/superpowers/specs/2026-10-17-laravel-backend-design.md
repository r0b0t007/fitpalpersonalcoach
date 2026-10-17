# FitPal Coach: Laravel backend, SaaS licensing with Creem, Filament admin

Design spec, 2026-10-17. Decided with the owner; executed across Linear milestones R0–R5 in the
"FitPal Coach" project.

## 1. Why

FitPal Coach is a React PWA (`frontend/`) on a single-file Node API (`api/server.js`, 2,585
lines, two dependencies, JSON files under `DATA_DIR`), deployed on a Namecheap cPanel account
under Passenger at `coach.fitpal.ma/api`. The owner wants to sell it as a SaaS: coaches buy a
licence themselves, pay through Creem.io, and onboard without a call; an operator admin built
with FilamentPHP manages coaches and plans.

The owner chose to rewrite the backend in Laravel rather than add licensing to the Node API. The
React frontend and the Capacitor Android shell stay unchanged: the port is a drop-in replacement
behind `/api`.

## 2. Decisions

| Topic | Decision |
|---|---|
| Backend | Laravel 13 (PHP 8.4+: the floor Laravel 13, Pest 5 and Symfony 8 share; the host runs 8.5), `backend/` in this repository. Frontend unchanged. |
| Hosting | The same cPanel account. Composer runs in CI; `vendor/` is rsynced. No supervisor, no Redis. (The account already runs a Laravel app, `~/pawpawcare/backend`, with a cron `schedule:run`.) |
| Database | MySQL/MariaDB in production; SQLite for local development, tests and self-hosters. Media files stay on disk under `DATA_DIR/media`. |
| Auth | Passkeys stay. Existing credentials are imported so nobody re-registers. Coaches give an email at signup; clients stay passkey-only. The owner's Filament login is email + password. |
| Port scope | The gym leftovers are dropped: the timetable (`/api/sessions`, `/api/coach/sessions`, `/api/admin/sessions/*`) and access requests (`/api/access/request`, `/api/admin/requests/*`). 52 routes are ported. |
| Tenancy | One shared instance. A licence is a coach account with a cap on active clients. |
| Tiers | Three, by client cap only, identical features: solo 10, pro 30, studio 75. |
| Billing | Monthly and yearly, EUR: six Creem products. Prices live in Creem's dashboard. 14-day trial, card up front, configured on the Creem product. |
| Lapse | The coach goes read-only: they sign in and see everything but cannot invite, send programs or upload demos. Clients are unaffected. `past_due` keeps full access while Creem retries. |
| Flow | Account first, then pay: `/#/start?plan=pro&period=month` → name + email + passkey → Creem checkout carrying the user id → webhook attaches the licence → Today. |
| Mail | A transactional API (Resend or Postmark), with SPF/DKIM/DMARC records on fitpal.ma in Cloudflare. |
| Admin | Filament 5 panel, owner only: Users, Licences, Invites, Audit, Media, Billing events. |
| Later | Pricing section and "Start" CTA on fitpal.ma, guided first run, in-app plan change beyond the portal, promo codes, purge after lapse. |

## 3. The contract the port must keep

From `frontend/src/lib/api.js`, `lib/server-messages.js`, `lib/push.js`, `public/sw.js`,
`lib/mobile.js` and the Node route table (`api/server.js:1126-2512`):

- Every response is JSON. Errors are `{error: '<English sentence>', msg?: {k, v}}`; the sentence
  is the translation key, so error strings must be byte-identical to today's (em dashes, curly
  quotes included). `msg.k` is a template with `{0}`, `{1}`… and `msg.v` its values.
- Passkey options JSON carries base64url `challenge`, `user.id` and credential ids; the client
  posts `{cid, credential}` back; verify responses set the session cookie.
- `GET /api/data` returns `{state: null}` for a new user; state is an opaque blob returned
  verbatim, so it is stored as raw JSON and never round-tripped through associative arrays
  (`{}` must stay `{}`: `week`, `dayPlan`, `mealDays`, bundle `week`).
- `Cache-Control: no-store` on JSON; media bytes `private, max-age=31536000, immutable`.
- Uploads are raw bodies with metadata in the query string; refusals carry `Connection: close`.
- Polls: members every 15 s, activity every 20 s with a presence TTL of 70 s. The service worker
  never caches `/api`.
- Session token: `uid:expiryMs:sv` + `.` + base64url HMAC-SHA256 keyed with the 64-hex text of
  `DATA_DIR/secret`; cookie `__Host-gymsid` on https, `gymsid` otherwise; the same token as a
  Bearer header is what the paired Android app stores for 90 days. Keeping the scheme means no
  user and no paired phone notices the cutover.
- CSRF: no token. `Sec-Fetch-Site` must be `same-origin` or `none`, else `Origin` must equal
  `ORIGIN`; exempt `register/*`, `login/*`, `pair/redeem`; a Bearer header passes. CORS: reflect
  `Origin`, never credentials; preflight 204 with `Allow-Methods GET,HEAD,POST,PUT,DELETE,OPTIONS`,
  `Allow-Headers Content-Type, Authorization, Range`, `Expose-Headers Content-Range,
  Accept-Ranges, Content-Length`, `Max-Age 86400`.
- WebAuthn: `residentKey: required`, `attestation: none`, `userVerification: preferred`,
  discoverable login by `credential.id`, `userHandle` never checked, counter stored. Credential
  rows today: `{id (base64url), userId, publicKey (base64url COSE), counter, transports[]}`.

## 4. Architecture

### Layout
```
backend/
  app/Http/Middleware/   ReflectOrigin (CORS), NoStore, CsrfOrigin
  app/Auth/TokenGuard    the gymsid HMAC token as a Laravel guard (cookie or Bearer)
  app/Domain/            pure classes ported from api/domain.mjs: Say, Bundle, MediaSniff,
                         Invites, Checkins, Programs, Entitlement, BillingEvents
  app/Http/Controllers/  Auth, Data, Push, Presence, Coach*, Member*, Media*, Admin*, Billing*
  app/Console/Commands/  fitpal:import-legacy, fitpal:remind, fitpal:prune
  app/Filament/          AdminPanelProvider and resources
  database/migrations/
  routes/api.php         no /api prefix: the front controller is mounted at /api (base path)
  tests/Feature|Unit     Pest, SQLite in memory; feature tests named after the smoke sections
```

### Tables
`users` (id string 16 PK, name, email nullable unique, email_verified_at, password nullable,
admin, coach, self_serve, coach_id, disabled, sv, invited_by, last_reminder,
last_checkin_reminder, licence_id, created_at) · `webauthn_credentials` (package table plus
`legacy_cose`) · `user_states` (user_id PK, state LONGTEXT raw JSON, ts) · `coach_programs` (id,
coach_id, name, bundle raw, created, updated) · `invites` (code PK, note, created_by, coach_id,
used_by, used_at, revoked, revoked_at, revoked_reason) · `assignments` (id, coach_id, coach_name,
member_id, bundle raw, note, schedule, status, decided_at, created) · `exercise_media` (id, ex_id,
coach_id, file, label, bytes, mime, status) · `progress_photos` (id, user_id, d, pose, file,
bytes, mime; unique user_id + d + pose) · `push_subscriptions` (user_id, endpoint unique, p256dh,
auth, created) · `presence` (user_id PK, payload JSON, updated_at) · challenge and pairing entries
in the cache table with TTLs · `audit_events` (id, ts, ev, ok, uid, name, tgt, tname, msg, ip) ·
`licences`, `billing_events` (§6) · Laravel `cache`, `jobs`, `failed_jobs`, `sessions` (Filament).

### Request pipeline
`ReflectOrigin` → `NoStore` → `CsrfOrigin` (Laravel's `VerifyCsrfToken` is off for these routes)
→ `auth:token` (`TokenGuard`) → controller. `Say` builds `{error, msg:{k,v}}` exactly like the
Node `json()`; an exception renderer maps `ClientSafe(status, message)` to that envelope and
everything else to `500 {error:'server error'}`. JSON is emitted with `JSON_UNESCAPED_UNICODE |
JSON_UNESCAPED_SLASHES`. The app's base path is `/api`, so `/api/health` works; a fallback route
group also answers the prefix-stripped `/health` in case a proxy strips it.

### Auth
- `TokenGuard`: cookie `__Host-gymsid` then `gymsid` (conflicting duplicates → anonymous), else
  Bearer; verify HMAC against `SESSION_SECRET` (imported from `DATA_DIR/secret`), expiry, user
  exists, not disabled, `sv` matches. `issueToken(user)` and the two Set-Cookie headers as today.
  Pairing codes (8 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 5-minute TTL, one-shot).
- WebAuthn through Laragear WebAuthn 5, shaped to today's four routes with the `cid` round trip
  (a cache challenge repository keyed by `cid`, five minutes, one use). **R0 result (CHW-226):
  go, with three of the package's pipes swapped for ours**, because its defaults contradict the
  contract: `SetResidentKeyConfiguration` forces user verification to "required" when a resident
  key is required (the Node API sent "preferred" and never insisted on the UV bit);
  `AddUserDescriptor` emits `user.id` as a hex UUID (the app base64url-decodes it, and existing
  passkeys hold the ASCII of the 16-character account id as their handle); `CheckCredentialIsForUser`
  demands a UUID handle. `App\WebAuthn\Pipes\{SetResidentKeyRequired, AddUserHandle,
  CheckUserHandle}` replace them; the credential's `user_id` holds the base64url handle. Everything
  else (challenge, attestation parsing, origin and RP checks, signature, counter) is the package's
  code. Proven by a software authenticator (`backend/tools/passkey-sim.mjs`, and
  `tests/Support/Passkey.php` in the suite): a credential registered on the Node API, imported with
  `fitpal:import-legacy` (COSE → PEM in `App\WebAuthn\LegacyCredential`), logs in on Laravel with
  its counter advancing; a fresh registration and login work with the exact JSON the React app
  posts. Registration creates the account inside the ceremony: the options call takes a name and
  answers with a handle for an unsaved user; verify writes the user and the credential together.
- Coach signup: `POST /api/register/options {name, email, coach: true}`, gated by
  `SELF_SERVE_COACH`. The email is stored; verification is a signed link sent through the mail
  API and is not blocking (Creem's receipt goes to the checkout email anyway).
- Filament uses its own `web` guard with email + password; the owner account is created with
  `make:filament-user`; the panel lives under the `/api` mount at `/admin-panel`, restricted to
  `admin = true`.

### Routes ported (52), same paths and shapes
health · config (plus `billing, self_serve, plans, trial_days`) · me · register/options, verify ·
login/options, verify · logout · logout/all · pair/create, redeem · data GET, PUT (16 MB, strips
`active`, raw blob) · push/public-key, subscribe, unsubscribe, test, rest-timer, rest-timer/cancel
· activity · invite GET (plus `full`) · invite/redeem · assignments GET, history, decide ·
coach/members · coach/member · coach/programs GET, save, delete · coach/invites GET (plus `cap,
used, canInvite, reason`), new, revoke · coach/member/release · coach/assign · coach/assignments/
withdraw · media/exercise POST · media/exercises GET (scoped per coach) · media/ex GET, HEAD ·
media/photo POST, GET, HEAD · media/photos GET · admin/users · admin/user · admin/user/disable,
coach, assign-coach · admin/invites GET, new, revoke · admin/audit GET, clear.
New: billing/checkout, webhook, me, portal · admin/licence/grant, revoke.
Dropped: the 11 timetable and access-request routes; `config.request_access` is always `false`.

### Media
Uploads read `php://input` into a temp file while hashing; the first 64 bytes go through the
ported `MediaSniff` (same magic numbers, same `validateUpload` strings); the same caps apply (6 per
exercise per coach, 500 photos or 300 MB per member, `MEDIA_MAX_*`); names are content-addressed
with the uploader prefix; refusals carry `Connection: close`. Serving uses Symfony's
`BinaryFileResponse` (Range, 206/416, HEAD) from a `media` disk rooted at `DATA_DIR/media`; the
three "malformed range → 200 whole file" behaviours are kept by normalising the header first.
PHP limits for 90 MB raw bodies are verified on the host in R0.

### Background work
One cron line runs the scheduler every minute: `fitpal:remind` (day and check-in reminders;
minute granularity matches `reminder.time === hh:mm`), `queue:work database --max-time=55
--sleep=1 --stop-when-empty` with `withoutOverlapping` (rest-timer pushes are delayed jobs,
assignment pushes are jobs), `fitpal:prune` hourly (assignments, audit retention, expired
challenges and presence). Push goes through `minishlink/web-push` with the imported VAPID keys;
404/410 deletes the subscription; private-address endpoints are refused.

## 5. Multi-tenant fix
Demo videos are visible only to the uploading coach and their clients (`mediaVisible`); the
per-exercise cap counts that coach's rows; the stored filename carries the uploader so two coaches'
identical bytes do not collide. Admins see everything and are never counted as tenants.

## 6. Licensing and Creem

- `licences`: `id, user_id, status (pending|trialing|active|past_due|unpaid|paused|canceled|
  expired|manual), plan, period, source (creem|manual), creem_customer_id,
  creem_subscription_id, creem_product_id, checkout_id, request_id, checkout_url, checkout_at,
  trial_ends_at, period_start, period_end, cancel_at, canceled_at, disputed, last_event_id,
  last_event_at`. `billing_events (id, at)` for idempotency, newest 1000 kept.
- `Entitlement::for(user)` → `{status, plan, cap, used, canWrite, canTakeClient, overCap,
  trialEndsAt, periodEnd}`. Rules in order: admin → unlimited, never a tenant · billing off (no
  `CREEM_*`) → `unlicensed`, writable, so self-hosters and tests are unaffected · no licence →
  cap 0, not writable · `canWrite` for trialing, active, past_due, manual, and for canceled while
  `period_end` is in the future · `canTakeClient = canWrite && used < cap` · `overCap = used > cap`
  (after a downgrade: still writable, cannot add).
- `POST /api/billing/checkout {plan, period}`: coach, non-admin (400), billing on (404), valid plan
  and period with a product (400), no writable licence already (409), a pending checkout under
  30 minutes old is reused; otherwise Creem `POST /v1/checkouts` with `request_id`,
  `metadata{userId, plan, period}` and `success_url = ORIGIN + '/'`; the pending row and
  `users.licence_id` are written; returns `{url}`. Provider failure → 502.
- `POST /api/billing/webhook`: raw body; HMAC-SHA256 with `CREEM_WEBHOOK_SECRET` compared with
  `hash_equals`, else 401; duplicate event id → `200 {duplicate: true}`; the user is resolved by
  `metadata.userId`, then subscription id, customer id, `request_id`; none → `200` plus audit
  `billing.orphan`. Event map: trialing/active/paid → writable; past_due → writable;
  unpaid/paused/expired → read-only; canceled keeps `period_end`; scheduled_cancel → `cancel_at`;
  update → plan and period from `product.id`; refund and dispute → audit only. Events older than
  `last_event_at` are recorded but not applied.
- `GET /api/billing/me` → `{entitlement, licence (public fields), plans}`. `POST /api/billing/
  portal` → Creem's customer portal link. Plan changes and cancellation happen in the portal in
  v1. `POST /api/admin/licence/grant {id, plan}` and `revoke {id}` create and remove `manual`
  rows; the existing coach account receives one at cutover.
- Enforcement: `RequireWriter` (402 `your plan is read-only until billing is sorted out — see
  Account › Plan & billing`) on assign, programs/save, media/exercise and invites/new. Cap checks
  at register/options (before the passkey ceremony), register/verify, invite/redeem (409
  `this coach's client list is full ({0}) — ask them to upgrade`) and invites/new (402 `your plan
  allows {0} clients — upgrade to invite more`). Reads stay open. Audit events `billing.*`.
- Environment: `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_API_BASE`, `CREEM_PRODUCTS`
  (`solo:month=prod_…,solo:year=…,pro:month=…,pro:year=…,studio:month=…,studio:year=…`),
  `SELF_SERVE_COACH`.

## 7. Frontend changes (small; every string through `t()` with fr/es/de keys)
`views/Start.jsx` (plan from the query, `Segmented` fallback, name + email + passkey through an
exported `RegisterSheet`, then the checkout redirect) · `lib/billing.js` helpers ·
`lib/checkout-return.js` (`?checkout_id=` before the hash, like `?invite=`) · `store/useStore.js`
`licence` and `loadLicence()` · CoachAccount "Plan & billing" section · CoachToday banner card
(activating, trialing, past_due, lapsed, over_cap) with the post-checkout poll · InviteSheet
at-cap copy · Login `full` copy · the "Request access" form removed. The four screens are designed
first in the Claude Design project "FitPal Coach redesign" (`S4 Start`, `C20 Account Plan and
Billing`, `C21 Today Banners`, `C22 Invite At Cap`) under its CLAUDE.md rules.

## 8. Filament admin (owner only)
Users (filters coach/client/disabled; actions disable, make coach, assign coach, grant manual
licence) · Licences (status, plan, Creem ids, period end; grant/revoke; open the Creem customer)
· Billing events (read-only) · Invites (list, revoke, mint general) · Audit events (filters by
category and outcome) · Exercise media (per coach; delete file and row). Dashboard widgets:
coaches by status, clients per coach against cap, failed payments.

## 9. Data migration
`php artisan fitpal:import-legacy {dataDir}` is idempotent (upsert by id) and runnable against a
copy. It imports users (with `sv` and reminder markers), credentials (COSE → PEM, original kept in
`legacy_cose`), push subscriptions, invites, assignments, media rows, `state-*.json` raw,
`coach-*.json` programs raw, `media-*.json` photos, `audit.log` rows, `vapid.json` and `secret`
into `.env` values. Media files are not moved: the `media` disk points at `DATA_DIR/media`. A
`--verify` mode re-reads every user through the HTTP layer and diffs against the files.

## 10. Testing
Pest unit tests for the ported pure classes (the `domain.test.mjs` cases); feature tests named
after the `coach-smoke.sh` sections so coverage is auditable; a response-shape diff script that
runs the same seeded data through the Node API and the Laravel API; vitest for the new screens;
the existing frontend checks (`check-locales`, `check-source-strings --strict`); the `check-*`
guards re-pointed at `backend/` (error strings, audit labels, adherence window, check-in day).

## 11. Cutover
`deploy-backend.yml` (Composer `--no-dev` in CI, rsync to `~/fitpal-coach-backend/` excluding
`.env` and `storage/`, then `php artisan migrate --force && optimize && storage:link` over SSH,
health check). Rehearsal on a scratch subdomain with a copy of the live `DATA_DIR`. The window:
disable `deploy-api.yml`; final tar of `DATA_DIR`; stop the Node app in cPanel; import; replace
`~/coach.fitpal.ma/api/` with a symlink to `backend/public`; verify an existing passkey, the
paired phone, a client sync, media playback and a push; grant the existing coach a manual
licence; switch Creem to live keys. Rollback: restore the Passenger mount and restart Node; the
files on disk are untouched for seven days. Then retire `api/`, its workflows and CI jobs, and
rewrite the docs (`SELF_HOSTING.md`: PHP 8.4 with SQLite or MySQL and one cron line;
`DEPLOY_COACH_SUBDOMAIN.md`; `CLAUDE.md`). The MCP server, which reads the JSON files, needs a
database adapter before it works again; it is not deployed.

## 12. Risks
The WebAuthn import is the largest unknown and is settled first (R0). Shared-hosting limits (raw
90 MB POST bodies, LVE caps on a near-continuous queue worker, one-minute cron) are measured in
R0; the fallback for rest-timer pushes is a client-side timer with a local notification. Error
strings must stay byte-identical; a PHP-aware guard and verbatim assertions hold that. Node and
Laravel must never run against the same data; the cutover stops Node first. Mail DNS must be live
before coach signup goes public. The self-hosting promise changes and the docs say so. The
marketing copy ("your own instance", "price on the call") contradicts the SaaS until the pricing
section ships.
