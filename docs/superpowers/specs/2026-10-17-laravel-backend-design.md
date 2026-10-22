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
| Auth | Passkeys stay. Existing credentials are imported so nobody re-registers. Coaches give an email at signup and can also **sign in by magic link** (§4a) — the recovery path when a passkey is lost; an account may hold several passkeys. Clients stay passkey-only via invite links. No passwords anywhere but the owner's Filament login (email + password). |
| Tenancy enforcement | Structural, not per route (§5): a request-scoped coach context, a global scope on every tenant-owned model, policies for the one-off checks, and a cross-tenant test that walks every coach route. |
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
`users` (id string 16 PK, name, email nullable unique, email_verified_at, pending_email, password nullable,
admin, coach, self_serve, coach_id, disabled, sv, invited_by, last_reminder,
last_checkin_reminder, licence_id, created_at) · `webauthn_credentials` (package table plus
`legacy_cose`) · `login_links` (id, user_id, token_hash, created_at, expires_at, used_at, ip;
§4a) · `user_states` (user_id PK, state LONGTEXT raw JSON, ts) · `coach_programs` (id,
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
- Coach signup: `POST /api/register/options {name, email, coach: true, lang?}`, gated by
  `SELF_SERVE_COACH` **and billing on** (403 `coach sign-up is not open on this server`; with no
  Creem every coach is unlicensed and unlimited, which would open an invite-only instance to
  anyone — `check-config` warns). It opens sign-up without an invite even when `INVITE_ONLY`. The
  address is normalised, refused only when malformed (400), and **not** written to `email`: it
  waits in `pending_email`, and the account's first mail is the link that confirms it (§4a), as
  changing it does — so nothing unconfirmed blocks the address's real owner (whoever confirms
  first has it), and sign-up never says an address is taken (opening the link, which only its
  inbox can, refuses it with the email-change 409). 10 coach sign-ups an hour per client, 100 per
  connection (the forwarded address can be forged), counted after validation. Verify writes
  `coach` and `self_serve`, no licence (read-only until the checkout), never admin; self-serve
  accounts do not count against the bootstrap code (a stranger signing up first must not kill
  it). The mail is in `lang` (no saved language yet), sent after the response, never blocking.
- Filament (5, on Livewire 4) uses its own `web` guard with email + password; the owner's email and
  password are set on the existing admin account with `php artisan fitpal:panel-login <id>`
  (`make:filament-user` would create a new account, with an id this table cannot take); the panel
  lives under the `/api` mount at `/admin-panel`, restricted to admins (`User::canAccessPanel`).
  Its actions are the admin API's own code (`App\Admin\Accounts`), audited the same. Livewire 4
  serves its endpoints under `livewire-<8 hex of APP_KEY>`, which `App\Http\Request::isJsonApi`
  and the exception renderers treat as the panel's, not the JSON API's.

### 4a. Coach sign-in by email (magic link) — R4
Passkeys are the primary sign-in and the only one for clients. A coach also has an email, and
with it a second way in that doubles as recovery: a new laptop, a reset phone or a cleared
browser must not be a support ticket to the owner. Decided 2026-10-17; no passwords.

- **Request.** `POST /api/login/email {email}` always answers `200 {ok: true}` — unknown address,
  a client's address, a disabled account and a throttled caller all look the same, so the route
  cannot be used to enumerate accounts. When the address belongs to a coach (or admin) a link
  `ORIGIN/#/link?t=<token>` is mailed. Rate limits through `RateLimiter`: 3 per email per 15 min,
  10 per IP per hour; a refusal is audited as `login.link.throttled`, still `200`.
- **Token.** 32 random bytes, base64url in the link, SHA-256 in `login_links.token_hash`.
  15-minute expiry, single use; issuing a new one marks the older unused ones for that user as
  used. Nothing of the token is logged. `fitpal:prune` deletes rows older than 24 hours (the
  route is unauthenticated, and the `ip` column is personal data that must not accumulate).
- **Redeem.** `POST /api/login/link {t}`: hash, find, require unused and unexpired and the user
  not disabled → mark used, set `email_verified_at` if null, issue the session exactly as a
  passkey login does (`SessionToken::cookies`, same `sv` rules), audit `login.link`. Refusals,
  both translation keys: `400 'this sign-in link has expired — request a new one'`, `400 'this
  sign-in link was already used'`.
- **Second passkey.** After a link login on a device with no passkey for the account, the app
  offers to add one: `POST /api/passkeys/options` and `/passkeys/verify` under `auth:api`, the
  registration ceremony against the signed-in user (same pipes, `uniqueCredentials` on). One
  account, several passkeys; the model already allows it.
- **Signup is unchanged** (`/#/start`: name + email + passkey). The verification mail *is* the
  first magic link, so verifying the address and proving it signs in are one action.
- **Changing the address** must not be a takeover primitive: anyone holding a live session (a
  shared laptop, a paired phone's Bearer) could otherwise point the account at their own inbox and
  gain permanent recovery access. So `POST /api/account/email {email}` writes `users.pending_email`
  only and mails a link to the **new** address; `login/email` matches `users.email` alone, never
  the pending one; redeeming that link moves `pending_email` into `email`, sets
  `email_verified_at`, clears the pending column and sends a notice to the **old** address
  ("your sign-in email was changed; if that was not you, …"). The audit event is `account.email`.
- **CSRF.** `login/email` joins `CsrfOrigin::EXEMPT` (see "A recent sign-in" below for why
  `login/link` does not). **Mail.** One branded template under `email/` (text and HTML) in **fr, en, es and de**,
  falling back to `en`, in the language the app itself uses: `user_states.state->lang`, read the
  way the push code already reads it (`api/server.js` `readState(uid)?.lang`) — not a new column,
  which would go stale the first time the coach changes language in Settings. Sent through the
  transactional API of §2.
- **As built (CHW-233).** One `login_links` table for both kinds (`purpose` login|email, the new
  address in `email`). The mail is sent after the response (`defer()`), not queued: the reply is
  the same and as fast for any address, the link leaves at once, and no token sits in `jobs`. A
  link to a coach demoted since is refused as expired; a disabled account gets 403 and the link
  stays unspent. Opening an email-change link swaps the address and answers `{ok, email}` — it does
  not sign anyone in — and only if the address is still the pending one and no other account's
  (409 `that email address is already used by another account`, checked at request too). Mail
  copy in fr/en/es/de is provisional until E1; Resend and the DNS are CHW-271.
- **A recent sign-in for the lasting writes (#138 review).** Pending-plus-notice alone still let
  anyone holding a session move recovery to an inbox they control, or plant a passkey that
  survives `logout/all`. So `account/email` and `passkeys/options|verify` need a session that
  signed in within 15 minutes by a passkey, an email link or the sign-up (`FreshAuth`, by the
  token's hash; pairing does not count, it would launder an old session); otherwise 403 `sign in
  again to do this — it needs a recent sign-in`. Issuing a link no longer spends the older ones
  (a stranger asking for a coach's links must not spend the one in their inbox); using one spends
  the rest, and confirming a new address spends every unused link. Only a confirmed address
  blocks another account's change, and only when its link is opened (the request answers the same
  either way, so it looks nothing up). The per-IP limit keys on the client (`CF-Connecting-IP`),
  with a generous per-connection limit beside it, since that header can be forged by a caller
  reaching the server directly; throttle audit rows are capped at 20 an hour. Only `login/email` is
  CSRF-exempt (the phone app's WebView); `login/link` is redeemed on ORIGIN, and exempting it
  would allow login CSRF. `login_links.ip` follows AUDIT_IP.
- **Tests.** Issuance is silent for unknown and client addresses; single use; expiry; throttling;
  disabled account refused; the link login sets the same cookie and dies with `logout/all` like
  any token; a second passkey attaches and either one logs in; a pending address cannot request a
  link; redeeming the change link swaps the address and notifies the old one.

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
New: billing/checkout, webhook, me, portal · admin/licence/grant, revoke · login/email, login/link
· passkeys/options, verify · account/email (§4a).
Dropped: the 11 timetable and access-request routes; `config.request_access` is always `false`.

### Media
Uploads read `php://input` into a temp file while hashing; the first 64 bytes go through the
ported `MediaSniff` (same magic numbers, same `validateUpload` strings); the same caps apply (6 per
exercise per coach, 500 photos or 300 MB per member, `MEDIA_MAX_*`); names are content-addressed
with the uploader prefix; refusals carry `Connection: close`. Serving uses Symfony's
`BinaryFileResponse` (Range, 206/416, HEAD) from a `media` disk rooted at `DATA_DIR/media`; the
three "malformed range → 200 whole file" behaviours are kept by normalising the header first.
PHP limits for 90 MB raw bodies are verified on the host in R0 (CHW-227): the origin takes 95 MB
byte-exact. **Cloudflare is the binding limit**: it refuses bodies over 100 MB and answers `524`
when a request is not fully sent and answered within about 100 s (a throttled upload, measured).
So video uploads are **chunked** in R3 — each chunk small enough to finish well inside 100 s on a
weak mobile uplink, the server appending and hashing as chunks arrive, the existing sniff and caps
applied to the assembled file — and `MEDIA_MAX_VIDEO_MB` stays below 100. Details in
`docs/DEPLOY_COACH_SUBDOMAIN.md` → "Laravel backend".

### Background work
One cron line runs the scheduler every minute: `fitpal:remind` (day and check-in reminders;
minute granularity matches `reminder.time === hh:mm`), `queue:work database --max-time=55
--sleep=1 --stop-when-empty` with `withoutOverlapping` (rest-timer pushes are delayed jobs,
assignment pushes are jobs), `fitpal:prune` hourly (assignments, audit retention, expired
challenges and presence, `login_links` older than 24 hours). Push goes through `minishlink/web-push` with the imported VAPID keys;
404/410 deletes the subscription; private-address endpoints are refused.

## 5. Tenancy — by construction, not by route (R2)

One shared instance; the tenant is a coach account (`users.coach = true`). Every tenant-owned row
carries `coach_id`: `users` (the clients), `invites`, `assignments`, `coach_programs`,
`exercise_media`. `progress_photos` and `user_states` belong to the *client* and are reached
through them. Admins see everything and are never a tenant.

The Node API kept this boundary by hand inside each route (`requireCoach` + `canCoachMember`,
`db.invites.filter(i => i.coachId === coach.id)`, `a.coachId !== coach.id → 404`, `mediaVisible`)
and the smoke suite checks it route by route. A hand-written filter is exactly what the next route
forgets, so the port makes the boundary structural, in three layers that are each tested alone:

1. **Who is acting.** `RequireCoach` middleware (401 `not signed in`, 403 `forbidden`, as today)
   then sets the request's `CoachContext` to that user — **an admin on a coach route included**:
   the Node API scopes an admin's invites, programs, assignments and media to the admin's own id
   (`requireCoach` admits them, the filters use `coach.id`), and the smoke suite pins it ("an
   admin's own code must NOT bind anyone", "listing is scoped to the coach, not the gym"). Only
   `RequireAdmin` routes, the Filament panel, the scheduler and the import run with no context.
2. **What queries see.** Trait `OwnedByCoach` on the **four** tenant-owned models — `Invite`,
   `Assignment`, `CoachProgram`, `ExerciseMedia` — a global scope adding `where coach_id =
   <context coach>` whenever a context is set, and a `creating` hook filling `coach_id` from it so
   a controller cannot forget it. No context → unscoped. `User` does **not** carry the trait
   (coaches and admins are users; `/me`, the acting coach's own row and the admin's user list must
   not be filtered): clients are read through `User::clientsOf(User $coach)`, which takes the
   coach **explicitly** rather than from the context, because the licence cap's `used` is counted
   where no context exists — `invite/redeem` (a client acting), `register/*` (anonymous), the
   Creem webhook, `admin/licence/grant`, the Filament widget, `fitpal:remind`. Controllers never
   write `where('coach_id', …)` by hand.
3. **What a route may touch.** Policies for the checks that are not a plain filter:
   `canCoachMember` (own and not disabled; admin any — the one place an admin sees across
   tenants), reading a client's photos (the client, their coach, admin), releasing a member.

**The answer table, as the Node API gives it and the smoke suite pins it:**

| Asked for | Not theirs | Theirs but missing |
|---|---|---|
| a member (`coach/member`, release, photos) — policy | **403 `forbidden`**, same as unknown id: no enumeration of the membership | 403 |
| an invite, assignment, program (scoped rows) | **404** (`no such code`, `no such assignment`, …): the scoped query simply does not find it | 404 |
| a list (`coach/members`, `coach/invites`, `coach/programs`, `media/exercises` as coach) | the other coach's rows are absent | — |

**Demo media — the one deliberate change of behaviour in this section.** Today `GET
/api/media/exercises` hands every row to any signed-in member, on purpose (one gym, one library).
With several coaches on one instance that is a leak, so: a coach (or admin on the coach route)
sees their own rows; **a client sees the rows whose `coach_id` is their own `coach_id`** (a client
with no coach sees none); `RequireAdmin` sees all. The same rule gates the bytes (`media/ex`)
through a policy, since the client request has no coach context for the scope to use. The
per-exercise cap counts the uploading coach's rows; the stored filename carries the uploader so
two coaches' identical bytes do not collide. This is new behaviour with a new feature test, not a
smoke port.

Database: `coach_id` columns are foreign keys to `users.id` (`set null` for clients and invites,
`cascade` for programs, assignments and media rows; the file prune is the scheduler's), with
composite indexes `(coach_id, created)` where lists are read.

Tests that make it hold: a shared Pest fixture `twoCoaches()` (coach A with clients a1 and a2,
coach B with b1, an unassigned u1, a disabled d1, and an admin) used by every coaching feature
test; a `CrossTenantTest` that walks every coach route with A's token asking for B's ids and
asserts the answer table above, then the same with the admin's token on the coach routes
(scoped to the admin's own id, member reads excepted); a reflection test that every model whose
table has a `coach_id` column uses `OwnedByCoach`, with `users` as the one explicit exception,
so a new model cannot opt out silently; the ported smoke sections by their real names ("role
gating", "roster scoping", "reading a member", "an admin's own code must NOT bind anyone",
"listing is scoped to the coach, not the gym", "revoking is scoped too, and says nothing about
what it will not touch", "progress photos: who may read the bytes", "media list"); and two new
tests the smoke suite never had: a coach's program library is theirs alone, and a client sees only
their coach's demo media.

## 6. Licensing and Creem

- `licences`: `id, user_id, status (pending|trialing|active|past_due|unpaid|paused|canceled|
  expired|manual|revoked), plan, period, source (creem|manual), creem_customer_id,
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
  and period with a product (400), no writable licence and no Creem subscription that can still
  bill (paused, unpaid: the card is fixed in the portal) already (409), a pending checkout under
  30 minutes old for the same plan, period and product is reused, one checkout at a time per
  coach (a double tap waits and gets the same one); otherwise a new pending row, and Creem `POST /v1/checkouts`
  with `request_id`, `metadata{userId, plan, period}`, `success_url = ORIGIN + '/'` and the
  coach's email; the call is made outside the coach's lock and the licence judged again before
  the pending row and `users.licence_id` are written; returns `{url}`. Provider failure → 502,
  nothing written. The API host follows the key (`creem_test_…` → test-api.creem.io) unless
  `CREEM_API_BASE` is set.
- `POST /api/billing/webhook`: raw body; HMAC-SHA256 with `CREEM_WEBHOOK_SECRET` compared with
  `hash_equals`, else 401; duplicate event id → `200 {duplicate: true}`; the user is resolved by
  `metadata.userId`, then subscription id, customer id, `request_id`; none → `200` plus audit
  `billing.orphan`. Event map: trialing/active/paid → writable; past_due → writable;
  unpaid/paused/expired → read-only; canceled keeps `period_end`; scheduled_cancel → `cancel_at`;
  update → plan and period from `product.id` (a product not on sale here leaves the plan and is
  audited `billing.unsold`); refund and dispute → audit, a dispute also sets `disputed`. Events
  older than `last_event_at` are recorded but not applied (`{stale: true}`). The signature is the
  hex HMAC-SHA256 of the raw body in `creem-signature`; the event id is recorded in the same
  transaction that applies it, so a failure is retried whole. The row: by subscription id, then
  checkout id, request id, then the coach's one pending row for the product — never a row holding
  another subscription; a subscription of theirs never seen before gets a row of its own; with
  several pending rows for the product the event is answered 503 for Creem to retry once
  `checkout.completed` has said which was paid. The subscription's own status wins over the event
  name; a resumed subscription clears `cancel_at` and `canceled_at`. When the row in force stops
  writing, another writing subscription of the coach's takes over; a second subscription writing
  beside the one in force (or beside a grant) is audited `billing.conflict` and does not take over.
  Audit `billing.event|stale|ignored|orphan|conflict|unsold|refund|dispute`; `unsold` once per
  product change. An event for a licence row that is not the coach's
  `licence_id` (one a grant took over: a checkout finished late, a canceled subscription's
  `expired`) updates that row only and never moves `licence_id` off a `manual` grant; a payment
  landing on a coach who holds a grant is audited for the owner to reconcile. A coach can have
  several pending rows (one per checkout opened for a different plan, period or product); when one
  of them is paid while `licence_id` points at another row that does not write, `licence_id` moves
  to the paid one.
- `GET /api/billing/me` → `{entitlement, licence (public fields), plans}`. `POST /api/billing/
  portal` → Creem's customer portal link. Plan changes and cancellation happen in the portal in
  v1. `POST /api/admin/licence/grant {id, plan}` gives a coach a `manual` licence (or changes the
  plan of the one in force); refused for an admin, a disabled coach, and with 409 for a Creem
  subscription that can still bill (trialing, active, past_due, unpaid, paused) — a canceled,
  expired or pending one is taken over and kept. `revoke {id}` marks the manual row `revoked`,
  kept as history, and clears `licence_id`. The existing coach account receives a grant at
  cutover. Audited `admin.licence.grant` / `.revoke`.
- Enforcement: `RequireWriter` (402 `your plan is read-only until billing is sorted out — see
  Account › Plan & billing`) on assign, programs/save, media/exercise, the chunked upload's start,
  chunk and finish (R3), and invites/new. Cap checks at register/options (before the passkey
  ceremony), register/verify (again, under the coach's lock), invite/redeem (409
  `this coach's client list is full ({0}) — ask them to upgrade`; a coach whose plan is read-only
  turns clients away with 409 `this coach cannot take new clients right now — ask them to check
  their plan`) and invites/new (402 `your plan allows {0} clients — upgrade to invite more`).
  `GET /api/invite` adds `full`; `GET /api/coach/invites` adds `cap, used, canInvite, reason`
  (`read_only` | `at_cap` | null). Reads stay open. Audit events `billing.*`.
- Environment: `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_API_BASE`, `CREEM_PRODUCTS`
  (`solo:month=prod_…,solo:year=…,pro:month=…,pro:year=…,studio:month=…,studio:year=…`),
  `SELF_SERVE_COACH`.

## 7. Frontend changes (small; every string through `t()` with fr/es/de keys)
`views/Start.jsx` (plan from the query, `Segmented` fallback, name + email + passkey through an
exported `RegisterSheet`, then the checkout redirect) · `lib/billing.js` helpers ·
`lib/checkout-return.js` (`?checkout_id=` before the hash, like `?invite=`) · `store/useStore.js`
`licence` and `loadLicence()` · CoachAccount "Plan & billing" section · CoachToday banner card
(activating, trialing, past_due, lapsed, over_cap) with the post-checkout poll · InviteSheet
at-cap copy · Login `full` copy · the "Request access" form removed · **the email sign-in (§4a)**:
`views/Login.jsx` gains "Sign in with email" under the passkey button (not in guest mode) → inline
email field → "Check your inbox" state; `views/Link.jsx` on `/link` consumes `?t=` once (spinner →
`/today`, or the expired/used sentence with "Send a new link"); `components/AddPasskeySheet.jsx`
offered once per device after a link login (dismissable, remembered in `localStorage`); an
Account "Email" row with the address, its verified state, and "Change email" → the new address
shows as *pending* until the link mailed to it is opened (§4a). Audit labels `login.link`,
`login.link.throttled`, `account.email` in `lib/audit.js`.

The screens are designed first in the Claude Design project "FitPal Coach redesign" under its
CLAUDE.md rules, in one session: `S4 Start`, `C20 Account Plan and Billing`, `C21 Today Banners`,
`C22 Invite At Cap`, and for §4a `S5 Login – email path` (passkey primary, email secondary, the
inline form and the inbox state), `S6 Link landing` (loading, signed in, expired), `S7 Add passkey
sheet`, `C23 Account – Email row`, and the mail itself `E1 Sign-in link` (mobile width, French
copy, the `email/` palette).

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
`--verify` mode re-reads every user through the HTTP layer and diffs against the files — `/me`,
`/data`, and (since CHW-251) the coaching routes: each coach's invites and library, an admin's
invite list, everyone's inbox and answered offers, as Node answered them from the same files.

Invites, programs and assignments are **mirrored**, not only upserted: a rerun also removes the rows
the files no longer hold, because Node itself deletes programs and prunes answered offers. So the
import is run only while Node is the live API; after the cutover, `--verify-only` checks without
writing. An invite's `requestId` is not kept (access requests are not ported) and is reported.

## 10. Testing
Pest unit tests for the ported pure classes (the `domain.test.mjs` cases); feature tests named
after the `coach-smoke.sh` sections so coverage is auditable; a response-shape diff script that
runs the same seeded data through the Node API and the Laravel API; the tenancy tests of §5
(`twoCoaches()`, `CrossTenantTest`, the `OwnedByCoach` reflection test); the magic-link tests of
§4a; vitest for the new screens (including `Link.jsx`'s three states); the existing frontend
checks (`check-locales`, `check-source-strings --strict`); the `check-*` guards re-pointed at
`backend/` (error strings, audit labels, adherence window, check-in day).

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
