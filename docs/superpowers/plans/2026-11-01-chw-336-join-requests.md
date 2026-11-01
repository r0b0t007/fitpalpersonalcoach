# CHW-336 Join requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** A follower opens `/#/join/<handle>`, fills a short intake, proves their email with a 6-digit code, and leaves a **pending** request for the coach. No account and no seat are created, and the browser keeps a request token to show the request's status.

**Architecture:**
- **Storage.** A tenant-owned `join_requests` table (`OwnedByCoach`) holds the intake, the hashed code with an attempt counter and expiry, and, once verified, the hashed request token.
- **Routes.** Three public routes: `POST /api/join/start`, `POST /api/join/verify` and `GET /api/join/status`. They are throttled as `LoginLinkController` is, and the form carries a honeypot and a minimum fill time.
- **Mail.** The code goes out in a `JoinCodeMail`, which reuses the account-mail view. There is no account behind it and no link, and the code is the heading.
- **Screen.** `views/Join.jsx` at `/join/:handle` is routed before the shells, like `/c/:handle`. It wears the coach's theme.

**Spec:** §3, §3.0, §3.2 of `docs/superpowers/specs/2026-11-01-creator-coach-design.md`. **Issue:** CHW-336.

## Decisions made while planning (owner informed in chat)

- **The request carries its own code.** It doesn't wait for CHW-331's client sign-in code: the code proves the address for *this* request only.
- **Claim moves to CHW-337.** `POST /api/join/claim` (request token → session) belongs with accept, because only accept can create the account (spec §3.0). With no accept yet, a claim could never succeed.
- **Not reachable yet.** "Ask to join" stays **off** `views/PublicCoach.jsx`. The form is only reachable by its URL until CHW-337, the inbox to accept from, and CHW-334, the legal pages for the health data, are done. Consent is captured and stored now anyway.
- **Pruning.** `fitpal:prune` deletes unverified requests after 24 h, and declined or expired ones after 30 days. Wiping on release and detach is CHW-334's.

## Global constraints

Same as CHW-329/330:
- no new dependencies;
- every string goes through `t()` in fr/es/de;
- every API error is a key in every pack (`check-error-strings.mjs`);
- audit labels are added and the floors raised (44 → 47);
- `// across coaches:` goes on every cross-coach read;
- `OPENSSL_CONF` is set for the local Pest run.

## Interfaces

**`POST /api/join/start`**
- Body: `{handle, name, email, lang, intake:{goal, level, days, injuries, equipment[], phone, consent}, website, elapsed}`.
- Answers `{ok:true, id}`. It also answers that way, with a made-up `id`, when the honeypot is filled, the form was sent under 3 s, or the sender is throttled, so a bot learns nothing.
- Refusals:
  - 404 `no such coach page` / `this coach is not taking requests right now` (the page is public anyway);
  - 400 `tell us your name`, `that is not an email address`, `tell us your goal, level and days a week`, `that is not a phone number — include the country code`, `please agree to share your answers with your coach`;
  - 429 `this coach has too many requests waiting — try again later` (50 pending).
- Effects: an unverified request is replaced by a new one for the same email and coach. The code is mailed after the response. Audit event `join.request` (no address recorded).

**`POST /api/join/verify {id, code}`**
- Answers `{ok:true, token, status:'pending'}`.
- Refusals:
  - 400 `that code has expired — ask for a new one` (unknown id, not unverified, or past 15 min);
  - 429 `too many tries — request a new code` (5 attempts);
  - 400 `that code is wrong — check the email and try again`;
  - 400 `that is your own page` (the coach's own address);
  - 409 `you already asked to join this coach` (a pending one exists for that email and coach; the new one is deleted).
- Audit event `join.verify`.

**`GET /api/join/status?id=&token=`**
- Answers `{status, coachName, handle}`.
- 404 `no such request`.

**Frontend**
- `lib/join.js`: `GOALS`, `LEVELS`, `EQUIPMENT`, `MIN_FILL_MS = 3000`, `intakeError(intake)` (a key or null), `savedRequest(handle)`, `saveRequest(handle, {id, token})`, `forgetRequest(handle)`.
- `views/Join.jsx` (`{ handle }`), with steps: `intake` → `about` (injuries, equipment, phone, consent) → `email` → `code` → `sent`.

## Tasks (each: failing tests → code → green → commit)

1. **Table, model, intake rules.**
   - Migration `join_requests`:
     - `id` string(24) primary;
     - `coach_id` string(16), FK restrictOnDelete;
     - `email` (254), `name` (40), `intake` text;
     - `status` (10): unverified|pending|accepted|declined|expired;
     - `code_hash` char(64) nullable, `attempts` tinyint, `code_expires` bigint nullable;
     - `token_hash` char(64) nullable unique;
     - `created` bigint, `decided` bigint nullable;
     - index on (coach_id, status).
   - `App\Models\JoinRequest` (`OwnedByCoach`).
   - `App\Coaching\Intake::from(mixed): array`, which throws `ClientSafe` with the keys above.
   - Pest unit cases for Intake.
2. **`start` + `JoinCodeMail` + throttles + honeypot + pending cap.**
   - `MailCopy` gains the `joincode` kind in en/fr/es/de: the heading is the code, and the greeting is anonymous like `confirm`.
   - Pest: the request is stored and the mail is sent with the code; the honeypot and a fast fill store nothing and still answer ok; the throttle; a closed or unknown page; each intake refusal; the cap; replacing an unverified request; no `users` row is created.
3. **`verify` + `status`.**
   - Pest: a right code gives pending plus a token, with the token hash stored and the code cleared; a wrong code increments attempts; 5 tries gives 429; expiry; the coach's own address; a duplicate pending request gives 409; status with a good or bad token; **still no `users` row**.
4. **Prune + audit labels + error keys in the packs.** Floors go to 47.
5. **`lib/join.js` + `views/Join.jsx` + App route.**
   - vitest: `intakeError`; localStorage round trip; the Join flow end to end with `api` mocked (intake → email → code → sent); a wrong code shown; a stored request goes straight to the status screen; the theme override.
6. **Full checks.** Push, open the PR, and update CHW-336/337 in Linear: claim and the "Ask to join" button move to 337.
