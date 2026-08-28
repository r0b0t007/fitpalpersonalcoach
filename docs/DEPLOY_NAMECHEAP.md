# Deploying FIT'ONE to Namecheap shared hosting

The API runs as a cPanel **"Setup Node.js App"** application (Phusion Passenger); the
frontend is a static build served from `public_html`. CI/CD lives in two workflows:

- `.github/workflows/test.yml` — test phase; runs on every PR and push to main
  (frontend suite + build + locale checks, api unit tests + parse gate, mcp).
- `.github/workflows/deploy-api.yml` — deploys the API over FTPS after the tests
  pass in the same run. **Off by default** until you finish the setup below.

## One-time cPanel setup

1. **Create the Node.js app** — cPanel → *Setup Node.js App* → Create application:
   - Node.js version: **22**
   - Application root: `opengym-api` (this is what the pipeline uploads into)
   - Application URL: your domain + `/api` (or an `api.` subdomain — the server accepts
     both the full `/api/...` paths and Passenger-stripped bare paths)
   - Application startup file: `server.js`
2. **Environment variables** (same screen — do NOT commit these anywhere):
   - `DATA_DIR=/home/<cpanel-user>/opengym-data` — **required**; must live *outside* the
     application root so deploys can never touch member data. Create the folder once.
   - `RP_ID=yourdomain.com`, `ORIGIN=https://yourdomain.com`, `RP_NAME=FIT'ONE`
   - `ADMIN_UIDS=<your uid>`, `INVITE_ONLY=1`, `REQUEST_ACCESS=1`, `ALLOW_GUEST=0`
     (or whatever policy the club wants — see `.env.example` for what each does)
   - `PORT` is injected by Passenger; leave it unset.
3. **Create a dedicated FTP account** (cPanel → *FTP Accounts*) whose directory is the
   application root (`opengym-api`), not your whole home directory — the pipeline's
   credentials then physically cannot write anywhere else.

## One-time GitHub setup

Repository → Settings:

| Where | Name | Value |
|---|---|---|
| Secrets → Actions | `FTP_SERVER` | e.g. `ftp.yourdomain.com` |
| Secrets → Actions | `FTP_USERNAME` | the dedicated FTP account |
| Secrets → Actions | `FTP_PASSWORD` | its password |
| Variables → Actions | `DEPLOY_API` | `true` — the master switch; deploys are skipped until this exists |
| Variables → Actions | `API_SERVER_DIR` | optional; path inside the FTP account, default `opengym-api/` |
| Variables → Actions | `API_HEALTH_URL` | e.g. `https://yourdomain.com/api/health` — enables the post-deploy check |

**Approval gate (recommended):** Settings → Environments → `production` → add yourself
under *Required reviewers*. Every deploy then pauses until a human clicks approve.

**Branch protection:** on a paid plan, require the `test`, `api` and `mcp` checks on
`main`. On the free private tier that setting isn't enforceable — the pipeline compensates
by re-running the api tests inside the deploy workflow itself, so nothing unreviewed can
deploy without at least passing tests.

## What a deploy does

Push to `main` touching `api/**` → api tests re-run → (approval, if configured) → the
bundle (`server.js`, `domain.mjs`, production `node_modules`, `tmp/restart.txt`) is synced
over FTPS → the changed `tmp/restart.txt` makes Passenger restart the app → the workflow
polls `API_HEALTH_URL` for up to 2 minutes and fails loudly if the API doesn't come back.
`.env`-style files, `data/`, `secret` and `vapid.json` are never uploaded or deleted.

## Frontend

`cd frontend && npm run build`, then upload `dist/` to `public_html` (cPanel File Manager
or the same FTP mechanism). The app calls `/api` on its own origin, which is exactly where
the Node app is mounted. Frontend CI (tests + build) already gates every PR; wiring its
upload into a workflow is the same recipe as `deploy-api.yml` with `local-dir: frontend/dist/`.

## Inherited upstream workflows

`docker-publish.yml` and `pages.yml` come from upstream openGym and don't apply to this
deployment (no Docker registry, no GitHub Pages demo). They are **disabled in the
repository's Actions settings** rather than deleted, so upstream merges stay conflict-free.
Re-enable them from the Actions tab if that ever changes.
