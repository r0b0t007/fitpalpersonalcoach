# Deploying FitPal Coach to coach.fitpal.ma

This product shares a cPanel account with FIT'ONE, which deploys from
`r0b0t007/opengym-fitone`. That is the whole reason this document exists: both repos run
`rsync --delete`, which removes everything at the target that is not in the source. A wrong
directory value does not fail — it deletes the other product.

**That danger is real but narrow. It applies to `deploy-web.yml` and `deploy-backend.yml` only**,
the two workflows that reach the cPanel box over SSH (and `deploy-api.yml`, the retired Node
deploy, until the owner deletes it; it is switched off with `DEPLOY_API=false`). The marketing sites are not on that box.

| | FIT'ONE (`opengym-fitone`) | FitPal Coach (this repo) |
|---|---|---|
| Frontend | `public_html/` → app.fitpal.ma | `coach.fitpal.ma/` (cPanel, rsync) |
| API | `opengym-api/` | `fitpal-coach-backend/` (cPanel, rsync; `coach.fitpal.ma/api` is a symlink to its `public/`) |
| Marketing site | — | `site-coach/` → **fitpal.ma**, Cloudflare Pages project `fitpal-coach` |
| Gym marketing site | — | `site/` → **gym.fitpal.ma**, Cloudflare Pages project `fitpal` |

No cPanel path is shared.

## Mail for fitpal.ma is not on this box

Worth stating here because the guard section below lists `mail/` among the directories an
`rsync --delete` accident could take: that directory is not where `@fitpal.ma` mail lives.

**Inbound:** `fitpal.ma`'s `MX` records are `route1/2/3.mx.cloudflare.net`, which is
**Cloudflare Email Routing**. Addresses and where they forward to are managed in the Cloudflare
dashboard (fitpal.ma → Email → Email Routing), and a forwarder created in cPanel for `fitpal.ma`
never fires. (An earlier version of this section said Namecheap Private Email; the `MX` has moved
since. Check the records, not this paragraph, before changing anything: `dig MX fitpal.ma`.)

**Outbound:** the backend sends its own mail (sign-in links, account emails) through **Resend**
(`MAIL_MAILER=resend`, from `no-reply@fitpal.ma`), with the domain verified there. Nothing sends
from this box.

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

2. **The backend** — `~/fitpal-coach-backend/`, a sibling of the docroot. `deploy-backend.yml`
   fills it (source and `vendor/`), but refuses a target with no `.env`: the first one is written
   by hand on the server, so a deploy can never boot on defaults (`docs/CUTOVER_R5.md` has how,
   with no secret echoed). The API is mounted by a symlink:

   ```
   ~/coach.fitpal.ma/api  ->  ~/fitpal-coach-backend/public
   ```

   `deploy-web.yml` excludes `/api` both as a directory and as a symlink, so a frontend deploy's
   `--delete` cannot take the mount. Without that, `/api/config` starts answering **404**, which
   reads like DNS or a dead app rather than a frontend deploy that reached too far. One cron line
   runs the scheduler (the reminders, the queue, the prune and the nightly database dump; see
   **Cron** below).

   Until the R5 cutover (2026-10-26) the API was a Node.js app under Passenger, registered in
   Setup Node.js App, whose `.htaccess` in `~/coach.fitpal.ma/api/` *was* the mount and held its
   environment. That registration is gone (CHW-300) and the Node files go in CHW-301.

3. **Environment** — in `~/fitpal-coach-backend/.env` (mode 600), never in the repo. The values
   that are not secret:

   ```
   APP_ENV           production
   APP_DEBUG         false
   RP_ID             coach.fitpal.ma
   ORIGIN            https://coach.fitpal.ma
   RP_NAME           FitPal Coach
   DATA_DIR          /home/pawputif/fitpal-coach-data
   INVITE_ONLY       1
   ALLOW_GUEST       0
   SELF_SERVE_COACH  0
   DB_CONNECTION     mariadb
   MAIL_MAILER       resend
   ```

   plus the secrets (`APP_KEY`, `SESSION_SECRET`, the database password, the Resend key). `RP_ID`
   and `SESSION_SECRET` are load-bearing: passkeys are bound to the exact hostname, and the
   session secret signs every cookie and every paired phone's token, so changing either signs
   everyone out for good. `php artisan fitpal:check-config` checks the file, and every deploy
   runs it.

4. **`~/fitpal-coach-data/`** — a **sibling** of the app, not inside it: a data directory inside
   the deploy target is one exclude away from being erased, whereas one outside it cannot be
   reached at all. Since the cutover it holds only what Laravel reads from disk: `media/` (the
   exercise demos and progress photos), `vapid.json` (the push keys, unless `VAPID_*` is set) and
   `secret` (where `SESSION_SECRET` came from). Accounts and training are in the MariaDB database
   `pawputif_fitpalcoach`, dumped into `~/fitpal-coach-backend/storage/backups` (**Backups**
   below). **Back up both: the database and `media/`.**

5. **DNS** — `fitpal.ma` is on Cloudflare (`braden`/`natasha.ns.cloudflare.com`), so cPanel's
   own zone is not authoritative. Add the record in Cloudflare:

   ```
   A   coach   198.54.116.94   (proxied, matching how app.fitpal.ma is set up)
   ```

   Until that exists the subdomain is NXDOMAIN and AutoSSL cannot issue a certificate for it.

## One-time setup in GitHub

Already set as repository variables:

```
WEB_SERVER_DIR      coach.fitpal.ma/
BACKEND_SERVER_DIR  fitpal-coach-backend
WEB_URL             https://coach.fitpal.ma
BACKEND_CHECK_URL   https://coach.fitpal.ma/api/config
SSH_PORT            21098
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

Deploys:

```
DEPLOY_WEB=true
DEPLOY_BACKEND=true     the kill switch: false stops every backend deploy, merges included
DEPLOY_API=false        the retired Node deploy; goes with deploy-api.yml
```

`API_SERVER_DIR` and `API_HEALTH_URL` were the Node deploy's and can be deleted with it.

## The guard

`deploy-web.yml` and `deploy-backend.yml` each refuse a target of `""`, `.`, `./`, `..`, `~`, `/`
or `$HOME` before rsync runs. Any of those resolves to the account home, where `--delete`
would take `public_html/`, `opengym-api/`, `fitpal.ma/`, `mail/` and `.ssh/` with it. The
failure mode is a red build rather than a restore from backup. `deploy-backend.yml` also refuses
a target naming another product's or the data's directory, one reached through a symlink, and one
with no `.env` (its header lists every rule).

The excludes are anchored (`/.env`, `/storage/`, not `storage/`, which rsync would otherwise match
at every depth), and the backend sync passes `-K` so a directory symlink on the server is followed
rather than replaced.

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

## Laravel backend (measured in CHW-227; live since the R5 cutover)

The backend has served `coach.fitpal.ma/api` since 2026-10-26. The measurements below were taken
before that, on a scratch subdomain of this account, **`lab.fitpal.ma`**, never on
`coach.fitpal.ma`.

**Layout on the box** (scratch names; production in brackets):

```
~/fitpal-coach-lab/backend/       the app: source + vendor/ + .env   [~/fitpal-coach-backend/]
~/lab.fitpal.ma/api  ->  ~/fitpal-coach-lab/backend/public           [~/coach.fitpal.ma/api]
```

**The mount works as a plain symlink.** `<docroot>/api` → `backend/public`, with Laravel's own
`public/.htaccess`: LiteSpeed follows it, rewrites to `index.php`, and the app answers under
`/api` (`/api/health` 200, `/api/config` 200, unknown route `404 {"error":"not found"}`, preflight
`204` with the reflected origin). Production is mounted the same way.

**PHP**: CLI and web both `8.5.11` (`/opt/alt/php85`, CloudLinux alt-php, LiteSpeed SAPI under
the web server). Extensions present: pdo_mysql, pdo_sqlite, sodium, intl, gd, mbstring,
fileinfo, bcmath, openssl, curl, zip, OPcache, and **pcntl** in the CLI (so the queue worker's
`--timeout` is enforced). The host's web defaults are `post_max_size` 1024M,
`upload_max_filesize` 1024M, `memory_limit` 1024M, `max_execution_time` 1500.

**Where the PHP limits come from — measured, not assumed.** This LiteSpeed **ignores
`.user.ini`**: with one in `public/`, the effective values were still the host's 1024M after the
300 s `user_ini.cache_ttl`. It **does honour `php_value` in `.htaccess`**: a `<IfModule Litespeed>`
block in `public/.htaccess` changed `memory_limit`, `post_max_size` and `max_execution_time` on
the next request. So the repo's limits live in `backend/public/.htaccess` (LiteSpeed, mod_php) and
`backend/public/.user.ini` (PHP-FPM elsewhere), same values: 100M / 100M / **768M** / 120 s,
kept equal by `tests/Unit/PhpLimitsTest.php`. Both files, and the `error_log` PHP writes beside
the script, answer 403 to the browser.

**Bodies.** At the origin, raw bodies of 1, 9, 20, 50 and 95 MB all reached `php://input`
byte-exact (SHA-256 matched) in at most 2.5 s, at 4 MB peak memory when streamed. A realistic
**15.9 MB sync** (13,500 workouts, 324,000 sets) costs far more, because Laravel decodes it:

| `PUT /api/data`, 15.9 MB, under LiteSpeed at `memory_limit` 512M | peak | result |
|---|---|---|
| Laravel's own capture: `createFromBase` json-decodes every JSON body into arrays, then DataController decodes it again into objects | 506 MB | **500, out of memory** |
| `App\Http\Request` (used by `public/index.php`): skips the capture decode for this route only | 313–379 MB | 200, 0.9–2.2 s |

Peak memory was read at request shutdown under the web SAPI itself; the same request in the CLI
gave 549 MB and 343 MB. Hence `memory_limit` **768M**, twice the measured peak. Laravel's global
`TrimStrings` and `ConvertEmptyStringsToNull` also skip the route (`bootstrap/app.php`): they walk
every string of the decoded body, which took the first measurement to 8.2 s. A 20.8 MB sync gets
the translated 413, as it should. *Correction:* an earlier pass of this measurement reported
"200 at 256M, 500 at 128M". That came from swapping `memory_limit` in `.htaccess` between
requests, which LiteSpeed caches; the values above, logged inside each request, replace it.

If real states ever approach the 16 MB cap, the remaining cost is DataController's own decode
into objects (needed to strip `active` and read `_ts`); `json_validate()` plus a top-level scan
would avoid building the tree at all.

**Through Cloudflare (measured once `lab` had its proxied record).** Production traffic goes
through the proxy, not to the origin directly, so the bodies were sent again through
`https://lab.fitpal.ma`:

| Request | Result |
|---|---|
| 5 MB, 50 MB, 95 MB at full upload speed | **200**, byte-exact (SHA-256 matched), 3 s / 9.4 s / 15.9 s |
| 101 MB | **413 from Cloudflare** (its HTML page, not the app's JSON): the 100 MB cap is real |
| 10 MB throttled to 60 KB/s (would take ~170 s) | **`524` after 143 s**: a slow upload hits the 100 s origin timeout |

What that means: **through the proxy a request must be fully sent in about 100 seconds.** The
origin's own timing cannot show who buffers the body (LiteSpeed reads it all before PHP starts,
so PHP saw 0.3–0.6 s whatever the upload took); the throttled request is the measurement that
counts. Consequences for the build:

- **Demo videos (R3)**: 90 MB in 100 s needs ≥ ~0.9 MB/s of uplink. Fine on Wi-Fi, not on a weak
  mobile signal. R3 uploads videos in **chunks** (each well under 100 s at slow speeds, and
  resumable), or limits the size the app sends. A grey-cloud (DNS-only) upload hostname would
  dodge both limits but is a second origin for passkeys and the session cookie, so it is the last
  resort, not the plan.
- **Sync (R1)**: 16 MB in 100 s needs ≥ ~160 KB/s. A huge state on a poor connection can 524;
  compressing the body on the client is the cheap fix if that ever shows up. Today's states are
  far below 16 MB.
- **`MEDIA_MAX_VIDEO_MB` must stay below 100**, or Cloudflare refuses with an HTML page the app
  cannot translate.

**Database**: MariaDB `11.4.13`, **default engine MyISAM, default charset latin1**. MyISAM's
1000-byte key limit refuses the first `utf8mb4` string index, so `config/database.php` pins
`'engine' => 'InnoDB'` for both the `mysql` and `mariadb` connections (the charset is `utf8mb4`
per connection). CI now guards it: the `backend` job in `test.yml` runs a MariaDB 11.4 service set
to MyISAM + latin1, migrates up, down and up, and fails on any table that is not InnoDB or not
`utf8mb4` (the step runs with `pipefail`, so a failing query cannot pass as "no bad tables").

Two databases on the account, each with its own user, passwords only in each app's `.env` (mode
600): **production** `pawputif_fitpalcoach` / `pawputif_fitpal` — the live data since the
cutover, never touched by the lab; **lab** `pawputif_fitlab` / `pawputif_fitlab`. The lab runs
`APP_ENV=production`, `APP_DEBUG=false`, and has no production credential. It stays up for the
Creem test store until billing goes live, then is torn down (the app directory, the `lab` symlink,
its database and user, its DNS record; CHW-302).

**Cron**: one line. cPanel mails any cron output to the account contact, so normal runs must print
nothing — `-q` silences `schedule:run` itself — while anything that still prints (PHP failing to
boot, a composer platform check, a fatal error) is appended to a log instead of being thrown away:

```
0,5,10,15,20,25,30,35,40,45,50,55 * * * * cd ~/fitpal-coach-backend && /usr/local/bin/php artisan schedule:run -q >> storage/logs/cron.log 2>&1
```

(Every 5 minutes is what the host keeps; see below.)

Verified on the lab: a normal `schedule:run -q` writes zero bytes, so `cron.log` stays empty while
all is well and only grows when the scheduler itself cannot run — the one failure no Laravel hook
can report, since Laravel never boots.

**The host runs it every 5 minutes, not every minute.** The line was installed as `* * * * *` at
the cutover; on 2026-10-29 it read `0,5,10,15,20,25,30,35,40,45,50,55 * * * *`, like every other
line on the account (pawpawcare's and the lab's already did before it), and the spool file had
been rewritten that day by something other than us. The host appears to enforce a 5-minute
minimum, so installing `* * * * *` again does not stick. The schedule is built for it (CHW-311):
the reminders look back over two ticks' minutes, so none is missed, and arrive up to about 5
minutes late; a queued push waits for the next tick, up to about 5 minutes; and the rest-timer
push, which is no use late, is dropped when it runs more than 30 s past the rest's end
(`RestTimerPush::LATE_SECONDS`). The app's own timer and the phone app's local notification do not
depend on it.

`-q` has a side effect: it puts `SHELL_VERBOSITY=-1` in the environment, which every scheduled
command inherits, so a command's own output is silenced even where the schedule appends it to a
log. A scheduled command whose output matters passes `-v` (the nightly dump does).

**Backups**: two kinds, both `fitpal:backup-db` (gzipped `mariadb-dump --single-transaction`), both
in `~/fitpal-coach-backend/storage/backups`, which no deploy touches:

- `db-<time>-<NN>-<commit>.sql.gz`, the newest five: `deploy-backend.yml` takes one in maintenance
  mode before each deploy, labelled with the commit it deploys. The undo for a bad deploy is the
  first one with that commit's label (a retried run takes another, of the half-migrated state).
- `nightly/db-<time>-<NN>.sql.gz`, the newest fourteen: the schedule takes one at 03:00 UTC
  (CHW-306). The copy of everything written since the last deploy. Each run's own output is in
  `storage/logs/backup.log`; a failed one also logs an error to `laravel.log`. Retry by hand with
  `php artisan fitpal:backup-db --into=nightly --keep=14` — without `--keep=14` the folder is
  pruned to five.

`<NN>` is a counter, so two dumps in the same microsecond never share a name. Both kinds are on the
same cPanel account as the database, so they cover a bad deploy or a bad write, not the loss of
the account. They are also full copies: an account deleted, or audit rows and IPs pruned past
`AUDIT_DAYS`, live on in them for up to two weeks (nightly) or until five more deploys (deploy).

`/usr/local/bin/php` is cPanel's `ea_php_cli` wrapper, which runs the PHP the selector picks for
the account: verified `8.5.11`, `PHP_BINARY=/opt/alt/php85/usr/bin/php`, the same binary the
scheduler then hands its background worker. If the account's PHP is ever changed below 8.4, every
run dies at boot; that lands in `storage/logs/cron.log` (above), not in `laravel.log`. Check
`php -v` after any change in the selector.

Measured on the lab in CHW-227, over 131 consecutive minutes it fired in **every minute (0
missed)**, but not on the minute: the start is spread across the minute (2 s to 51 s, median 23 s)
— the host staggers user crons. That was before the host's 5-minute rewrite above; each tick still
starts that late.

**Queue under LVE**: `queue:work database --max-time=55 --sleep=1 --stop-when-empty` from the
scheduler, `runInBackground()`. Six 20-second jobs: the first worker ran three (55 s budget) and
exited cleanly, the next minute's worker ran the other three; no LVE kill, no failed job, 26 MB per
worker. (With the 5-minute tick, "the next minute's worker" is now the next tick's.) **This schedule is in the repo** (`backend/routes/console.php`), hardened over two reviews:
- `withoutOverlapping(2)`: the overlap lock is released by the background process's finish
  callback, which never runs if the host kills the worker, and Laravel's default expiry is 24
  hours — every push and reminder would silently wait until tomorrow.
- `--timeout=50`: `--max-time` is only checked between jobs, so a worker lives up to 55 + 50 =
  105 s — under the 2-minute lock (never two workers at once) — and no job runs past the database
  queue's 90 s `retry_after` (never handed out twice). A job class can override `--timeout` with
  its own `$timeout`, so `tests/Unit/QueueBoundsTest.php` refuses any job above 50 s and checks
  the arithmetic against `config/queue.php`.
- The connection and queue come from `config/queue.php` — the same values `dispatch()` uses — so a
  changed `QUEUE_CONNECTION` or `DB_QUEUE` cannot leave jobs on a queue nobody drains. A job sent
  with `onQueue('other')` still needs that name added to the schedule.
- `--tries=3 --backoff=30`: a push that fails on a network blip is retried, not dropped.
- Failures are logged where an operator looks, `storage/logs/laravel.log`: each job that fails for
  good (`Queue::failing` in `AppServiceProvider`, with the job and the error), and a worker that
  exits non-zero (a job hit `--timeout`, or the worker could not start) as a warning.

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

**TLS and DNS**: `lab.fitpal.ma` is `A 198.54.116.94`, **proxied**, auto TTL — the same as
`coach` and `app` — created with the Cloudflare CLI (`cf dns records create -z fitpal.ma`), with a
comment on the record saying to tear it down before the R5 cutover. The zone's SSL mode is
**`full`** (not strict), so Cloudflare accepts the origin's shared `*.web-hosting.com`
certificate and `https://lab.fitpal.ma/api/health` answers publicly; AutoSSL was asked to issue
the vhost its own certificate. On teardown: delete the record, the `lab` subdomain in cPanel, the
app directory, and the lab database and user.

**PHP's own `error_log`**: on this host PHP writes fatal errors to an `error_log` file beside the
script — in `public/`, the web root. The host answers 403 for it, and `public/.htaccess` denies it
as well; it contained only the stack traces from the deliberate out-of-memory tests, and was
deleted.

### The cutover (R5, done)

The swap from the Node mount to the symlink was done on 2026-10-26 (CHW-300), in the order and
with the checks in `docs/CUTOVER_R5.md`: deploys frozen, the Node.js app registration destroyed
(left registered, a restart would have rewritten `<docroot>/api/.htaccess` with its Passenger
block, which through the symlink is `backend/public/.htaccess`), its mount moved out of the
docroot, the data imported once, then the symlink. Rolling back to Node stops being possible once
CHW-301 deletes `api/` and the server's Node files; the undo for a bad backend deploy is its own
database dump (**Backups**).

## Checking it worked

```
curl -fsS https://coach.fitpal.ma/api/config | grep -o '"login_email":[a-z]*'   # Laravel answering
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

A `525` immediately after a deploy is Cloudflare failing its TLS handshake to a slow origin. It
clears within seconds, so trust the workflow over a single `curl` — but
know how much patience each one has, because they differ:

| | retries | total |
|---|---|---|
| `deploy-backend.yml` | 12 × 10s | ~2 min |
| `deploy-web.yml` | 6 × 5s | **30 s** |

Two minutes is comfortably long; thirty seconds is not always. A red
`deploy-web` right after a frontend-only push is more likely a slow origin than a bad build —
re-run it before going looking for the bug.

The frontend health check greps the served HTML for `<title>FitPal Coach`, which is set in
`frontend/index.html` (not from `brand.js` — index.html cannot import ESM). It is deliberately
the *full* title rather than a prefix: the failure this guards against is these two products
being deployed over each other, and `FIT` matched both brands, so the old prefix would have
passed while serving the wrong app. Change the grep, `index.html` and `brand.js` in one commit
or the deploy goes red on a build that is otherwise fine.
