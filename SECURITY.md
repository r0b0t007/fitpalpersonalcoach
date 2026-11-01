# Security policy

FitPal Coach is a fork of openGym, and like it a self-hosted app: you run the server, you hold the
data. This file says which versions get fixes, how to report something privately, and — the part
most people actually need — what the app protects you from and what it doesn't.

The API is the Laravel app in `backend/`. File references below are relative to it unless they
say otherwise.

## Supported versions

Only the **latest release**. Releases are semver tags (`v1.0.0` → `v1.2.3`, see
[CHANGELOG.md](CHANGELOG.md)); there is no LTS or maintenance branch and older tags are never
patched. A fix ships in the next release.

Updating a self-hosted instance (the full sequence, with a database dump first, is section 10 of
[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)):

```bash
git pull
cd backend && composer install --no-dev && php artisan migrate --force \
  && php artisan filament:assets && php artisan optimize
cd ../frontend && npm ci && npm run build    # then publish dist/ again
```

## Reporting a vulnerability

The project lives on GitLab. It has no security-advisory workflow on the free tier, but it does
have **confidential issues**, and that is the private channel: open an issue at
<https://gitlab.com/DuarteSantos8/opengym/-/issues/new> and tick **"This issue is confidential"**
*before* you submit. A confidential issue is readable only by project members — you'll see it,
I'll see it, nobody else will, and it stays that way if it is later closed.

If you'd rather not put the details in GitLab at all, open a confidential issue saying only
*"I need an address for a security report"* — no details, no repro, no version — and you'll get
one back within a couple of days.

> The GitHub repo and its private vulnerability reporting are gone with the suspended account;
> `github.com/DuarteSantos8/openGym/security/advisories/new` no longer resolves.

Please don't put a working exploit in a *non-confidential* issue if it can be used against other
people's instances — and not in the Discord either, which is a public room. Everything else (a
crash you can only trigger on your own box, a scanner warning) is fine as a normal issue.

Useful in a report: the version or commit, your PHP version and database, your `RP_ID`/`ORIGIN`
and what sits in front of the app, steps to reproduce, and what an attacker gets out of it.

**On response times:** this is a hobby project maintained by one person alongside school. There
is no SLA and no bounty. Expect days rather than hours, and longer during exam periods. If a
week goes by with no reply, comment on the advisory thread — it's more likely to be a missed
notification than a decision. If a report goes unfixed and you want to disclose publicly, say so
in the thread; there's no objection, and no request to sit on it indefinitely.

## In scope

- **The API (`backend/`)** — forging or replaying a session token, bypassing passkey
  verification, redeeming an email sign-in link that wasn't sent to you, reading or writing
  another user's data through `/api/data`, a coach reaching a client who isn't theirs (or another
  coach's programs, invites or media), reaching `/api/admin/*` or the admin panel without being
  an admin, creating an account without a valid code while `INVITE_ONLY=1`, or making the server
  connect somewhere it shouldn't through a push subscription.
- **Frontend** — XSS in the React app, or anything that lets a page on another origin read or
  change a signed-in user's data.
- **Shipped deployment config** — `backend/.env.example`, `backend/public/.htaccess`,
  `backend/public/.user.ini` and the guidance in `docs/SELF_HOSTING.md`: a default that exposes
  something a self-hoster wouldn't expect to be exposed.

## Out of scope

- Anything that already assumes access to the host, the database, `DATA_DIR` or `backend/.env`.
  The operator is trusted by design — see the security model below.
- Admins reading their users' training history, and coaches reading their own clients'. That is
  what the admin screens and the coaching product are for, not a leak.
- An instance run with `APP_DEBUG=true`. `.env.example` is a development file;
  `docs/SELF_HOSTING.md` says to turn it off, and with it on Laravel shows stack traces by design.
- **Missing rate limiting**, brute force, or "I sent 100k requests and it got slow". Only three
  things are throttled — see below — and the rest belongs in the reverse proxy you put in front.
  Genuine amplification (one small request causing unbounded work) *is* in scope.
- **Missing security headers.** The frontend is static files served by whatever you run, so the
  headers are yours to set — `X-Frame-Options: DENY`,
  `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: same-origin` are the recommended set, and `docs/SELF_HOSTING.md` says so.
  HSTS and a full CSP are deliberately **not** recommended blindly: TLS is the web server's job,
  and a script/style policy tight enough to be worth having needs testing against the built app
  rather than being asserted here. A concrete attack that a header would have stopped is still
  worth reporting.
- Instances served over plain `http://` on a LAN IP. Unsupported: passkeys don't work there and
  the session cookie isn't marked `Secure`.
- Scanner output with no working exploit, and `npm audit` / `composer audit` findings in
  development-only dependencies (Vite, Vitest, Capacitor CLI, Pest, Pint) that never reach a
  running instance.
- The GitLab Pages demo build — it has no backend at all, everything stays in that browser.
- Third-party content: the exercise image/GIF dataset and the CDN it's fetched from.

## Security model

Read this before hosting it for anyone other than yourself.

### What it does

- **Passkeys first.** No passwords for the app. Registration and login are verified server-side
  by `laragear/webauthn` against `RP_ID`, with the browser's origin compared to `ORIGIN`
  character for character (`app/WebAuthn/AttestationValidator.php`,
  `app/WebAuthn/AssertionValidator.php`, `app/WebAuthn/Pipes/CheckOriginExact.php`). The
  authenticator's signature counter is stored, and a counter that goes backwards is refused
  (`app/WebAuthn/Pipes/CheckCounterNotReplayed.php`).
- **Two narrower ways in.** A coach or admin with a confirmed address, and since CHW-331 a client
  whose address was proven (by the code of an accepted join request), can ask for a sign-in mail:
  a link and a 6-digit code, either of them one use, 15 minutes. The link is stored only as a
  SHA-256 hash, the code as an HMAC keyed with `APP_KEY` and the row, and only the newest code
  works: 5 wrong tries spend it. Asking, and a refused code, answer the same whether or not the
  address has an account (`app/Http/Controllers/LoginLinkController.php`,
  `app/Models/LoginLink.php`). **Such a client's account is as safe as their inbox**: many have
  no passkey at all, since passkeys fail inside Instagram's browser. And an admin can
  be given an email and password for the admin panel (`php artisan fitpal:panel-login`); that
  password opens the panel, on Laravel's own session and CSRF token, not the app
  (`app/Providers/Filament/AdminPanelProvider.php`, `User::canAccessPanel`).
- **Sessions are a signed token.** `<uid>:<expiry>:<version>` plus a base64url HMAC-SHA256 tag
  over it, compared with `hash_equals` (`app/Auth/SessionToken.php`). The key is `SESSION_SECRET`
  from `backend/.env`; under 32 characters it is treated as absent, and then nothing is signed and
  nothing verifies — it fails closed rather than signing with an empty key. The same string is the
  cookie for a browser and the `Authorization: Bearer` token for a paired phone. The cookie is
  `HttpOnly` and `SameSite=Lax`, and gets `Secure` **only when `ORIGIN` starts with `https://`**.
  On an https instance it is named `__Host-gymsid`: the prefix makes the *browser* enforce that
  the cookie is host-only, which is what stops a sibling subdomain from planting a second session
  cookie on the shared parent domain and having it shadow the real one. Over plain
  `http://localhost` the prefix is not allowed, so the name is `gymsid`; both are accepted on the
  way in. If one name arrives twice with different values, neither is trusted
  (`app/Auth/TokenGuard.php`).
- **Any user can end every session they have.** `POST /api/logout/all` increments that account's
  session version, and every authenticated request checks the version in the token against the
  one on the account (`SessionToken::user`), so every token ever issued for it — on every device,
  paired phones and a copy someone walked off with included — stops verifying at once. Passkeys
  are untouched; signing back in works immediately.
- **The two changes that would outlive a stolen session need a recent sign-in.** Adding a passkey
  and changing the sign-in email address are refused unless this session proved the account (a
  passkey, an email link, the sign-up itself) in the last 15 minutes. Pairing a phone does not
  count (`app/Auth/FreshAuth.php`, `app/Http/Middleware/RequireFreshAuth.php`).
- **Data is isolated by the session's uid.** `GET`/`PUT /api/data` only ever touch the caller's
  own row (`app/Http/Controllers/DataController.php`); no route lets a client name another user.
  Coach routes act as the signed-in coach, and every coach-owned record is scoped to them
  (`app/Tenancy/`). Media files live in `DATA_DIR`, outside the document root, and only leave
  through the API behind a session: a progress photo to its owner and whoever coaches them, a demo
  to its coach, their clients and admins (`app/Tenancy/Access.php`, `app/Media/Paths.php`).
- **Disabling an account takes effect immediately.** A disabled account's token stops verifying
  (`SessionToken::user`), its passkey login and phone pairing are refused
  (`AuthController::loginVerify`, `PairController::redeem`), it gets no sign-in link, and it cannot
  open the admin panel.
- **Push endpoints cannot be aimed at your network.** A subscription's `endpoint` is a URL the
  server connects out to, and it comes from whoever is signed in, so `/api/push/*` would otherwise
  be a request-forgery lever from inside the server's own network. It must be `https:` with no
  credentials, a literal private address is refused at subscribe time (`app/Push/Endpoint.php`),
  and at send time the server resolves the host itself, refuses it if *any* address it resolves
  to is loopback, private, link-local (including cloud metadata), CGNAT, multicast or reserved, and
  then pins the connection to exactly the addresses it checked — so a name that answers
  differently the second time has no second time (`app/Push/Sender.php`). No redirects, no proxy.
  Sends time out after 10 s, run at most 6 at a time, stop looking names up after 15 s, and each
  account keeps at most 20 subscriptions, the oldest dropped (`PushSubscription::MAX_PER_USER`).
- **An upload is judged by its bytes.** The type comes from the first 64 bytes, never from the
  `Content-Type` the sender chose, and the body is streamed to a temporary file, never held in
  memory (`app/Media/Sniff.php`, `app/Media/Upload.php`).
- **The billing webhook is signed.** `POST /api/billing/webhook` takes no session; it is refused
  unless its `creem-signature` is the HMAC-SHA256 of the body under `CREEM_WEBHOOK_SECRET`
  (`app/Http/Controllers/CreemWebhookController.php`).
- **There is an activity log.** Sign-ins, sign-outs, failed and refused attempts, pairings and
  every admin action are recorded in the `audit_events` table (`app/Audit/Audit.php`) and shown
  to admins. It is on by default (`AUDIT_LOG=0` stops it) and capped at `AUDIT_MAX` events /
  `AUDIT_DAYS` days. Clearing it from the dashboard is itself recorded and the event ids keep
  counting, so an erased stretch always leaves a visible gap
  (`app/Http/Controllers/AuditController.php`).

### What it does not do

- **Nothing is encrypted at rest.** The database holds every account, passkey public keys, push
  subscriptions, invite codes, each user's complete training history and body-weight log, and the
  activity log. `DATA_DIR` holds every uploaded video and progress photo, and `vapid.json` (the
  push private key). `backend/.env` holds `SESSION_SECRET`, and with it anyone can mint a valid
  session for any account. The dumps in `backend/storage/backups/` are full copies of the
  database, so an account deleted today lives on in them until they are pruned. Anyone who can
  read these — you, whoever holds the backups, whoever gets into the host — can read every user's
  data. **If you host this for other people, they are trusting you exactly as much as they'd
  trust any server operator.**
- **Admins can read everything.** An account with `admin` set in the `users` table, or listed in
  `ADMIN_UIDS`, gets every user's full history and body weight, can disable accounts, make
  coaches, move clients between coaches, issue invite codes and licences
  (`app/Http/Controllers/AdminUserController.php`, the admin panel). Off by default — a fresh
  instance has no admin until `BOOTSTRAP_CODE` or `ADMIN_UIDS` makes one. A coach, likewise, sees
  their own clients' training.
- **Sessions can't be revoked one device at a time.** Revocation is per *account*, not per
  session: `POST /api/logout/all` kills all of them at once and there is no device list to pick
  from. `POST /api/logout` on its own only clears the cookie in that one browser
  (`AuthController::logout`) — a copy taken beforehand keeps working. Sessions last **90 days** by
  default, settable with `SESSION_DAYS`; each token carries the expiry it was issued with, so
  changing the setting doesn't reach tokens that are already out. Changing `SESSION_SECRET` (and
  re-caching the config) ends every session and every paired phone on the instance, and disabling
  an account still locks out one user completely.
- **CSRF protection for the API is `SameSite=Lax` plus an origin check, not tokens.**
  `SameSite=Lax` alone is not enough: it keeps the cookie off a cross-*site* request but a sibling
  subdomain (`coach.example.com` vs anything else under `example.com` — one domain, one reverse
  proxy, several apps, i.e. the usual self-hosting layout) is the *same* site and does get the
  cookie. So every state-changing request must be `Sec-Fetch-Site: same-origin` (or `none`), or,
  where a browser sent no such header, carry an `Origin` equal to `ORIGIN`
  (`app/Http/Middleware/CsrfOrigin.php`). A request with neither header is no browser's and
  passes. Requests authenticated with a Bearer token skip the check — a browser never attaches one
  by itself, so there is no ambient authority to borrow — as do the register/login/pair
  handshakes and the request for an email link, which carry their own credential or act on no
  session.
- **Cross-origin reads are allowed, credentials never.** Every response reflects the caller's
  `Origin` in `Access-Control-Allow-Origin` and none sends `Access-Control-Allow-Credentials`
  (`app/Http/Middleware/ReflectOrigin.php`): the paired phone's WebView needs the first, and the
  second is what keeps another origin from riding the cookie.
- **User verification is preferred, not required.** Registration and login ask for
  `UserVerification::Preferred` (`app/Http/Controllers/AuthController.php`), and the validators
  check user presence, not verification, so a passkey released without a biometric or PIN is
  still accepted. In practice: unlocked device ≈ account access.
- **Recovery is thin, and none for clients.** Every successful registration creates a *new*
  account. A signed-in account can add more passkeys (with a recent sign-in, above); a coach or
  admin with a confirmed email can get back in by link or code, and so can a client whose address
  was proven. A client with no proven address (one who joined by an invite link, with a passkey)
  who loses every passkey has no way back short of the operator editing the database.
- **Disabling someone isn't a ban.** They can still register a fresh account with a new passkey
  unless `INVITE_ONLY=1` is set. It also makes them near-invisible in the activity log: a disabled
  account is refused at the session check, so nothing it does produces an entry except the failed
  sign-ins it keeps attempting.
- **HTTPS is required and the app doesn't provide it.** TLS is the job of the web server or
  whatever you put in front of it. Without it, browsers won't do passkeys at all (except on
  `http://localhost`) and the session token is sent in the clear.
- **Almost no rate limiting.** Four things are throttled: asking for an email sign-in link (3 per
  address per 15 minutes, 10 per client address and 300 per connection per hour), a sign-in code
  (5 wrong per address per 15 minutes, any address alike; 30 wrong per client address and 300 per
  connection an hour), self-serve
  coach sign-up (10 per client address and 100 per connection per hour,
  `app/Support/ClientLimit.php`), and the admin panel's password form (Filament's own, 5 a
  minute). Nothing else throttles logins,
  registrations or writes, and `POST /api/register/options` still answers whether an invite code
  is valid, so an invite-only instance on the open internet should have a rate limit in front of
  it. New invite codes are 16 hex characters — 64 bits (`app/Models/Invite.php`) — which makes
  guessing one impractical even unthrottled; codes generated by earlier openGym versions are 8
  characters / 32 bits and still work once imported, so revoke and reissue any that are still
  unused. The hard body limits are 5 MB for JSON (`app/Support/Input.php`), 16 MB for the state
  sync (`DataController::MAX_BYTES`) and the two media caps, under PHP's own `post_max_size`.
- **The activity log is not an audit archive, and it records less than you might assume.** No IP
  address unless you set `AUDIT_IP` (`net` truncates to a /24 or /48; the default is `off`). When
  it is on, the address is the first of `CF-Connecting-IP`, the first entry of `X-Forwarded-For`,
  `X-Real-IP` or, failing all three, the connecting socket (`app/Audit/ClientIp.php`). Those
  headers are read as they arrive — no trusted-proxy list decides — so the address is only as
  trustworthy as whatever sits in front, which has to *overwrite* them rather than pass a
  client-supplied one through. (The same headers pick the per-client buckets of the throttles
  above, which is why each also has a per-connection bucket.) Anything not shaped like an address
  is dropped, never stored verbatim. Never the browser's user-agent, and never the passkey id
  behind a failed sign-in — that id is a stable handle for one device, and storing it would let an
  admin follow an unknown device from attempt to attempt. So a failed sign-in from a passkey this
  instance doesn't know is recorded as a time and a reason and nothing else. Retention is a cap,
  not an archive: old events are deleted, not exported. Any admin can clear the whole log. And
  several of the paths that write to it — the invite check on `POST /api/register/options`, the
  expired-challenge branches of both handshakes, the unknown-passkey branch of login, a failed
  pairing code — are reachable **without a session**, so with no rate limit in front anyone can
  fill the log with noise. Unless `AUDIT_MAX=0`, the table is pruned back to `AUDIT_MAX` as it
  grows, so the cost is real events pushed out, not a full disk.
- **A few endpoints answer without a session:** `/api/health` (which includes the total account
  count), `/api/config` (whether invite-only, guests and self-serve are on, and the billing plans),
  `/api/push/public-key`, `/api/invite?code=` (the inviting coach's name, for a valid code), the
  register/login/pair handshakes, `/api/login/email` and `/api/login/link`, the billing webhook,
  and Laravel's own `/up`.
- **Changing `RP_ID` invalidates every existing passkey.** They were bound to the old hostname and
  will fail verification against the new one. The data stays in the database but is unreachable
  until each user registers again — as a *new* account. Choose your hostname before anyone
  registers.
- **Guest mode never reaches the backend.** That data lives unencrypted in the browser's
  `localStorage` and is gone when the browser storage is cleared.
