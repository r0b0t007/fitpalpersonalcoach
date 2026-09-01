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
   - `INVITE_ONLY=1`, `REQUEST_ACCESS=1`, `ALLOW_GUEST=0`
     (or whatever policy the club wants — see `.env.example` for what each does)
   - `BOOTSTRAP_CODE=<long random string>` — **set this before the first deploy**; see below.
     `ADMIN_UIDS` is not needed to get started: the bootstrap account is made an admin.
   - `PORT` is injected by Passenger; leave it unset.

   > **Why `BOOTSTRAP_CODE` is not optional here.** `INVITE_ONLY=1` on an empty database is
   > a closed loop: registering needs an invite, invites are minted only by an admin, and
   > admins are recognised only by `ADMIN_UIDS` — so nobody, you included, can get in.
   > Generate one with `openssl rand -hex 16`, paste it into the env vars, and restart.
   >
   > Then: open `https://app.fitpal.ma` → *Create new profile* → enter that value in the
   > **Invite code** field. The account is created as an admin, so there is no uid to look
   > up and no second restart. Confirm with `GET /api/me`, which should report
   > `"admin":true`; the app log also prints a `[bootstrap]` line naming the account.
   >
   > The code **disarms itself as soon as any user exists** — re-using it afterwards gets
   > the same 403 as any wrong code, so unlike temporarily running `INVITE_ONLY=0` there is
   > never a window where the public URL accepts anyone who finds it. Values under 16
   > characters are ignored with a warning rather than accepted weak.
   >
   > **Then clear it.** Disarming is a live condition, re-checked per request against the
   > current user count — not a one-time event. If `DATA_DIR` is ever lost or restored from
   > an empty backup, a variable still sitting in cPanel re-arms, and whoever has the code
   > becomes admin. Deleting it once you're in is what makes that impossible.
   >
   > `BOOTSTRAP_CODE` only does anything with `INVITE_ONLY=1` — without it the sign-in form
   > never asks for a code, so there is nowhere to type it and the account is created as an
   > ordinary member. The app warns about this combination at startup.
   >
   > From then on the flow in the README applies: members submit an access request, you
   > approve it in the admin dashboard, and that mints their invite. `ADMIN_UIDS` is how
   > you add *further* admins later.
   >
   > **Coaches need no env var.** The role is stored on the user and granted from the admin
   > dashboard (member → *Coaching* → *Make a coach*), so trainers can be added and removed
   > without a restart. A coach sees only the members assigned to them and cannot manage
   > invites, access requests or accounts.
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

**Branch protection:** on a paid plan, require the `test`, `api`, `mcp` and
`frontend-next-node` checks on `main`. On the free private tier that setting isn't enforceable — the pipeline compensates
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
