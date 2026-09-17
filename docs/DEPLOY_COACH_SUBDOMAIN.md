# Deploying FitPal Coach to coach.fitpal.ma

This product shares a cPanel account with FIT'ONE, which deploys from
`r0b0t007/opengym-fitone`. That is the whole reason this document exists: both repos run
`rsync --delete`, which removes everything at the target that is not in the source. A wrong
directory value does not fail — it deletes the other product.

**That danger is real but narrow. It applies to `deploy-web.yml` and `deploy-api.yml` only**,
the two workflows that reach the cPanel box over SSH. The marketing sites are not on that box.

| | FIT'ONE (`opengym-fitone`) | FitPal Coach (this repo) |
|---|---|---|
| Frontend | `public_html/` → app.fitpal.ma | `coach.fitpal.ma/` (cPanel, rsync) |
| API | `opengym-api/` | `fitpal-coach-api/` (cPanel, rsync) |
| Marketing site | — | `site-coach/` → **fitpal.ma**, Cloudflare Pages project `fitpal-coach` |
| Gym marketing site | — | `site/` → **gym.fitpal.ma**, Cloudflare Pages project `fitpal` |

No cPanel path is shared.

## Mail for fitpal.ma is not on this box

Worth stating here because the guard section below lists `mail/` among the directories an
`rsync --delete` accident could take: that directory is not where `@fitpal.ma` mail lives.

`fitpal.ma`'s `MX` records point at `mx1/2/3-hosting.jellyfish.systems` (162.255.118.28/29),
which is **Namecheap Private Email**, a separate product from this cPanel account. Mailboxes,
aliases and forwarders for the domain are managed at `privateemail.com`, and a forwarder
created in cPanel for `fitpal.ma` never fires. cPanel's Email Routing screen reports the
domain as *Automatically Detect Configuration : Remote*, which is correct.

`pawpawcare.app`, on the same cPanel account, is the contrast: its `MX` is
`mail.pawpawcare.app`, which resolves to the hosting box, so cPanel forwarders do work there.
Do not generalise from one domain on this account to another.

### An earlier version of this file said the opposite. Do not restore it.

It read: *"`DEPLOY_SITE` must stay unset in this repo — the marketing site belongs to the other
one, and turning it on here would mirror this app over `fitpal.ma`."*

That was written when `fitpal.ma` was a cPanel directory reachable by `rsync --delete`. The
marketing site moved to Cloudflare Pages on 2026-08-31 (commit `db4a635`), and `deploy-site.yml`
is now a `wrangler pages deploy` that touches no cPanel path at all. The sentence was also wrong
on its own terms: `deploy-site.yml` publishes `site/`, a marketing site, not the app.

`DEPLOY_SITE` and `DEPLOY_SITE_COACH` are both **on**. Turning either off takes a live marketing
site down.

**The residual risk is different and still real.** Both marketing sites are Cloudflare Pages
*projects*, and a Pages project can be pushed to from more than one repository. If
`opengym-fitone` also deploys to project `fitpal`, the two repos race and the last deploy wins.
That is a last-writer-wins race, not an `rsync --delete` wipe, and it is recoverable through
Pages' atomic per-deployment rollback — but confirm project ownership before assuming a deploy
here is the only one.

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
  <FilesMatch "^(sw\.js|index\.html|manifest\.json)$">
    Header set Cache-Control "no-cache, must-revalidate"
  </FilesMatch>
</IfModule>
```

**The edge cache is the thing this fixes, not the browser cache.** Without these headers
Cloudflare cached `sw.js` outright — `cf-cache-status: HIT`, `max-age=14400` — and handed out the
*previous* service worker for four hours after a deploy, which then served the previous shell
from its own cache. The symptom is a deploy that reports success while the app in front of you,
and in front of every client, is the old one. It cost an hour once already: the fix was live at
the origin and invisible in the browser.

With the header set, `sw.js` returns `cf-cache-status: REVALIDATED` — the edge checks the origin
on every request instead of serving a stored copy blind. That is the fix.

Two things are worth knowing so nobody "fixes" this again in the wrong place:

- **Cloudflare rewrites the browser-facing header on `.js`.** The zone's *Browser Cache TTL* is
  4 hours, so `sw.js` still goes out as `max-age=14400, must-revalidate` however the origin
  labels it. On anything that implements `updateViaCache` that is inert: `main.jsx` calls
  `navigator.serviceWorker.register('sw.js')` with no options, and the default (`'imports'`)
  makes the browser bypass its HTTP cache for the worker script itself. **Safari before iOS 16.4
  does not implement it** and will honour the four hours — and this is an installed iOS PWA, so
  that case is real rather than theoretical. If an iPhone is stuck on an old release for a few
  hours after a deploy, this is why, and *Browser Cache TTL → Respect Existing Headers* is the
  fix. It is zone-wide, so it also changes `fitpal.ma` and `app.fitpal.ma`.
- **`index.html` keeps `no-cache` intact**, because Cloudflare treats it as DYNAMIC and passes
  the origin header through. That is the one that really matters: it names the hashed bundle, so
  a cached copy pins a client to an old release no matter how fresh everything else is.

Hashed files under `assets/` are deliberately untouched — their names change every build, so
they should be cached hard.

This file exists because the cPanel deployment serves the static build through LiteSpeed, and
the `.htaccess` above is the only place its cache headers are set. There used to be a second
path — an nginx config in a `web/` container, which matched `location ~* \.(js|css|json|html)$`
and so gave *every* `.js` `no-cache`, including the hashed `assets/index-<hash>.js` that this
`.htaccess` deliberately leaves cacheable. Docker is gone and this is now the only path, but the
distinction is worth keeping in mind: widening the `FilesMatch` to cover hashed assets would be a
real change to how the bundle caches, not a tidy-up.

A one-off purge was needed when these headers were first added, because the edge was still
holding the pre-fix copy: Caching → Configuration → Custom Purge → **URL**, one line,
`https://coach.fitpal.ma/sw.js`. Purge by URL rather than *Purge Everything* — the zone also
serves `fitpal.ma` and `app.fitpal.ma`. No purge is needed after later deploys; that is the whole
point of `REVALIDATED`.

## Checking it worked

```
curl -fsS https://coach.fitpal.ma/api/health     # {"ok":true,...}
curl -fsS https://coach.fitpal.ma | grep '<title'

# Did the release actually reach the browser? Three different answers are possible, so read all
# three — a plain refresh tells you none of them.
#   1. the origin, bypassing Cloudflare entirely
curl -s --resolve coach.fitpal.ma:443:198.54.116.94 https://coach.fitpal.ma | grep -o 'assets/index-[^"]*\.js'
#   2. what the edge is handing out
curl -s https://coach.fitpal.ma | grep -o 'assets/index-[^"]*\.js'
```

```js
//   3. what the page in front of you actually loaded — paste in the browser console. A service
//      worker will happily go on serving the previous bundle after both of the above are current.
[...document.querySelectorAll('script[src]')].map(s => s.src.split('/').pop())
```

A `525` immediately after a deploy is Cloudflare failing its TLS handshake to the origin while
Passenger restarts. It clears within seconds, so trust the workflow over a single `curl` — but
know how much patience each one has, because they differ:

| | retries | total |
|---|---|---|
| `deploy-api.yml` | 12 × 10s | ~2 min |
| `deploy-web.yml` | 6 × 5s | **30 s** |

Two minutes is comfortably longer than a Passenger restart; thirty seconds is not always. A red
`deploy-web` right after a frontend-only push is more likely a slow origin than a bad build —
re-run it before going looking for the bug.

The frontend health check greps the served HTML for `<title>FitPal Coach`, which is set in
`frontend/index.html` (not from `brand.js` — index.html cannot import ESM). It is deliberately
the *full* title rather than a prefix: the failure this guards against is these two products
being deployed over each other, and `FIT` matched both brands, so the old prefix would have
passed while serving the wrong app. Change the grep, `index.html` and `brand.js` in one commit
or the deploy goes red on a build that is otherwise fine.
