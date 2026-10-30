# FitPal Coach API (Laravel)

The backend behind `coach.fitpal.ma/api` since the R5 cutover (2026-10-26). It was ported from
the Node API (`api/server.js`, deleted in CHW-301; `git show 5d0c52f4:api/server.js` to read it)
milestone by milestone. Design and decisions: `../docs/superpowers/specs/2026-10-17-laravel-backend-design.md`.
Deploying: `../docs/DEPLOY_COACH_SUBDOMAIN.md` and `../docs/CUTOVER_R5.md`.

The React app in `../frontend` was unchanged by the port: this backend answers the same paths with
the same shapes, including the error envelope `{error, msg?}` whose English sentences are the
app's translation keys. Do not reword an error string without changing its key in
`frontend/src/locales/{fr,es,de}.js`.

## Run

```sh
cd backend
cp .env.example .env            # then set SESSION_SECRET to 64 hex characters
composer install
php artisan key:generate
php artisan migrate             # SQLite file in database/
php artisan serve               # http://127.0.0.1:8000
```

Against the React dev server, from `../frontend`:

```sh
npm run dev                     # proxies /api to 127.0.0.1:8000; API_TARGET=… for another address
```

The Vite proxy forwards `/api` and sets the `Origin` header the forgery check expects.

## Scheduler

One cron line drives everything that runs on its own (`routes/console.php`): the reminders and
the queue worker (pushes; mail goes out after the response instead) on every run, the hourly prune
and the nightly database dump into `storage/backups/nightly`. Shared hosting has no supervisor, so
the worker lives at most about a minute and the next run's carries on.

The cPanel host runs the line every 5 minutes and rewrites `* * * * *` to that (CHW-311), so the
reminders look back over the last two runs and a queued push waits up to about 5 minutes; see
`docs/DEPLOY_COACH_SUBDOMAIN.md` → Cron.

```
0,5,10,15,20,25,30,35,40,45,50,55 * * * * cd ~/fitpal-coach-backend && /usr/local/bin/php artisan schedule:run -q >> storage/logs/cron.log 2>&1
```

## Admin panel

The owner's console (Filament 5) is at `/admin-panel` — `/api/admin-panel` on the server, where the
app is mounted at `/api`. Its CSS and JS are published, not committed (`.gitignore`), so every
deploy runs, after `composer install`:

```sh
php artisan filament:assets
```

The owner signs in with an email and a password set on their existing admin account (Filament's
`make:filament-user` would create a new account instead):

```sh
php artisan fitpal:panel-login <admin id>   # asks for the email and, hidden, the password
```

Only admins get in; every other account signs in with a passkey and has no password.

## Demo clients

Six clients with months of history, on one coach's roster, for looking at the coach screens with
data in them (and filming them: docs/VIDEO_CAPTURE.md). Nobody can sign in as one.

```sh
php artisan fitpal:seed-demo [--coach=<id>] [--tz=Africa/Casablanca]   # --force on production
php artisan fitpal:seed-demo --list
php artisan fitpal:seed-demo --remove      # exactly what it added
```

## Test

```sh
./vendor/bin/pest                # feature tests on an in-memory SQLite, unit tests
./vendor/bin/pint --test         # formatting
```

Feature tests were named after the sections of the Node API's `coach-smoke.sh` (deleted with
`api/` in CHW-301), so the port's coverage could be read against the suite it replaced.

Two checks a test cannot make run in CI beside Pest, without PHP: `node scripts/check-error-strings.mjs`
(every message the API can send is translated) and `node scripts/check-audit-labels.mjs` (every
audit event has a label in the app).

## PHP settings production needs

The contract has bodies stock PHP defaults refuse: a sync is up to 16 MB of JSON (`PUT
/api/data`), an exercise video up to `MEDIA_MAX_VIDEO_MB` (90) raw. The test suite cannot see
these values, so the repo sets them and ships them with every deploy, in two places because each
server reads one: **`public/.htaccess`** (`php_value`, for LiteSpeed and mod_php — the cPanel host
is LiteSpeed and *ignores* `.user.ini`, measured in CHW-227) and **`public/.user.ini`** (for
PHP-FPM). Keep them in step. Both are refused to the browser.

| ini | value | why |
|---|---|---|
| `post_max_size` | `100M` | above the largest raw upload; PHP refuses larger bodies before Laravel runs (the app still gets the 413 sentence, see `bootstrap/app.php`) |
| `upload_max_filesize` | `100M` | same, for the multipart path should one ever exist |
| `memory_limit` | `768M` | a 15.9 MB sync (324,000 sets) peaked at 313–379 MB on the host; twice that |
| `max_execution_time` | `120` | a 90 MB upload over a slow link |
| `max_input_time` | `120` | time to receive that body |

`tests/Unit/PhpLimitsTest.php` fails if the three files or this table disagree.

`PUT /api/data` is read raw and decoded once, by DataController. Two things in Laravel would
otherwise decode it first: the request capture itself (`createFromBase` json-decodes every JSON
body into arrays — `public/index.php` captures through `App\Http\Request`, which skips that for
this route only) and the global `TrimStrings` / `ConvertEmptyStringsToNull` middleware, which walk
every string (skipped for this route in `bootstrap/app.php`).

## Where things are

- `app/Http/Middleware/` — `ReflectOrigin` (CORS as the Node API did it: reflect, never
  credentials; preflight 204 for any path), `NoStore`, `CsrfOrigin` (the `csrfOk` rules; no token).
- `app/Support/` — `Say` (error templates → `msg: {k, v}`), `Json` (every JSON answer), `ClientSafe`
  (a 4xx the caller may read; anything else is `500 {error:'server error'}`).
- `app/Audit/` — the audit log (`Audit::record`, never throws) and `ClientIp` (`AUDIT_IP`
  off/net/full). Event names must be labelled in `frontend/src/lib/audit.js`;
  `scripts/check-audit-labels.mjs` reads both sides and fails on a missing label.
- `config/fitpal.php` — the environment contract, names kept from the Node API.
- `routes/api.php` — every route registered under `/api` and bare, because the production mount
  is AT `/api` and strips the prefix before Laravel sees the path.
