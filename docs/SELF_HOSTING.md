# Self-hosting FitPal Coach

A Laravel API (`backend/`, PHP), a static frontend any web server can hand out (`frontend/dist/`),
one database, one folder of media, and one cron line. This guide takes you from "just cloned it"
to "using it from my phone over the internet".

> Until October 2026 the API was a single Node process (`api/server.js`) keeping its data in JSON
> files under `DATA_DIR`. It has been replaced by the Laravel app in `backend/`, which answers the
> same paths with the same JSON shapes and reads the same environment names (bar `PORT`, which is
> gone). Section 11 moves an old instance across.

## 1. Run it locally

Requirements: PHP 8.4 or newer, Composer, Node (only for the frontend), and git. The PHP
extensions Composer will ask for are `ctype`, `curl`, `dom`, `fileinfo`, `filter`, `iconv`, `intl`,
`mbstring`, `openssl`, `pdo_sqlite` (or `pdo_mysql`), `tokenizer`, `xmlreader` and `zip`, plus
`zlib` for the database dumps. `sodium` and `gmp` or `bcmath` are worth having too (some passkey
types and push encryption are slower or unavailable without them), and `pcntl` in the CLI is what
lets the queue worker enforce its per-job timeout.

From a clone of this repository:

```bash
./scripts/fetch-media.sh          # exercise images/GIFs (~140 MB), once

cd backend
cp .env.example .env
php -r 'echo bin2hex(random_bytes(32)), PHP_EOL;'   # paste the output into SESSION_SECRET in .env
composer install
php artisan key:generate
touch database/database.sqlite
php artisan migrate
php artisan serve                 # http://127.0.0.1:8000
```

`SESSION_SECRET` signs every session; without it nobody can sign in, and the API refuses to sign
anything rather than sign with an empty key (`app/Auth/SessionToken.php`).

The frontend, in another terminal:

```bash
cd frontend && npm install && npm run dev    # :5173, proxies /api to 127.0.0.1:8000
```

(`API_TARGET=http://…` points the proxy elsewhere.) The defaults in `.env.example` —
`RP_ID=localhost`, `ORIGIN=http://localhost:5173` — are exactly this setup. Open
**http://localhost:5173** and create a profile with a passkey.

Pushes and reminders are sent by the scheduler (section 7). Locally, leave this running in a third
terminal:

```bash
cd backend && php artisan schedule:work
```

Check it's healthy:

```bash
curl http://127.0.0.1:8000/api/health      # {"ok":true,"users":0}
cd backend && php artisan fitpal:check-config
```

`backend/.env` is read by Laravel. A variable already set in the real environment wins over the
file. Once the configuration is cached (`php artisan optimize`, which every production install
runs), `.env` is not read at all until you cache it again — see section 10.

## 2. Understand the passkey requirement (important)

FitPal Coach signs you in with **passkeys** (WebAuthn). Browsers enforce two rules:

1. Passkeys are bound to an exact **hostname** (`RP_ID`).
2. They only work over **HTTPS** — with one exception: `http://localhost`.

So `http://localhost:5173` works on the machine running it, but **another device (your phone)
cannot use `http://<your-LAN-ip>:5173`** — that's neither localhost nor HTTPS, so the passkey
prompt won't appear. To use it from your phone you need a real HTTPS hostname.

(You can still open it over LAN in **guest mode**, which stores data only in that browser.)

The standalone mobile app (`docs/MOBILE.md`) sidesteps this for its "connect to my server" mode:
instead of a passkey ceremony (impossible from inside its WebView, which never runs at your real
hostname), it pairs by redeeming a short one-time code — minted from Settings → "Pair the mobile
app" in an already signed-in browser tab — for a bearer token sent as an `Authorization` header
rather than a cookie. Worth knowing if you're poking at the API directly:

- `POST /api/pair/create` (needs a session) and `POST /api/pair/redeem` (doesn't) implement this —
  see `backend/app/Http/Controllers/PairController.php`. A code is 8 characters, works once and
  lives five minutes. The returned token is the exact same signed value a cookie carries, so "sign
  out everywhere" invalidates it too.
- The API reflects `Access-Control-Allow-Origin` for any request that sends an `Origin` header,
  so the app's own WebView origin can call it cross-origin
  (`backend/app/Http/Middleware/ReflectOrigin.php`). It never sends
  `Access-Control-Allow-Credentials`, so this doesn't let a browser read your cookie session from
  another origin — only bearer-token requests benefit from it.

## 3. Put it on your own domain over HTTPS

> Want HTTPS **without** exposing anything to the internet — a valid certificate on a LAN-only
> address? See [SELF_HOSTING_HTTPS.md](./SELF_HOSTING_HTTPS.md) (wildcard cert via a DNS
> challenge).

For a real instance you also need a database server — MariaDB or MySQL (production runs MariaDB
11.4; the migrations pin InnoDB and `utf8mb4` whatever the server's defaults are). SQLite is fine
for one person on one machine, and is what the local setup above uses.

### Install the API

```bash
cd /srv/fitpal/backend
cp .env.example .env              # then edit it, below
composer install --no-dev
php artisan key:generate
php artisan migrate --force
php artisan filament:assets       # the admin panel's CSS/JS; not committed
php artisan optimize              # caches config, routes and views
php artisan fitpal:check-config   # says what is still wrong; "configuration ok" when nothing is
```

The values that differ from the local defaults (every variable is in section 4):

```bash
APP_ENV=production
APP_DEBUG=false                  # true sends stack traces with server paths to the browser
APP_URL=https://coach.example.com
RP_ID=coach.example.com
ORIGIN=https://coach.example.com
SESSION_SECRET=…                 # 64 hex characters, as above
DATA_DIR=/srv/fitpal-data        # outside backend/, so a redeploy can never reach it
DB_CONNECTION=mariadb            # or mysql
DB_HOST=127.0.0.1
DB_DATABASE=fitpal
DB_USERNAME=fitpal
DB_PASSWORD=…
INVITE_ONLY=1
BOOTSTRAP_CODE=…                 # see section 5; clear it after the first sign-up
ALLOW_GUEST=0
MAIL_MAILER=resend               # see section 4
```

Keep `.env` mode 600. The PHP process needs write access to `backend/storage/`,
`backend/bootstrap/cache/` and `DATA_DIR` (and, with SQLite, to `backend/database/` itself, where
SQLite writes its journal).

### Serve both from one origin

Two things have to be true, and the second is the one people get wrong:

1. A hostname you control, served over HTTPS.
2. **The app and the API on the same origin.** `https://coach.example.com/` serves the built
   frontend, and `https://coach.example.com/api/*` reaches Laravel. Not a second hostname, not a
   different port — passkeys are bound to the origin, and the session cookie is scoped to it.

How `/api` reaches Laravel matters. `backend/routes/api.php` registers every route twice, under
`/api` and bare, so it answers both when the prefix arrives intact (`php artisan serve`, the Vite
proxy) and when Laravel is **mounted at** `/api`, so its base path is `/api` and the same request
arrives as `/health`. Production is mounted, and the mount is the shape to copy: the owner's admin
panel registers only bare routes, so it exists only there, at `/api/admin-panel`, and its
published CSS and JS are files under `backend/public/` that the web server must hand out itself.

The simplest way to get that mount is the one production uses (on LiteSpeed; see
`docs/DEPLOY_COACH_SUBDOMAIN.md`): a document root holding the built frontend, with `api` a
symlink to `backend/public`. Laravel's own `public/.htaccess` then does the routing, sets the PHP
limits (section 6) and refuses its config files to the browser.

```bash
cd /srv/fitpal/frontend && npm ci && npm run build      # → frontend/dist/
mkdir -p /var/www/coach
rsync -a --delete --exclude=/api --exclude=/img --exclude=/gif dist/ /var/www/coach/
ln -s /srv/fitpal/backend/public /var/www/coach/api
# Exercise images and GIFs, from ./scripts/fetch-media.sh. The app asks for them at /img and
# /gif relative to the page, so they have to come from this same origin — miss this and the app
# works perfectly with every exercise picture broken.
ln -s /srv/fitpal/media/img /var/www/coach/img
ln -s /srv/fitpal/media/gif /var/www/coach/gif
```

The excludes are what keep a later frontend publish from deleting the mount: without them,
`rsync --delete` removes `api` and `/api/*` starts answering 404.

Apache with PHP-FPM (`a2enmod rewrite headers ssl proxy_fcgi`):

```apache
<VirtualHost *:443>
    ServerName coach.example.com
    DocumentRoot /var/www/coach

    SSLEngine on
    SSLCertificateFile    /etc/letsencrypt/live/coach.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/coach.example.com/privkey.pem

    # Symlinks in the docroot, and Laravel's public/.htaccess doing the work behind one of them.
    <Directory /var/www/coach>
        Options FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    <Directory /srv/fitpal/backend/public>
        Options FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    <Directory /srv/fitpal/media>
        Require all granted
    </Directory>

    # PHP-FPM reads backend/public/.user.ini; with mod_php, drop this block and the php_value
    # lines in backend/public/.htaccess apply instead.
    <FilesMatch "\.php$">
        SetHandler "proxy:unix:/run/php/php8.4-fpm.sock|fcgi://localhost"
    </FilesMatch>

    # Nothing in the app sets these for the frontend, so they are yours. SECURITY.md treats a
    # missing one as a self-hosting bug, not an app bug.
    Header always set X-Frame-Options "DENY"
    Header always set Content-Security-Policy "frame-ancestors 'none'"
    Header always set X-Content-Type-Options "nosniff"
    Header always set Referrer-Policy "same-origin"

    # A cached copy of any of these pins clients to an old release; hashed assets/ stay cacheable.
    <FilesMatch "^(sw\.js|index\.html|manifest\.json)$">
        Header set Cache-Control "no-cache, must-revalidate"
    </FilesMatch>
</VirtualHost>
```

No rewrite is needed for the app itself: it is hash-routed, so the server only ever sees `/`.

nginx or Caddy with PHP-FPM can do the same job, but the mount is then yours to build: requests
under `/api/` go to `backend/public/index.php` with `SCRIPT_NAME` set to `/api/index.php` (that is
what gives Laravel its `/api` base path), files that exist under `backend/public/` are served as
files, and the PHP limits come from `.user.ini` rather than `.htaccess`. Pointing `/api/*` at
`index.php` with the path left whole also works for the app's API, which answers on its prefixed
routes, but the admin panel will not be reachable that way.

TLS is the web server's job, or a proxy's in front of it. Production has Cloudflare in front,
talking HTTPS to the origin. If a proxy in front terminates TLS and talks plain HTTP to this
server, the API is unaffected (the cookie's `Secure` flag comes from `ORIGIN`, not from the
request), but Laravel trusts no forwarded headers (`bootstrap/app.php` configures no trusted
proxies), so the admin panel sees itself served over http.

Check it from outside:

```bash
curl -fsS https://coach.example.com/api/config | grep -o '"login_email":[a-z]*'   # Laravel answering
```

Visit `https://coach.example.com`, create your profile, and add it to your home screen
(iOS: Share → Add to Home Screen · Android: ⋮ → Add to Home screen).

> Changing `RP_ID` later invalidates existing passkeys (they were bound to the old hostname).

## 4. Configuration

Everything the app reads is in `backend/config/fitpal.php`; the names are the Node API's, so an
old deployment's variables carry over as they are.

| Variable | Default | What it does |
|---|---|---|
| `RP_ID` | `localhost` | The hostname passkeys are bound to. A bare host: no scheme, no port. |
| `ORIGIN` | `http://localhost:5173` | The exact origin the app is opened at, compared character for character. `https://` also makes the cookie `Secure` and names it `__Host-gymsid`. |
| `RP_NAME` | `FitPal Coach` | The name a passkey prompt shows. |
| `SESSION_SECRET` | *(none)* | Signs every session cookie and paired-phone token. At least 32 characters (64 hex is what to generate). Changing it signs everyone out. |
| `SESSION_DAYS` | `90` | How long a sign-in lasts. Each token carries its own expiry, so a change reaches new sign-ins only. |
| `ADMIN_UIDS` | *(empty)* | Comma-separated account ids that are admins whatever their database row says. |
| `INVITE_ONLY` | `0` | `1`: an account needs an invite code (a coach's invite link always works). |
| `BOOTSTRAP_CODE` | *(empty)* | How the first account gets into an invite-only instance and becomes admin. At least 16 characters; ignored once any account exists. |
| `ALLOW_GUEST` | `1` | `0` removes "Continue without account". |
| `SELF_SERVE_COACH` | `0` | Opens coach sign-up without an invite. Stays closed until there is a plan to sign up to: `FREE_CAP`, or billing (`CREEM_*`). |
| `FREE_CAP` | *(empty)* | The Free plan: a coach with no paid plan may coach this many active clients, with no card and no Creem needed. Empty or `0`: no Free plan, and with billing off every coach is unlimited. |
| `DATA_DIR` | `backend/storage/app/fitpal` | Files kept outside the database: `media/ex/` (coaches' exercise demos), `media/photo/<uid>/` (clients' progress photos) and `vapid.json` (the push keys, unless `VAPID_*` is set). Outside the document root; the files only leave through the API, behind a session. |
| `MEDIA_MAX_VIDEO_MB` | `90` | Cap on a coach's exercise demo (section 6). |
| `MEDIA_MAX_PHOTO_MB` | `12` | Cap on a client's progress photo (section 6). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | *(empty)* | The push key pair. Both or neither; neither means `DATA_DIR/vapid.json`, generated on first use. |
| `VAPID_SUBJECT` | *(empty)* | A contact for push services. Empty means `ORIGIN` when it is https, otherwise `mailto:admin@localhost`. |
| `AUDIT_LOG` | `1` | `0` stops recording the activity log (what is there stays). |
| `AUDIT_MAX`, `AUDIT_DAYS` | `5000`, `90` | Activity log retention; `0` means no cap. |
| `AUDIT_IP` | `off` | `net` keeps a /24 (IPv4) or /48 (IPv6), `full` the whole address. |
| `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_PRODUCTS`, `CREEM_API_BASE` | *(empty)* | Billing through Creem. All unset means billing is off: every coach is entitled and nothing talks to Creem. |

And Laravel's own, which matter here:

- `APP_KEY` (from `key:generate`), `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL`.
- `DB_CONNECTION` and `DB_*`. SQLite by default, in `backend/database/database.sqlite`.
- `MAIL_MAILER` and friends. Mail carries coaches' sign-in links and address confirmations.
  `log` (the default) writes them to `storage/logs`, which is right on a laptop and means nothing
  is sent on a live instance. Production uses `resend` with `RESEND_API_KEY` and a
  `MAIL_FROM_ADDRESS` on a domain verified there; Laravel's `smtp` mailer works the usual way.
- `QUEUE_CONNECTION=database`, `CACHE_STORE=database`. Pushes go through the queue; with `sync`,
  rest-timer pushes are skipped altogether. The cache holds pending rest timers, pairing codes and
  passkey challenges.
- `SESSION_DRIVER` and `SESSION_LIFETIME` are for the admin panel only. The app's own sign-in is
  the signed token above, not a Laravel session.

`php artisan fitpal:check-config` reads all of this and names what will not behave as intended:
a missing or short `SESSION_SECRET`, an `ORIGIN` not written the way a browser sends it, an `RP_ID`
that isn't its host, half a VAPID pair, a mailer that sends nothing, passkeys bound to another
`RP_ID`, and on a production instance an open sign-up.

## 5. Accounts, coaches and admins

This fork is one coaching business: coaches, their clients, and whoever runs the instance.

- **Who can create an account.** With `INVITE_ONLY=0`, anyone who reaches the URL, as an account
  with no coach. With `INVITE_ONLY=1`, only someone holding a code: a coach's invite link (which
  also puts them on that coach's roster), an admin's invite code, or the bootstrap code.
- **Admins** are accounts whose `admin` flag is set in the `users` table, or whose id is in
  `ADMIN_UIDS`. An admin also coaches. A fresh instance has no admin.
- **Coaches** are made by an admin (in the admin panel, below), or sign themselves up through
  `SELF_SERVE_COACH` once billing is on or `FREE_CAP` is set.

The way to start an invite-only instance: set `INVITE_ONLY=1` and a long random `BOOTSTRAP_CODE`,
sign up and give the bootstrap code as your invite code. That first account is made admin, the
code stops working, and the log says to clear it — do, then `php artisan optimize`. The other way
is to sign up on an open instance, find your id under **Account** (or in the `users` table), put
it in `ADMIN_UIDS`, and re-cache the config.

An admin gets a **Business** section under **Account**: every account with its training history
and body weight, disabling an account (signed out and locked out everywhere until re-enabled),
and the activity log. Admin access is enforced server-side on every `/api/admin/*` request, so it
needs no separate login.

The rest is in the owner's console, `https://coach.example.com/api/admin-panel` (Filament):
making and unmaking coaches, moving a client to another coach, general invite codes, licences,
coaches' uploaded demos. It has its own sign-in, an email and a password set on an existing admin
account:

```bash
php artisan fitpal:panel-login <admin id>   # asks for the email and, hidden, the password
```

Only admins get in. Every other account signs in with a passkey and has no password.

### The activity log

The instance also keeps an **activity log**: sign-ins, sign-outs, failed attempts, refused
signups, pairings, and every admin action. It lives in the `audit_events` table and is shown under
Account → Business and in the admin panel.

It is on by default and keeps the last 5,000 events or 90 days, whichever is fewer (`AUDIT_LOG=0`
stops recording; `AUDIT_MAX` and `AUDIT_DAYS` change the caps). Retention is applied when the log
is read and again by the hourly prune (section 7), so nothing past it is ever shown. **IP
addresses are not recorded** unless you set `AUDIT_IP=net` (network only, e.g. `203.0.113.0/24`)
or `AUDIT_IP=full`. Neither the browser's user-agent nor the passkey id of a failed sign-in is
ever stored: the first is a fingerprint, and the second would let you follow an unknown device
from one attempt to the next.

Two things worth expecting. **Guests never appear** — guest mode never talks to the server, so
there is nothing to log. And **a disabled account goes quiet**: a disabled user is refused at the
session check, so their only entries are the failed sign-ins they keep making.

Clearing the log from the dashboard records the clear itself, and the event ids keep counting, so
a gap is always visible.

`INVITE_ONLY=1` and `ALLOW_GUEST=0` answer different questions and are usually set together.
Invite-only controls who may *create a profile*; it says nothing about the **Continue without
account** button, which never creates one. Guest mode keeps everything in that browser and never
talks to the server — there is no account, no sync and nothing for a coach to see — so on an
instance meant for a known set of people it is a door that leads nowhere useful. With
`ALLOW_GUEST=0` the button is gone, and anyone already using the app as a guest is returned to the
login screen on their next visit. Their data is not deleted: it stays in that browser and comes
back if you ever switch guests on again, or moves into a real profile if they create one on the
same device.

Prefer to keep the whole thing off the open internet? A VPN or an auth proxy (Authelia, Cloudflare
Access…) in front still works, and composes with the above.

## 6. Limits and sizes

What the API itself refuses:

- a JSON body over **5 MB** (`app/Support/Input.php`), except the state sync, `PUT /api/data`,
  which takes up to **16 MB** (`app/Http/Controllers/DataController.php`);
- an exercise demo over `MEDIA_MAX_VIDEO_MB` (`POST /api/media/exercise`, coaches only; the
  coach, their clients and admins can watch it);
- a progress photo over `MEDIA_MAX_PHOTO_MB` (`POST /api/media/photo`, any account, for itself;
  only the owner and whoever coaches them can open it).

Uploads are raw bodies, streamed to a temporary file as they arrive rather than held in memory,
and judged by their own first 64 bytes, not by the `Content-Type` the sender chose
(`app/Media/Upload.php`, `app/Media/Sniff.php`). The files land in `DATA_DIR/media/`; what is
known about them (whose, when, which exercise) is in the database. Demos can also go up in 4 MB
chunks, which the app does when `/api/config` offers it, so a large video never has to arrive as
one long request.

12 MB is generous for a photo and is not the number that normally applies: the app re-draws each
photo on a canvas at 1600 px before sending, which lands around 300-500 KB. That client-side
resize also strips the photo's EXIF, GPS included, because a canvas holds decoded pixels and no
metadata. It is a property of the app, **not** a guarantee this server enforces: nothing in
`backend/` parses EXIF, and anything can post raw bytes at the route. Do not describe it to
clients as a server-side promise.

**PHP refuses first.** A body over `post_max_size` is refused before Laravel runs (the app is
still told the right cap, from `bootstrap/app.php`), and stock PHP defaults are far below what a
sync or a video needs. The values production needs, and why, are the table in
[backend/README.md](../backend/README.md#php-settings-production-needs); the repo ships them in
`backend/public/.htaccess` (LiteSpeed, mod_php) and `backend/public/.user.ini` (PHP-FPM). A media
cap above `post_max_size` is lowered to it, and `fitpal:check-config` says so.

**Whatever sits in front of PHP is the limit that actually fires, and it is yours to set.**
nginx's `client_max_body_size` defaults to 1 MB, Apache and Cloudflare have their own ceilings
(Cloudflare refuses bodies over 100 MB, and gives up on a request the origin has not answered in
100 s), and a cap above the proxy's is not a cap at all: the upload dies out there, usually with
an HTML error page the app cannot parse. Raise your proxy's limit above `MEDIA_MAX_VIDEO_MB` so the
API's is the one that gets hit — it answers in JSON, which is what the app knows how to read.
Behind Cloudflare, keep `MEDIA_MAX_VIDEO_MB` under 100.

Whether a refusal saves any bandwidth depends on the same front end. A web server that reads the
whole body before PHP starts — LiteSpeed does, as nginx does by default — means the API sees an
upload only once it has fully arrived. The refusal is identical either way; the bytes are simply
already spent.

Note the difference from `VITE_IMG_BASE` / `VITE_GIF_BASE` (see the end of this file): those are
build-time values baked into the frontend bundle by `npm run build`, so changing them means
rebuilding `dist/`, not touching the API.

## 7. Cron

One line drives everything that runs on its own (`backend/routes/console.php`):

```
* * * * * cd /srv/fitpal/backend && php artisan schedule:run -q >> storage/logs/cron.log 2>&1
```

- **every minute**: the day reminders, then a queue worker that sends the queued pushes (reminders,
  rest-timer-over, a new program from a coach) and lives at most about a minute — no supervisor
  needed;
- **hourly**: the prune — activity log past retention, offers older than 30 days, stale presence,
  expired cache rows, abandoned uploads;
- **03:00 UTC**: the nightly database dump (section 9).

`-q` keeps normal runs silent, so `cron.log` only grows when the scheduler itself cannot start
(PHP failing to boot, a broken install) — the one failure Laravel cannot log, since it never
runs. Everything else lands in `storage/logs/laravel.log`.

Without cron the app still works, but no reminder, rest-timer or program push is ever sent and
nothing is pruned or dumped. Mail does not wait for it: sign-in links are sent right after the
request that asked for them.

## 8. Notifications

The app can push alerts to a phone or desktop even when it isn't open: rest-timer-over, a reminder
on days with a workout planned but not logged yet, and a new program from your coach. Turn it on
per profile in **Settings → Notifications** (requires a signed-in passkey profile and HTTPS — see
section 3).

Nothing to set up beyond the cron line, and nothing to configure per timezone: the VAPID keys come
from `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`, or are generated on first use into
`DATA_DIR/vapid.json` (mode 600), and each user's browser reports its own timezone when they turn
the reminder on — it fires at their local time, and follows them if they travel, regardless of
what timezone the server runs in. Keep `vapid.json` with your backups: a push service refuses a
message signed with any other key, so losing it silences every browser already subscribed until
each one subscribes again.

**Keep screen awake** (Settings → *During a workout*) has the same transport requirement: the
Wake Lock API is only available over HTTPS or on `http://localhost`, so on a plain-LAN-IP
instance the switch shows as unsupported. Nothing to configure server-side either way, and iOS
refuses the lock while the phone is in Low Power Mode.

Push services like a contact address for whoever runs the server, in case they ever need to reach
you about your pushes. The API sends your `ORIGIN` by default; set
`VAPID_SUBJECT=mailto:you@example.com` if you would rather they had an inbox.

## 9. Backups

Three things hold the instance: **the database**, **`DATA_DIR`** (`media/` and `vapid.json`), and
**`backend/.env`** (`APP_KEY`, `SESSION_SECRET` — lose the second and everyone is signed out,
every paired phone included).

The database dumps itself:

```bash
cd /srv/fitpal/backend
php artisan fitpal:backup-db             # → storage/backups/db-<time>-<NN>.sql.gz, newest 5 kept
```

and the scheduler takes one every night into `storage/backups/nightly/`, keeping fourteen (its
output goes to `storage/logs/backup.log`; a failure is also logged to `laravel.log`). MariaDB and
MySQL are dumped with `mariadb-dump` (or `mysqldump`), which must be installed where the cron runs;
SQLite is copied with `VACUUM INTO`, a consistent copy while the app keeps writing — so for SQLite
the `.sql.gz` is a gzipped database file, not SQL. `--label=…` adds to the file name, `--keep=N`
changes how many stay, `--into=<folder>` uses a subfolder with its own count.

Those dumps sit on the same machine as the database: they cover a bad update or a bad write, not
the loss of the machine. Copy them, `DATA_DIR` and `.env` somewhere else:

```bash
tar czf fitpal-backup-$(date +%F).tar.gz \
  -C /srv/fitpal/backend storage/backups .env \
  -C /srv fitpal-data
```

That archive holds every account, passkey public key and training history — and, with the
activity log on, everyone's sign-in times (and IPs, if `AUDIT_IP` is set). Dumps are full copies,
so an account deleted today lives on in them until they are pruned. Worth knowing before you ship
it to a backup service you don't run. (Individual users can also export their own data as JSON
from Settings.)

To restore, with the app paused:

```bash
cd /srv/fitpal/backend
php artisan down
gunzip -c storage/backups/nightly/db-….sql.gz | mariadb -u fitpal -p fitpal     # MariaDB/MySQL
gunzip -c storage/backups/nightly/db-….sql.gz > database/database.sqlite        # SQLite
php artisan up
```

and put `DATA_DIR` back where `.env` says it is.

## 10. Updating

```bash
cd /srv/fitpal && git pull
cd backend
php artisan down
php artisan fitpal:backup-db --label=$(git rev-parse --short HEAD)
composer install --no-dev
php artisan migrate --force
php artisan filament:assets
php artisan optimize
php artisan up
php artisan fitpal:check-config

cd ../frontend && npm ci && npm run build
rsync -a --delete --exclude=/api --exclude=/img --exclude=/gif dist/ /var/www/coach/
```

That is what this product's own deploy does (`.github/workflows/deploy-backend.yml`), dump first
so a bad migration has an undo. There is no API process to restart: PHP reads the new code on the
next request. (If your OPcache is set not to check timestamps, reload PHP-FPM.)

**After any edit to `.env`, run `php artisan optimize`** — it rebuilds the cached config, and until
then the edit does nothing. **Never run `optimize:clear`**: it also empties the application cache,
losing pending rest-timer pushes, recent-sign-in marks and the scheduler's overlap locks.

The app shell is versioned so clients pick up a new frontend on next load. The database,
`DATA_DIR` and the downloaded media are untouched by an update.

## 11. Moving from an openGym Node instance

`php artisan fitpal:import-legacy` reads a Node API `DATA_DIR` (`db.json`, `state-*.json`,
`audit.log`, `media-*.json`) into the database: accounts, passkeys, training state, the activity
log, invites, programs, assignments, push subscriptions, demo and photo records. It does not move
media files: Laravel reads them from `DATA_DIR/media/`, where Node wrote them.

What makes it seamless is keeping three things exactly as they were:

- **`SESSION_SECRET` = the contents of the old `DATA_DIR/secret`.** Every cookie and every paired
  phone's token was signed with it; any other value signs everyone out.
- **`RP_ID` and `ORIGIN` unchanged.** Each passkey answers only for the hostname it was
  registered under.
- **`DATA_DIR` = the old data directory** (or a copy with `media/` and `vapid.json`), or
  `VAPID_*` set to the pair in its `vapid.json`. Otherwise demos and photos answer 404, and no
  browser subscribed under Node receives a push again.

Then, with the Node API **stopped** — never run both against the same data — and the new
database migrated and empty:

```bash
php artisan fitpal:import-legacy /srv/opengym/data --verify
```

`--verify` reads every account back through the API afterwards and compares it with the files;
`--verify-only` does that comparison alone, without importing, any time later.

The import mirrors the files: invites, programs, assignments and media rows the files no longer
hold are deleted. That is right once, at the switch, and wrong ever after. So on a production
instance (`APP_ENV=production`) it refuses unless you pass `--confirm-live`, and it refuses —
before writing anything — when the database already holds accounts, when `ORIGIN` is not https
or not written as a browser sends it, when `RP_ID` is not exactly `ORIGIN`'s host, when it cannot
read the old `secret` or `SESSION_SECRET` differs from it, when `DATA_DIR` is not the directory
being imported, or when the VAPID pair is not the old one. Anywhere else those are printed as
warnings after the import. To redo a production import that stopped part-way, empty the database
first (`php artisan migrate:fresh --force`).

The old variables keep their names, except `PORT`, which has no meaning any more.
`docs/CUTOVER_R5.md` is the runbook this product's own switch followed.

**If the old instance ever had the AI Coach**, two of its leftovers hold credentials and are not
imported: `DATA_DIR/coach.json` (provider API keys, encrypted with `DATA_DIR/secret` — which you
are about to put in `.env`) and `./coach-auth/` (the Codex provider's refresh-token cache).
Delete both, and revoke the keys at the provider while you are there — a key nothing uses any more
is still a live key.

## Passkeys fail even though `RP_ID` looks right

The most common support question, and the values are usually *nearly* correct. Work through
these in order — the first two account for most of it.

**1. Ask the server what it actually loaded.** A failed sign-in names the configured values
itself ("… this server is configured with RP_ID=… and ORIGIN=…"), and so does:

```bash
cd backend
php artisan config:show fitpal       # what the running app uses
php artisan fitpal:check-config      # and what is wrong with it
```

If that disagrees with your `.env`, the config is cached from before your edit. Run
`php artisan optimize`.

**2. Check the exact shape of each value.** They are not the same kind of string:

| | Correct | Wrong |
|---|---|---|
| `RP_ID` | `coach.example.com` | `https://coach.example.com`, `coach.example.com:8080`, `coach.example.com/` |
| `ORIGIN` | `https://coach.example.com` | `coach.example.com`, `https://Coach.example.com`, `https://coach.example.com/app` |

`RP_ID` is a bare hostname: no scheme, no port, no trailing slash. `ORIGIN` is the full origin
*with* the scheme, lower-case, no path (a trailing slash is stripped). Both must match your
address bar exactly.

**3. Behind a tunnel or reverse proxy, use the public hostname.** With Cloudflare Tunnel,
Traefik, nginx or Caddy in front, the browser only ever sees the public name — so that is what
both values must be. Not the LAN IP, not the internal port:

```env
RP_ID=coach.example.com
ORIGIN=https://coach.example.com
```

The tunnel's own route may point wherever it likes (`http://localhost:8080` is fine). It is the
browser-facing name that has to appear here.

**4. `www.` is a different host.** A passkey registered on `coach.example.com` will not work on
`www.coach.example.com`. Pick one and redirect the other.

**5. Changing the hostname invalidates existing passkeys.** They were bound to the old one, so
everybody registers again — which is why it pays to settle the domain before others join.
`fitpal:check-config` counts the accounts holding a passkey the current `RP_ID` cannot reach.

> On a LAN without certificates there is nothing to configure that makes passkeys work over
> plain `http://192.168.x.x`: browsers only allow WebAuthn on HTTPS (or `localhost`). Use guest
> mode, the standalone mobile app (`docs/MOBILE.md`), or put a certificate in front of it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No passkey prompt on my phone | You're on `http://` or an IP, not HTTPS. Set up a domain (section 3). |
| "verification failed" on login | `RP_ID`/`ORIGIN` don't match the URL in the address bar. See the section above — the error itself names what the server is using. |
| Every save fails with "cross-origin request refused" | `ORIGIN` is not the address the app is opened at. `storage/logs/laravel.log` has a `refused cross-origin` line with the origin received and the one expected. |
| Nobody can sign in at all | `SESSION_SECRET` is unset or under 32 characters. `fitpal:check-config` says so. |
| `/api/config` answers 404, or the app's HTML | `/api` is not reaching Laravel: the `api` symlink is missing (a frontend publish without the excludes removes it), or the web server is not allowing `.htaccess` overrides or symlinks there. |
| `{"error":"server error"}` | The reason is in `backend/storage/logs/laravel.log`. A first suspect: the PHP process cannot write to `storage/`, `bootstrap/cache/` or `DATA_DIR`. |
| An `.env` change does nothing | The config is cached. `php artisan optimize`. |
| Media didn't download | Run `./scripts/fetch-media.sh`. It is safe to re-run — it skips a folder that already has files in it (`--force` re-downloads). |
| Exercise pictures are all broken | The media is there but nothing is serving it. `/img` and `/gif` have to come from the same origin as the app — see section 3. |
| An upload fails with no sensible message | Something in front of PHP refused it with an HTML page: raise its body limit above `MEDIA_MAX_VIDEO_MB` (section 6). |
| No "Notifications" option in Settings | Requires a signed-in profile and HTTPS (or `localhost`) — guest mode and plain HTTP over LAN can't subscribe. |
| Notifications switched on, nothing ever arrives | The scheduler isn't running (section 7). Check the crontab, then `storage/logs/cron.log` and `laravel.log`. |
| Day reminder fires at the wrong time | Toggle it off and on in Settings so it re-detects your browser's timezone (also happens automatically on every app load — see section 8). |
| Want to reset a stuck login | Delete the cookie in your browser; sessions are just signed cookies. |
| Exercise images/GIFs blank when a routine is open | The media never downloaded, or `VITE_IMG_BASE` points somewhere unreachable — see the note below. |

### `VITE_IMG_BASE` / `VITE_GIF_BASE` are build-time, not run-time

These two are read by Vite when the frontend is **compiled**, so their values are baked into the
shipped JavaScript bundle. Changing them anywhere does nothing to a `dist/` that already exists —
the bundle has already made up its mind.

Export them and rebuild:

```bash
cd frontend
VITE_IMG_BASE=https://media.example.com/img npm run build
```

If you would rather not rebuild, redirect the media path in your web server instead.
