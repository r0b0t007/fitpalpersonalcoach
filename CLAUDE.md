# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this fork is

**FitPal Coach** — openGym forked (via FIT'ONE) into the tool one coaching business runs on.
Deployed to **coach.fitpal.ma**, a cPanel subdomain sharing an account with FIT'ONE, which
deploys from a *different* repo to the same server. Both use `rsync --delete`, so a wrong target
directory does not fail, it deletes the other product — read `docs/DEPLOY_COACH_SUBDOMAIN.md`
before touching anything under `.github/workflows/deploy-*`.

What this fork adds on top of upstream, none of which upstream's notes below describe:

- **A human coach role, with its own shell.** `App.jsx` renders one of two route tables from
  `lib/role.js`: a coach gets `/today` (the dashboard, `views/coach/CoachToday.jsx`), `/clients`,
  `/programs` and `/account` with `CoachTabBar`; a client gets `/home` and the training app. The
  dashboard's old address `/trainer` redirects. (It could not be `/coach` when the split was made
  — upstream's AI Coach owned that path. That feature has since been removed, but `/today` is what
  shipped and renaming a live route to reclaim a path buys nothing.) Coach surfaces go through
  `t()`/`tp()` like the rest of the app — the coach is a French- or Spanish-speaking business
  owner. They were English-only raw strings until CHW-205 (a convention inherited from the gym
  `Admin.jsx` that P6 deleted), and files not yet converted still say so in a comment.
- **`StatsPanels`** (`views/Stats.jsx`) is exported and prop-driven so the coach sees a client's
  own charts by passing a different `S`. Keeping panels prop-driven is what makes every new
  client-side metric free on the coach side — do not reach for `useStore` inside one.
- **`lib/adherence.js`** — are they training on the days their plan says? `lib/measurements.js` —
  the tape, shaped like `S.bodyweight` so it rides the same sync and the same chart.
- Languages trimmed to **en/de/es/fr** (`lib/i18n-core.js`). English has no pack; the others must
  stay in sync or `check-locales.mjs` fails. `check-source-strings.mjs --strict` fails CI on a key
  no pack defines, but only sees quoted literals passed straight to `t()` — a ternary, a lookup
  table or a template literal inside `t()` is invisible to it.

Upstream's description of the product follows, and still holds for the shared parts.

## What this is

openGym is a self-hosted gym & body-weight tracker PWA. An API and a folder of static files, plus a
`./data` folder the user owns — no third-party account, no telemetry. (Upstream's API is Node;
this fork's is the Laravel backend, which replaced it at the R5 cutover.) Passkey (WebAuthn) login,
installable as a home-screen app, optional Capacitor shells for standalone Android/iOS builds.

## Project layout

```
frontend/  React 19 + Vite app (src/views, src/components, src/store, src/lib). Builds to static files.
           android/ + ios/ are the Capacitor shells for the standalone mobile app (docs/MOBILE.md).
backend/   the API — Laravel 13, PHP 8.4+, MariaDB in production (SQLite locally). What
           coach.fitpal.ma/api runs since the R5 cutover (2026-10-26); it replaced the Node API
           (`api/`, deleted in CHW-301) with the same paths, shapes and English error strings
           (they are the app's translation keys). Design: docs/superpowers/specs/2026-10-17-
           laravel-backend-design.md. Run: backend/README.md. Composer dependencies few and
           justified, not minimal.
mcp/       upstream's MCP server — read-only stdio bridge to a user's workouts for LLM clients.
           It reads the Node API's JSON files, so it does NOT work against this fork's backend
           until it has a database adapter (mcp/README.md). Its tests still run in CI.
media/     exercise img/gif, gitignored, fetched by scripts/fetch-media.sh.
site-coach/ THIS product's marketing site → **fitpal.ma** (the apex), Cloudflare Pages
           project `fitpal-coach`, gated by DEPLOY_SITE_COACH. Plain HTML/CSS/JS.
site/      FitPal, the white-label GYM product's site → gym.fitpal.ma, Pages project
           `fitpal`, gated by DEPLOY_SITE. A different product to a different buyer.
website/   openGym upstream's inherited site. Not deployed from here.
email/     branded outbound email templates. Deliberately NOT under site-coach/, because
           that directory is the Pages deploy root and everything in it is served publicly
           - no ignore file or redirect can prevent it. See email/README.md.
docs/      SELF_HOSTING.md, MOBILE.md.
```

## Commands

```bash
# Exercise media (~140 MB, once)
./scripts/fetch-media.sh

# The API (backend/README.md for the first-time setup: .env, key, migrate)
cd backend && composer install && php artisan serve      # :8000

# Frontend dev server (hot reload), proxies /api to :8000 (API_TARGET to change it)
cd frontend && npm install && npm run dev

# Backend tests and style
cd backend && ./vendor/bin/pest && ./vendor/bin/pint --test

# Frontend tests (training logic: progression, 1RM, session read-back)
cd frontend && npm test            # vitest run
cd frontend && npm run test:watch
npx vitest run src/lib/progression.test.js   # single file
npx vitest run -t "some test name"           # single test by name

# MCP server tests
cd mcp && npm test

# Production build
cd frontend && npm run build
cd frontend && npm run build:mobile   # + cap sync, points media at the CDN dataset
```

There is no linter/formatter configured (no ESLint/Prettier config in the repo) and no
TypeScript — match the existing style by hand.

**The CI gate is `.github/workflows/test.yml` on GitHub.** This is a fork: `origin` is
`r0b0t007/fitpalpersonalcoach`, and the GitLab and Gitea remotes are fetch-only upstreams to
merge from. The paragraph upstream has here — that GitLab is canonical and the GitHub workflows
are dormant mirrors — is false for this repo and inverted: nothing runs on GitLab, and GitHub is
both the test gate and the deploy path.

Four jobs: `test` (frontend, incl. `check:i18n`), `frontend-next-node`, `mcp` and `backend`
(PHP 8.4, `pint --test`, Pest on in-memory SQLite, the migrations on a MyISAM-default MariaDB, and
the two backend scripts below). `deploy-backend.yml` runs this whole workflow as its gate. The
Node jobs (`api`, `api-smoke`, and `contract`, which diffed every route against Laravel) went
with `api/` in CHW-301. **`test.yml` has path filters**; anything outside `frontend/`, `mcp/`,
`backend/`, `scripts/french-vous.mjs` and the sign-in mail templates runs no checks at all, and
GitHub reports "no checks" rather than failing.

Some guards check what a test cannot see, because the two values sit either side of a boundary
neither runtime can import across:

- `backend/scripts/check-error-strings.mjs` — the API refuses in English and the app translates
  it (`lib/server-messages.js`). Every `Json::error(status, '…')`, `new ClientSafe(status, '…')`
  and `Say::f('…')` template must be a key in every pack; a message with a value in it is a
  `Say::f` template, sent as its key with the values beside it (`msg: { k, v }`). The check fails
  on a message built any other way (a concatenation, a variable).
- `backend/scripts/check-audit-labels.mjs` — every `Audit::record` event needs a label in
  `frontend/src/lib/audit.js`. Its floors are today's counts: raise them when events are added.
- Pest ties the rest: `CoachRosterTest` keeps `MemberCard::ADHERENCE_SEND_DAYS` a day above the
  app's `ADHERENCE_WINDOW_DAYS`, and `tests/Unit/CheckinDayTest.php` keeps
  `Reminders::DEFAULT_CHECKIN_DAY` equal to `lib/checkins.js`'s.

Comments across `backend/` and `frontend/` still cite `api/server.js` and `api/domain.mjs`: the
Node API each piece was ported from, or matched against. The backend kept its names. Read them at
the last commit that had them: `git show 5d0c52f4:api/server.js`.

## Architecture

### Frontend (`frontend/src`)

- **`store/useStore.js`** — single Zustand store holding the entire client-side app state (`S`),
  persisted to `localStorage` (`gym_state_v1`) and debounce-pushed to the server when signed in
  (`pushState`, see `lib/api.js`). On the Capacitor mobile build it's also mirrored to a file via
  `lib/mobile.js` (`nativeSave`), since WebView storage can be evicted. `store/useUI.js` holds
  ephemeral UI state (modals, active sheet, etc.) separately from persisted data.
- **`lib/`** — pure, framework-free helpers, each paired with a same-directory `*.test.js`. This
  is where the domain logic lives, most importantly:
  - `progression.js` — the progression-rule engine (linear, Greyskull LP, double progression,
    time-based). Rules implement a shared policy interface; adding a new one plugs in here.
  - `onerm.js` — estimated 1RM from logged sets.
  - `finish-workout.js` — reduces a completed session back into state (weights advance, PRs, etc).
  - `recovery.js` / `recovery-view.js` — fatigue/muscle-recovery model.
  - `workout-model.js`, `supersetFlow.js` — in-session workout state machine, incl. supersets.
  - `exercises.js` / `exercises-data.js` — the exercise library (1,324 built-ins + user-defined).
  - `api.js` — the only place that talks to the backend (`fetch` wrapper, session cookie flows).
  - CONTRIBUTING.md is explicit: **anything that decides what you lift next, or reads a logged
    session back, is a pure helper here with a unit test beside it** — not verifiable by
    clicking, and the progression engine has already had two bugs that only a test caught.
- **`views/`** — one file per screen (Home, Workout, Plan, Library, Stats, History, Settings,
  MyCoach, Login, RoutineEdit), routed by `react-router-dom` from `App.jsx`; `views/coach/` holds
  the coach shell's own screens. The gym screens — Sessions, CheckIn and the Admin dashboard —
  were deleted in P6.
- **`components/`** — shared UI (charts, modals, timers); `instr/` holds per-language exercise
  instruction text; `locales/` is the i18n string catalogue (`lib/i18n.js` / `i18n-core.js`).
- Mobile: `@capacitor/*` wraps the same web build into native shells under `frontend/android` and
  `frontend/ios` (see `docs/MOBILE.md`); `mobile.js` in `lib/` gates native-only behavior (file
  persistence, local notifications, wake lock) behind a `MOBILE` flag.

### API (`backend/`, Laravel)

Routes are in `backend/routes/api.php`, one controller each under `app/Http/Controllers`, with the
domain in `app/Coaching`, `app/Push`, `app/Media`, `app/Billing`, `app/Auth`. The app always calls
`/api/...`; on the server `coach.fitpal.ma/api` is a symlink to `backend/public`. Data is in the
database (MariaDB in production, SQLite locally); `DATA_DIR` still holds what Laravel reads from
disk: exercise demos and photos under `media/`, and `vapid.json` unless `VAPID_*` is set. Auth is
WebAuthn passkeys plus a signed session token (`app/Auth/SessionToken.php`), the Node API's format
kept byte for byte and keyed with `SESSION_SECRET`, so the cutover kept every session and paired
phone signed in. The same token is the cookie for browsers and the Bearer token for the paired
mobile app. Env-gated as before: `ADMIN_UIDS`, `INVITE_ONLY`, `ALLOW_GUEST`, `SELF_SERVE_COACH`,
billing (`CREEM_*`). The audit log is the `audit_events` table. Shared hosting has no supervisor,
so one cron line runs `schedule:run` every minute (`routes/console.php`): reminders, the queue
worker (pushes; mail is sent after the response, not queued), the hourly prune and the nightly
database dump. Filament serves the operator panel at `/api/admin-panel`.

### MCP server (`mcp/src`)

Upstream's read-only stdio MCP bridge (`@modelcontextprotocol/sdk`): it reads a user's
routines/workouts/body-weight/1RM/muscle-balance from the `state-<uid>.json` files the Node API
wrote to `DATA_DIR`. Laravel keeps that data in its database, so it reads nothing useful here until
it has a database adapter (mcp/README.md). `state.js` loads/derives the data, `tools.js`
defines the exposed MCP tools (zod-validated schemas), `labels.js` maps internal keys to
human-readable labels, `index.js` wires it together. See `mcp/README.md` for the client-config
side (Claude Desktop / Cursor).

### Passkeys and self-hosting constraints

WebAuthn passkeys are bound to an exact hostname (`RP_ID`) and require HTTPS (localhost excepted)
— this shapes a lot of the API and Settings code (`RP_ID`/`ORIGIN` env vars, guest-mode fallback
when neither is available). Read `docs/SELF_HOSTING.md` before touching auth, session, or
notification code; it documents the env-var contract (`RP_ID`, `ORIGIN`, `DATA_DIR`,
`SESSION_SECRET`, `SESSION_DAYS`, `ADMIN_UIDS`, `INVITE_ONLY`, `ALLOW_GUEST`, `AUDIT_*`,
`VAPID_*`) that real deployments depend on; `backend/.env.example` has every variable.
`fitpal:check-config` checks a deployment's values.

### Deploy

Two rsync workflows onto one cPanel account. `deploy-backend.yml` runs `test.yml` as its gate,
then sends `backend/` (with `vendor/` built in CI) to `~/fitpal-coach-backend`, dumping the
database and migrating in maintenance mode; it runs on every merge that touches `backend/`, behind
the `DEPLOY_BACKEND` kill switch. `deploy-web.yml` sends `frontend/dist/`. There is no container
runtime anywhere in this — shared hosting does not offer one. `docs/DEPLOY_COACH_SUBDOMAIN.md` is
required reading before touching either workflow, and `docs/CUTOVER_R5.md` has the backend's
runbook. (`deploy-api.yml`, the Node deploy, is switched off with `DEPLOY_API=false` and is the
owner's to delete: it is under this repo's edit deny rules.)

The app and the API must be served from ONE origin: LiteSpeed serves `dist/`, and `/api` is a
symlink into `backend/public`. Passkeys are bound to the origin and the session cookie is scoped to
it, so two hostnames or two ports breaks both.

## Guidelines from CONTRIBUTING.md worth knowing before changing code

- **Dependency-light is a hard constraint, not a preference.** Frontend: React + Router + Zustand
  and nothing else. The backend keeps its Composer dependencies few and justified (Laravel,
  Filament, `laragear/webauthn`, `minishlink/web-push`). New dependencies are a hard sell either
  side.
- Don't commit `media/` or `data/` (gitignored).
- Training-logic changes (progression, 1RM, session read-back) need a unit test in `src/lib`
  beside the code, not just manual clicking-through.
