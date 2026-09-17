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
  `lib/role.js`: a coach gets `/today` (the dashboard, `views/Coach.jsx`) and `/account` with
  `CoachTabBar`; a client gets `/home` and the training app. The dashboard's old address
  `/trainer` redirects. (It could not be `/coach` when the split was made — upstream's AI Coach
  owned that path. That feature has since been removed, but `/today` is what shipped and renaming
  a live route to reclaim a path buys nothing.) Coach surfaces are deliberately **English-only**:
  they use raw strings, not `t()`. `views/coach/Business.jsx` — the activity log and account
  disabling — is the operator surface that convention came from, inherited from the gym `Admin.jsx`
  that P6 deleted.
- **`StatsPanels`** (`views/Stats.jsx`) is exported and prop-driven so the coach sees a client's
  own charts by passing a different `S`. Keeping panels prop-driven is what makes every new
  client-side metric free on the coach side — do not reach for `useStore` inside one.
- **`lib/adherence.js`** — are they training on the days their plan says? `lib/measurements.js` —
  the tape, shaped like `S.bodyweight` so it rides the same sync and the same chart.
- Languages trimmed to **en/de/es/fr** (`lib/i18n-core.js`). English has no pack; the others must
  stay in sync or `check-locales.mjs` fails. `check-source-strings.mjs` is report-only.

Upstream's description of the product follows, and still holds for the shared parts.

## What this is

openGym is a self-hosted gym & body-weight tracker PWA. A Node API and a folder of static files, plus a
`./data` folder the user owns — no third-party account, no telemetry. Passkey (WebAuthn) login,
installable as a home-screen app, optional Capacitor shells for standalone Android/iOS builds.

## Project layout

```
frontend/  React 19 + Vite app (src/views, src/components, src/store, src/lib). Builds to static files.
           android/ + ios/ are the Capacitor shells for the standalone mobile app (docs/MOBILE.md).
api/       backend — server.js (Node, no framework), deps: @simplewebauthn/server, web-push.
mcp/       optional MCP server — read-only stdio bridge exposing a user's workouts/1RM/muscle
           balance to LLM clients (Claude Desktop, Cursor…). Not part of a deploy; only
           runs when an LLM client spawns it.
media/     exercise img/gif, gitignored, fetched by scripts/fetch-media.sh.
site-coach/ THIS product's marketing site → **fitpal.ma** (the apex), Cloudflare Pages
           project `fitpal-coach`, gated by DEPLOY_SITE_COACH. Plain HTML/CSS/JS.
site/      FitPal, the white-label GYM product's site → gym.fitpal.ma, Pages project
           `fitpal`, gated by DEPLOY_SITE. A different product to a different buyer.
website/   openGym upstream's inherited site. Not deployed from here.
docs/      SELF_HOSTING.md, MOBILE.md.
```

## Commands

```bash
# Exercise media (~140 MB, once)
cp .env.example .env
./scripts/fetch-media.sh

# The API
cd api && npm ci && node server.js       # :3000

# Frontend dev server (hot reload), proxies /api to :3000
cd frontend && npm install && npm run dev

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

Five jobs: `test` (frontend, incl. `check:i18n`), `frontend-next-node`, `api`, `api-smoke`
(`coach-smoke.sh`) and `mcp`. There used to be `api-image` and `web-image` too, which built and
booted the Docker images; those images were never part of how this deploys and are gone.
**`test.yml` has path filters**; anything outside `frontend/`, `api/`, `mcp/` and those two
scripts runs no checks at all, and GitHub reports "no checks" rather than failing.

Several `check-*.mjs` scripts guard things a test cannot see, and are wired into CI:

- `api/scripts/check-bundle-complete.mjs` — walks the import graph *inside the built deploy
  bundle*. A module missing from the bundle exists in the repo, so CI running from the repo can
  never see it; this has taken the API down twice.
- `api/scripts/check-adherence-window.mjs` — ties `ADHERENCE_SEND_DAYS` (api) to
  `ADHERENCE_WINDOW_DAYS` (frontend) across a boundary neither side can import across.

Node in the images is **26** (`node:26-alpine`), but the live cPanel deployment runs Node 22 —
they are separate paths and do not have to match.

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

### API (`api/server.js`)

Single file, no framework, plain `node:http`. Requests are dispatched through a `routes` object
keyed by `'METHOD /path'` (e.g. `routes['GET /api/health']`) matched against `req.method + ' ' +
url.pathname` — add a new endpoint by adding a key here. State is two flat JSON files under
`DATA_DIR` (`db.json`: users/credentials/subscriptions/invites; `state-<uid>.json`: per-user
workout data), written with a write-temp-then-rename atomic pattern (`atomicWrite`). Auth is
WebAuthn passkeys (`@simplewebauthn/server`) plus a signed session cookie (HMAC'd with a
`DATA_DIR/secret` generated on first boot) — no JWT/session-store dependency. Optional pieces
gated by env vars: `ADMIN_UIDS` (admin dashboard), `INVITE_ONLY` (signup needs a code),
`ALLOW_GUEST` (client-only guest mode never hits the server at all), plus a rotating
`data/audit.log` (JSONL) for sign-in/admin events. Web Push (`web-push`, VAPID keys
auto-generated into `data/vapid.json`) drives rest-timer-over and day-reminder notifications.

### MCP server (`mcp/src`)

Read-only stdio MCP bridge (`@modelcontextprotocol/sdk`) that lets an LLM client read a single
user's routines/workouts/body-weight/1RM/muscle-balance directly from the same `DATA_DIR` the API
writes to — no network call, no extra process to run. `state.js` loads/derives the data, `tools.js`
defines the exposed MCP tools (zod-validated schemas), `labels.js` maps internal keys to
human-readable labels, `index.js` wires it together. See `mcp/README.md` for the client-config
side (Claude Desktop / Cursor).

### Passkeys and self-hosting constraints

WebAuthn passkeys are bound to an exact hostname (`RP_ID`) and require HTTPS (localhost excepted)
— this shapes a lot of the API and Settings code (`RP_ID`/`ORIGIN` env vars, guest-mode fallback
when neither is available). Read `docs/SELF_HOSTING.md` before touching auth, session, or
notification code; it documents the exact env-var contract (`RP_ID`, `ORIGIN`, `PORT`,
`DATA_DIR`, `SESSION_DAYS`, `ADMIN_UIDS`, `INVITE_ONLY`, `ALLOW_GUEST`,
`AUDIT_*`, `VAPID_SUBJECT`) that real deployments depend on.

### Deploy

Two rsync workflows onto one cPanel account: `deploy-api.yml` sends the API as source plus
`node_modules`, `deploy-web.yml` sends `frontend/dist/`. There is no container runtime anywhere in
this — shared hosting does not offer one, which is why the Docker images that used to live here
were built by CI, published, and never run. `docs/DEPLOY_COACH_SUBDOMAIN.md` is required reading
before touching either workflow.

The app and the API must be served from ONE origin: Apache hands out `dist/` and proxies `/api` to
the Node process. Passkeys are bound to the origin and the session cookie is scoped to it, so two
hostnames or two ports breaks both.

## Guidelines from CONTRIBUTING.md worth knowing before changing code

- **Dependency-light is a hard constraint, not a preference.** Frontend: React + Router + Zustand
  and nothing else. `api/`: two dependencies total (`@simplewebauthn/server`, `web-push`). `undici` was the
  third until the AI Coach went — its only callers were that feature's HTTP adapters. New dependencies are a hard sell either side.
- Don't commit `media/` or `data/` (gitignored).
- Training-logic changes (progression, 1RM, session read-back) need a unit test in `src/lib`
  beside the code, not just manual clicking-through.
