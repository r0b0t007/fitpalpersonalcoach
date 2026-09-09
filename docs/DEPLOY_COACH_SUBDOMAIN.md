# Deploying FitPal Coach to coach.fitpal.ma

This product shares a cPanel account with FIT'ONE, which deploys from
`r0b0t007/opengym-fitone`. That is the whole reason this document exists: both repos run
`rsync --delete`, which removes everything at the target that is not in the source. A wrong
directory value does not fail — it deletes the other product.

| | FIT'ONE (`opengym-fitone`) | FitPal Coach (this repo) |
|---|---|---|
| Frontend | `public_html/` → app.fitpal.ma | `coach.fitpal.ma/` |
| API | `opengym-api/` | `fitpal-coach-api/` |
| Marketing site | `fitpal.ma/` | **never deployed from here** |

No path is shared. `DEPLOY_SITE` must stay unset in this repo — the marketing site belongs to
the other one, and turning it on here would mirror this app over `fitpal.ma`.

## One-time setup in cPanel

1. **Subdomain** — create `coach.fitpal.ma` with document root `~/coach.fitpal.ma`.
   Not under `public_html/`: the other repo mirrors that directory with `--delete`, so a doc
   root inside it is deleted on FIT'ONE's next frontend deploy.

2. **Node.js app** — Setup Node.js App → application root `~/fitpal-coach-api`, Node 22,
   startup file `server.js`, application URL `coach.fitpal.ma/api`.

   What that last field actually does is create **`~/coach.fitpal.ma/api/`** holding a single
   `.htaccess` with the Passenger directives and every environment variable. The directory *is*
   the mount. The frontend build has nothing to put there, so `deploy-web.yml` excludes `/api/`
   from its `rsync --delete` — without that exclude the first frontend deploy silently unmounts
   the API and `/api/health` starts answering **404**, which reads like DNS or a dead app rather
   than a frontend deploy that reached too far. If it ever goes missing, `cloudlinux-selector`
   will not rebuild it (it reports `No such application` precisely because the file is gone);
   copy the block from `~/app.fitpal.ma/api/.htaccess`, swap in this app's root, node path and
   env vars, then `cloudlinux-selector restart --interpreter nodejs --app-root fitpal-coach-api`.

3. **Environment variables** — set in the Node.js app's own *Environment variables* panel, not
   a `.env` file. The API has no `dotenv` dependency, so a `.env` would be read by nothing;
   under Passenger the panel *is* `process.env`. Mirrors how `app.fitpal.ma/api` is configured:

   ```
   RP_ID           coach.fitpal.ma
   ORIGIN          https://coach.fitpal.ma
   RP_NAME         FitPal Coach
   DATA_DIR        /home/pawputif/fitpal-coach-data
   INVITE_ONLY     1
   ALLOW_GUEST     0
   REQUEST_ACCESS  0
   BOOTSTRAP_CODE  <32 hex chars, unique to this instance>
   ```

   `RP_ID` is load-bearing. WebAuthn passkeys are bound to an exact hostname, so a passkey
   created on `app.fitpal.ma` cannot sign in here and vice versa. That is correct — these are
   separate products with separate accounts — but it means everyone enrols here fresh.
   `BOOTSTRAP_CODE` is what lets the very first account be created on an `INVITE_ONLY`
   instance; it stops working once a user exists. Never reuse the other instance's.

4. **`~/fitpal-coach-data/`** — a **sibling** of the app root, not a directory inside it. That
   is how `opengym-api` does it (`DATA_DIR=/home/pawputif/opengym-data`), and the reason is
   `rsync --delete`: a data directory inside the deploy target is one exclude away from being
   erased, whereas one outside it cannot be reached at all. It holds users, passkey
   credentials, the session secret and every client's training. **This is the directory to
   back up.**

5. **DNS** — `fitpal.ma` is on Cloudflare (`braden`/`natasha.ns.cloudflare.com`), so cPanel's
   own zone is not authoritative. Add the record in Cloudflare:

   ```
   A   coach   198.54.116.94   (proxied, matching how app.fitpal.ma is set up)
   ```

   Until that exists the subdomain is NXDOMAIN and AutoSSL cannot issue a certificate for it.

## One-time setup in GitHub

Already set as repository variables:

```
WEB_SERVER_DIR    coach.fitpal.ma/
API_SERVER_DIR    fitpal-coach-api/
WEB_URL           https://coach.fitpal.ma
API_HEALTH_URL    https://coach.fitpal.ma/api/health
SSH_PORT          21098
SSH_KNOWN_HOSTS   (copied from opengym-fitone)
```

Set as environment secrets on `production`:

```
SSH_HOST    server215.web-hosting.com
SSH_USER    <cPanel username>
SSH_KEY     private half of a key whose public half is authorized in cPanel → SSH Access
```

The key is `fitpal_coach_ci`, an ed25519 pair generated locally with an **empty passphrase** and
imported to cPanel as a public key only. A passphrase-protected key cannot work here: the deploy
runs `ssh` non-interactively with no agent, so it fails with a bare
`Permission denied (publickey)` that says nothing about the passphrase being the cause. Set the
secret straight from the file so the private half never passes through a clipboard or a shell
history:

```
gh secret set SSH_KEY --repo r0b0t007/fitpalpersonalcoach --env production < ~/.ssh/fitpal_coach_ci
```

`gh secret set` reports success even when its input was empty, and an empty `SSH_KEY` fails later
and obscurely — if a deploy dies at "Set up SSH", suspect that before anything else.

Deploys are on:

```
DEPLOY_WEB=true
DEPLOY_API=true
```

## The guard

`deploy-web.yml` and `deploy-api.yml` each refuse a target of `""`, `.`, `./`, `..`, `~`, `/`
or `$HOME` before rsync runs. Any of those resolves to the account home, where `--delete`
would take `public_html/`, `opengym-api/`, `fitpal.ma/`, `mail/` and `.ssh/` with it. The
failure mode is a red build rather than a restore from backup.

Two related fixes live alongside it: the excludes are anchored (`/data/`, not `data/`, which
rsync would otherwise match at every depth including inside `node_modules/`), and the api sync
passes `-K` so cPanel's `node_modules` symlink into the Node venv is written *through* rather
than replaced with a real directory.

## `~/coach.fitpal.ma/.htaccess` — the shell must not be cached

**This file is on the server and not in the repo, so nothing will recreate it.** `deploy-web.yml`
excludes `/.htaccess` from its `rsync --delete` (that exclude is what stops a deploy deleting
server-owned config), which also means a copy under `frontend/dist/` would never reach the
server. If the subdomain is ever rebuilt, write it again:

```apache
<IfModule mod_headers.c>
  <FilesMatch "^(sw\.js|index\.html|manifest\.json|offline\.html)$">
    Header set Cache-Control "no-cache, must-revalidate"
  </FilesMatch>
</IfModule>
```

`sw.js` is the one that matters. Without this it is served with Cloudflare's default
`max-age=14400`, so for **four hours after every deploy** the edge hands out the previous service
worker — which then serves the previous shell out of its own cache. Browsers honour that max-age
too: a service worker is only force-revalidated when its `max-age` exceeds 86400, and 14400 is
under it. The symptom is a deploy that reports success while the app in front of you, and in
front of every client, is the old one. It cost an hour once already: the fix was live at the
origin and invisible in the browser.

Hashed files under `assets/` are deliberately untouched — their names change every build, so
they should be cached hard.

The Docker path gets the same rules from `web/nginx.conf.template`, which already sets
`no-cache, must-revalidate` on `js|css|json|html`. This file is only needed because the cPanel
deployment serves the static build through LiteSpeed instead, and never renders that template.

**After a deploy, Cloudflare still holds the old `sw.js` until its TTL expires.** Purge it (or
the whole zone) to make a release land immediately rather than within four hours.

## Checking it worked

```
curl -fsS https://coach.fitpal.ma/api/health     # {"ok":true,...}
curl -fsS https://coach.fitpal.ma | grep '<title'

# Did the release actually reach the browser? Compare what the origin serves against what the
# page loaded — a service worker will happily keep serving the previous bundle, and a plain
# refresh does not tell you which one you are looking at.
curl -s https://coach.fitpal.ma | grep -o 'assets/index-[^"]*\.js'
```

A `525` immediately after a deploy is Cloudflare failing its TLS handshake to the origin while
Passenger restarts. It clears within seconds — the deploy's own health check retries twelve
times for exactly this reason, so trust that over a single `curl`.

The frontend health check greps the served HTML for `<title>FitPal Coach`, which is set in
`frontend/index.html` (not from `brand.js` — index.html cannot import ESM). It is deliberately
the *full* title rather than a prefix: the failure this guards against is these two products
being deployed over each other, and `FIT` matched both brands, so the old prefix would have
passed while serving the wrong app. Change the grep, `index.html` and `brand.js` in one commit
or the deploy goes red on a build that is otherwise fine.
