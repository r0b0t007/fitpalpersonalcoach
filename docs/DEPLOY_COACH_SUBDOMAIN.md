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
serves `fitpal.ma`, `gym.fitpal.ma` and `app.fitpal.ma`. No purge is needed after later
deploys; that is the whole point of `REVALIDATED`.

## Laravel backend (draft — measured in CHW-227, finalised at cutover in R5)

The Laravel port (`backend/`) replaces the Node API at cutover. Everything below was measured on
a scratch subdomain of this account, **`lab.fitpal.ma`**, never on `coach.fitpal.ma`.

**Layout on the box** (scratch names; production in brackets):

```
~/fitpal-coach-lab/backend/       the app: source + vendor/ + .env   [~/fitpal-coach-backend/]
~/lab.fitpal.ma/api  ->  ~/fitpal-coach-lab/backend/public           [~/coach.fitpal.ma/api]
```

**The mount works as a plain symlink.** `<docroot>/api` → `backend/public`, with Laravel's own
`public/.htaccess`: LiteSpeed follows it, rewrites to `index.php`, and the app answers under
`/api` (`/api/health` 200, `/api/config` 200, unknown route `404 {"error":"not found"}`, preflight
`204` with the reflected origin). The lab never had a Node app registered, so it does not show
what the coach subdomain's registration will do; see the cutover steps below.

**PHP**: CLI and web both `8.5.11` (`/opt/alt/php85`, CloudLinux alt-php, LiteSpeed SAPI under
the web server). Extensions present: pdo_mysql, pdo_sqlite, sodium, intl, gd, mbstring,
fileinfo, bcmath, openssl, curl, zip, OPcache. The host's web defaults are `post_max_size` 1024M,
`upload_max_filesize` 1024M, `memory_limit` 1024M, `max_execution_time` 1500 — but the
requirement is owned by the repo, not by those defaults: `backend/public/.user.ini` sets 100M /
100M / 256M / 120 s and ships with every deploy. At the origin, raw bodies of 1, 9, 20, 50 and
95 MB all reached `php://input` byte-exact (SHA-256 matched) in at most 2.5 s, at 4 MB peak
memory when streamed; a 20 MB `PUT /api/data` reaches the controller (401 unauthenticated, not
413).

**Not yet measured: the same through Cloudflare.** Every check above went to the origin with
`--resolve` (no public DNS for `lab` yet). Production traffic goes through the proxied record,
and Cloudflare caps request bodies (**100 MB** on Free and Pro) and gives the origin **100 s** to
answer before a `524`. A 90 MB video is inside the cap but close to it, and a slow mobile upload
can outlast 100 s. Before R3's upload work is called done: add the `lab` record (below), repeat
the 50 and 95 MB bodies through the proxy, and time a throttled upload. If either limit bites, the
answers are a lower `MEDIA_MAX_VIDEO_MB` or a DNS-only (grey-cloud) upload hostname.

**Database**: MariaDB `11.4.13`, **default engine MyISAM, default charset latin1**. MyISAM's
1000-byte key limit refuses the first `utf8mb4` string index, so `config/database.php` pins
`'engine' => 'InnoDB'` for both the `mysql` and `mariadb` connections (the charset is `utf8mb4`
per connection). CI now guards it: the `backend-mariadb` job in `test.yml` sets a MariaDB 11.4
server to MyISAM + latin1, runs the migrations up, down and up, and fails on any non-InnoDB table.

Two databases on the account, each with its own user, passwords only in each app's `.env` (mode
600): **production** `pawputif_fitpalcoach` / `pawputif_fitpal` — empty, never touched by the lab
(it was briefly used for the first migration and then wiped); **lab** `pawputif_fitlab` /
`pawputif_fitlab`. The lab runs `APP_ENV=production`, `APP_DEBUG=false`, and has no production
credential. **Tear the lab down before the cutover** (the app directory, the `lab` symlink, its
database and user), so nothing scratch is reachable once real data exists.

**Cron**: one line, with output discarded — cPanel mails any cron output to the account contact,
and `schedule:run` prints on every run:

```
* * * * * cd ~/fitpal-coach-backend && /usr/local/bin/php artisan schedule:run >/dev/null 2>&1
```

Over 131 consecutive minutes it fired in **every minute (0 missed)**, but not on the minute: the
start is spread across the minute (2 s to 51 s, median 23 s) — the host staggers user crons. A job
"every minute" can therefore run up to ~50 s late; reminders keyed on `hh:mm` are unaffected, and
rest-timer pushes keep the spec's fallback (a client-side timer with a local notification).

**Queue under LVE**: `queue:work database --max-time=55 --sleep=1 --stop-when-empty` from the
scheduler, `runInBackground()`. Six 20-second jobs: the first worker ran three (55 s budget) and
exited cleanly, the next minute's worker ran the other three; no LVE kill, no failed job, 26 MB per
worker. **This schedule is in the repo** (`backend/routes/console.php`), with
`withoutOverlapping(2)`: the overlap lock is released by the background process's finish callback,
which never runs if the host kills the worker, and Laravel's default expiry is 24 hours — every
push and reminder would silently wait until tomorrow.

**One thing that bit**: `php artisan optimize` failed with `View path not found`. The cause was
`storage/framework/views` missing on the box — the scratch copy skipped `storage/` — and a config
cache built while it was missing. Git tracks the `storage/framework/*` skeleton, so a checkout has
it; but **R5's deploy excludes `storage/` from the rsync**, so the first deploy must create
`storage/framework/{cache/data,sessions,views}` and `storage/logs` on the server (once, before
`optimize`).

**Careful with `crontab -`**: replacing the crontab from a pipeline that fails half-way installs
a crontab missing the other lines. During this measurement the account's existing
`~/pawpawcare/backend` scheduler line was dropped that way for about one minute and restored by
hand. Edit crontabs by writing the old one to a file, filtering that file, checking the result
still contains every expected line, and only then `crontab <file>`.

**TLS and DNS**: the vhost serves the server's shared `*.web-hosting.com` certificate until
AutoSSL issues one, and AutoSSL needs public DNS. `lab.fitpal.ma` has **no DNS record** yet (the
Cloudflare token available to CI and wrangler can read zones but not edit DNS). For public access
add in Cloudflare: `A lab 198.54.116.94 (proxied)`, as for `coach`.

### Cutover steps this section adds (R5)

In this order; each one closes a way the old mount could come back or the new one could vanish.

1. **`DEPLOY_API=false`** (repository variable) so a push to `api/**` cannot redeploy Node.
2. **Exclude `/api` as a symlink in `deploy-web.yml`**: today it has `--exclude='/api/'`, and an
   rsync rule ending in `/` matches directories only. Once `api` is a symlink the next frontend
   deploy's `--delete` removes it and the API is gone. Add `--exclude='/api'` beside the existing
   rule **before** the symlink exists. (Not changed in CHW-227: deploy workflows are edited by the
   owner.)
3. **Delete the Node.js app registration** for `coach.fitpal.ma/api` in cPanel → Setup Node.js
   App (or `cloudlinux-selector destroy --json --interpreter nodejs --app-root
   fitpal-coach-api`). Left registered, a restart or reconfigure rewrites `<docroot>/api/.htaccess`
   with its Passenger block — which, through the symlink, is `backend/public/.htaccess`.
4. **Move the Passenger directory outside the docroot**, not beside it:
   `mv ~/coach.fitpal.ma/api ~/fitpal-coach-api-mount.bak`. Anything left inside
   `~/coach.fitpal.ma/` other than the excluded paths is deleted by the next web deploy, and with
   it the rollback.
5. `ln -s ~/fitpal-coach-backend/public ~/coach.fitpal.ma/api`, then the checks below.

Rollback: remove the symlink, `mv ~/fitpal-coach-api-mount.bak ~/coach.fitpal.ma/api`,
re-register the Node app with the same app root and URI, `DEPLOY_API=true`.

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
