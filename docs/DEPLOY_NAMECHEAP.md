# Deploying FIT'ONE to Namecheap shared hosting

The API runs as a cPanel **"Setup Node.js App"** application (Phusion Passenger); the
frontend is a static build served from `public_html`. CI/CD lives in these workflows:

- `.github/workflows/test.yml` — test phase; runs on every PR and push to main
  (frontend suite + build + locale checks, api unit tests + parse gate, mcp).
- `.github/workflows/deploy-api.yml` — deploys the API via rsync over SSH after the tests
  pass in the same run. **Off by default** until you finish the setup below.
- `.github/workflows/deploy-web.yml` — builds the frontend (media pointed at the
  pinned jsDelivr dataset mirror) and syncs `dist/` into `public_html` via rsync over SSH,
  with the same guardrails. **Off by default** (`DEPLOY_WEB` variable).
- `.github/workflows/deploy-site.yml` — the **fitpal.ma marketing site** (`site/`),
  hosted on the same cPanel account as an addon domain. HTML/SEO check job on every
  PR and push; SSH deploy **off by default** (`DEPLOY_SITE` variable). Site-specific
  setup lives in [site/README.md](../site/README.md).

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
3. **Enable SSH and authorize a deploy key** (all three deploy workflows use rsync
   over SSH on port 21098):
   - Namecheap dashboard → Hosting List → *Manage* → enable **Shell Access** (on
     some plans it's already on; on others a support ticket flips it).
   - Generate a dedicated key pair locally: `ssh-keygen -t ed25519 -f fitpal_deploy -N ""`
   - cPanel → *SSH Access* → *Manage SSH Keys* → **Import Key** (paste
     `fitpal_deploy.pub`) → then **Manage → Authorize** it.
   - Test from your machine: `ssh -i fitpal_deploy -p 21098 <cpanel-user>@<server>`
   - The private key goes into the `SSH_KEY` GitHub secret (next section) and
     nowhere else. Note: unlike the old per-folder FTP accounts, this key is the
     full cPanel account — the workflows compensate by rsync-ing only their own
     target directory with server-owned paths excluded.

## One-time GitHub setup

Repository → Settings:

| Where | Name | Value |
|---|---|---|
| Secrets → Actions | `SSH_HOST` | the hosting server, e.g. `serverNNN.web-hosting.com` (from the welcome email) |
| Secrets → Actions | `SSH_USER` | the cPanel username |
| Secrets → Actions | `SSH_KEY` | the **private** key authorized in cPanel (full contents of `fitpal_deploy`) |
| Variables → Actions | `SSH_PORT` | optional; default `21098` (Namecheap shared SSH port) |
| Variables → Actions | `SSH_KNOWN_HOSTS` | optional but recommended: output of `ssh-keyscan -p 21098 <server>` — pins the host key; without it each run trusts on first use |
| Variables → Actions | `DEPLOY_API` | `true` — the master switch; deploys are skipped until this exists |
| Variables → Actions | `API_SERVER_DIR` | optional; path relative to home, default `opengym-api/` |
| Variables → Actions | `API_HEALTH_URL` | e.g. `https://yourdomain.com/api/health` — enables the post-deploy check |
| Variables → Actions | `DEPLOY_WEB` | `true` — master switch for the frontend deploy |
| Variables → Actions | `WEB_SERVER_DIR` | optional; default `public_html/` |
| Variables → Actions | `WEB_URL` | e.g. `https://yourdomain.com/` — enables the post-deploy check |
| Variables → Actions | `WEB_IMG_BASE` / `WEB_GIF_BASE` | optional; override the jsDelivr media mirror if you host the exercise dataset yourself |
| Variables → Actions | `DEPLOY_SITE` | `true` — master switch for the marketing-site deploy |
| Variables → Actions | `SITE_SERVER_DIR` | the fitpal.ma addon domain's document root relative to home, default `fitpal.ma/` |
| Variables → Actions | `SITE_URL` | `https://fitpal.ma` — enables the post-deploy check |

**Approval gate (recommended):** Settings → Environments → `production` → add yourself
under *Required reviewers*. Every deploy then pauses until a human clicks approve.

**Branch protection:** on a paid plan, require the `test`, `api` and `mcp` checks on
`main`. On the free private tier that setting isn't enforceable — the pipeline compensates
by re-running the api tests inside the deploy workflow itself, so nothing unreviewed can
deploy without at least passing tests.

## What a deploy does

Push to `main` touching `api/**` → api tests re-run → (approval, if configured) → the
bundle (`server.js`, `domain.mjs`, production `node_modules`, `tmp/restart.txt`) is synced
via rsync over SSH → the changed `tmp/restart.txt` makes Passenger restart the app → the workflow
polls `API_HEALTH_URL` for up to 2 minutes and fails loudly if the API doesn't come back.
`.env`-style files, `data/`, `secret` and `vapid.json` are never uploaded or deleted.

## Frontend

Automated by `deploy-web.yml`: push to `main` touching `frontend/**` → the frontend suite
re-runs → (approval, if configured) → the app is built with `VITE_IMG_BASE`/`VITE_GIF_BASE`
pointing at the pinned jsDelivr dataset mirror (shared hosting has no local media download,
unlike the Docker web container) → `dist/` is synced into `public_html` → the workflow
fetches `WEB_URL` and fails if the page doesn't serve the app. The rsync `--delete`
mirrors the build exactly but excludes the server-owned paths in `public_html`
(`.htaccess`, `.well-known/`, `cgi-bin/`), so cPanel and AutoSSL keep working. The app calls `/api`
on its own origin, which is exactly where the Node app is mounted; it uses hash routing,
so no `.htaccess` rewrites are needed.

## Inherited upstream workflows

`docker-publish.yml` and `pages.yml` come from upstream openGym and don't apply to this
deployment (no Docker registry, no GitHub Pages demo). They are **disabled in the
repository's Actions settings** rather than deleted, so upstream merges stay conflict-free.
Re-enable them from the Actions tab if that ever changes.
