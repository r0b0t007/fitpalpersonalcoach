# Deploying FIT'ONE to Namecheap shared hosting

The API runs as a cPanel **"Setup Node.js App"** application (Phusion Passenger); the
frontend is a static build served from the `app.fitpal.ma` document root. Both share
one origin — see step 0. CI/CD lives in these workflows:

> **Not `public_html`.** That is the *main* domain's document root on this cPanel
> account, which belongs to a different site. `deploy-web.yml` still defaults to it, so
> `WEB_SERVER_DIR` must be set (see the variables table) — an unset value points an
> rsync `--delete` at the neighbouring site and mirrors this build over it.

- `.github/workflows/test.yml` — test phase; runs on every PR and push to main
  (frontend suite + build + locale checks, api unit tests + parse gate, mcp).
- `.github/workflows/deploy-api.yml` — deploys the API via rsync over SSH after the tests
  pass in the same run. **Off by default** until you finish the setup below.
- `.github/workflows/deploy-web.yml` — builds the frontend (media pointed at the
  pinned jsDelivr dataset mirror) and syncs `dist/` into `WEB_SERVER_DIR` via rsync over
  SSH, with the same guardrails. **Off by default** (`DEPLOY_WEB` variable).
- `.github/workflows/deploy-site.yml` — the **fitpal.ma marketing site** (`site/`).
  No longer on this host: it deploys to **Cloudflare Pages** (project `fitpal`), so
  nothing in this document applies to it. See [site/README.md](../site/README.md).

## One-time cPanel setup

0. **Create the app subdomain** — cPanel → *Domains* → create `app.fitpal.ma` with its
   own document root (e.g. `app.fitpal.ma/`). The React frontend is deployed there by
   `deploy-web.yml`. DNS for it lives in Cloudflare as an A record to the server,
   **proxied (orange cloud)** — see the TLS note below.

   > **TLS comes from Cloudflare, not cPanel.** Namecheap shared hosting has no AutoSSL,
   > and the Standard SSL that ships with the plan covers only `fitpal.ma` and
   > `www.fitpal.ma` — never `app.`. Instead the record is proxied and Cloudflare's
   > Universal SSL (`fitpal.ma` + `*.fitpal.ma`) terminates TLS at the edge, with the
   > zone in **Full** mode so the Cloudflare↔origin hop is encrypted too. This matters
   > beyond tidiness: **passkeys only work in a secure context**, so without HTTPS the
   > app shows "this browser doesn't support passkeys" and nobody can sign in.
   >
   > To upgrade to **Full (strict)**, generate a CSR in cPanel (*SSL/TLS → Certificate
   > Signing Requests*), sign it under Cloudflare → SSL/TLS → *Origin Server* → Create
   > Certificate, install the result on `app.fitpal.ma`, then switch the zone mode.
   > Optional — Full already encrypts both hops; strict additionally validates the
   > origin certificate.

   > **Single origin, deliberately.** The frontend calls `/api/...` relative to its own
   > host, the API has no CORS headers, and the session cookie is `SameSite=Lax`
   > host-only. Serving the API from a separate `api.` subdomain would break sign-in on
   > all three counts. Keep both on `app.fitpal.ma`.

1. **Create the Node.js app** — cPanel → *Setup Node.js App* → Create application:
   - Node.js version: **22**
   - Application root: `opengym-api` (this is what the pipeline uploads into)
   - Application URL: **`app.fitpal.ma/api`** — so the API shares the frontend's origin.
     The server accepts both full `/api/...` paths and Passenger-stripped bare paths.
   - Application startup file: `server.js`
2. **Environment variables** (same screen — do NOT commit these anywhere):
   - `DATA_DIR=/home/<cpanel-user>/opengym-data` — **required**; must live *outside* the
     application root so deploys can never touch member data. Create the folder once.
   - `RP_ID=app.fitpal.ma`, `ORIGIN=https://app.fitpal.ma`, `RP_NAME=FIT'ONE`
     **Pick these before anyone registers** — passkeys bind permanently to `RP_ID`.
   - `ADMIN_UIDS=<your uid>`, `INVITE_ONLY=1`, `REQUEST_ACCESS=1`, `ALLOW_GUEST=0`
     (or whatever policy the club wants — see `.env.example` for what each does)
   - `PORT` is injected by Passenger; leave it unset.

   > **Bootstrap the first admin before turning on `INVITE_ONLY`.** Registration requires
   > a valid invite, every invite is minted by an admin, and admins are recognised only by
   > `ADMIN_UIDS` — so an empty database with `INVITE_ONLY=1` locks *everyone* out,
   > including you. There is no first-user exception in `POST /api/register/options`.
   >
   > Order that works, env vars in the *Setup Node.js App* screen:
   > 1. Set `INVITE_ONLY=0`, restart the app.
   > 2. Open `https://app.fitpal.ma`, *Create new profile*, register your passkey.
   > 3. Read your uid: visit `https://app.fitpal.ma/api/me` in the same browser — you are
   >    signed in from step 2, and it returns `{"user":{"id":"…"}}`. (It needs a session,
   >    not admin, which is what makes this work before `ADMIN_UIDS` is set.) Failing that,
   >    it is `users[0].id` in `$DATA_DIR/db.json` over SSH.
   > 4. Set `ADMIN_UIDS=<that uid>` and `INVITE_ONLY=1`, restart.
   > 5. Confirm the gate is back up — `curl -X POST https://app.fitpal.ma/api/register/options
   >    -H 'Content-Type: application/json' -d '{"name":"x"}'` must return **403**.
   >
   > ⚠️ **Step 1 opens registration to the whole internet.** `app.fitpal.ma` is public and
   > now HTTPS-reachable, so between steps 1 and 4 anyone who finds the host can create a
   > profile. Keep the window to minutes, do it at a quiet hour, and afterwards check the
   > admin dashboard's member list for accounts you didn't create — `/api/health` reporting
   > more than one user is the quick tell.
   >
   > From then on the flow in the README applies: members submit an access request, you
   > approve it in the admin dashboard, and that mints their invite.
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
| Variables → Actions | `API_HEALTH_URL` | `https://app.fitpal.ma/api/health` — enables the post-deploy check |
| Variables → Actions | `DEPLOY_WEB` | `true` — master switch for the frontend deploy |
| Variables → Actions | `WEB_SERVER_DIR` | the `app.fitpal.ma` document root relative to home, e.g. `app.fitpal.ma/` (default `public_html/` is the account's main domain — set this) |
| Variables → Actions | `WEB_URL` | `https://app.fitpal.ma/` — enables the post-deploy check |
| Variables → Actions | `WEB_IMG_BASE` / `WEB_GIF_BASE` | optional; override the jsDelivr media mirror if you host the exercise dataset yourself |
| Variables → Actions | `DEPLOY_SITE` | `true` — master switch for the marketing site (deploys to Cloudflare Pages, not here) |
| Secrets → Actions | `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | marketing-site deploy only — see [site/README.md](../site/README.md) |
| Variables → Actions | `SITE_URL` | `https://fitpal.ma` — enables the marketing site's post-deploy check |

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
unlike the Docker web container) → `dist/` is synced into `WEB_SERVER_DIR` → the workflow
fetches `WEB_URL` and fails if the page doesn't serve the app. The rsync `--delete`
mirrors the build exactly but excludes the server-owned paths in the document root
(`.htaccess`, `.well-known/`, `cgi-bin/`), so cPanel keeps working. The app calls `/api`
on its own origin, which is exactly where the Node app is mounted; it uses hash routing,
so no `.htaccess` rewrites are needed.

## Inherited upstream workflows

`docker-publish.yml` and `pages.yml` come from upstream openGym and don't apply to this
deployment (no Docker registry, no GitHub Pages demo). They are **disabled in the
repository's Actions settings** rather than deleted, so upstream merges stay conflict-free.
Re-enable them from the Actions tab if that ever changes.
