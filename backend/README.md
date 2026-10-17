# FitPal Coach API (Laravel)

The backend behind `coach.fitpal.ma/api`, being ported from `../api/server.js` (Node) milestone
by milestone. Design and decisions: `../docs/superpowers/specs/2026-10-17-laravel-backend-design.md`.
Until the cutover (milestone R5) the Node API is still what production runs.

The React app in `../frontend` is unchanged by the port: this backend answers the same paths with
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
API_TARGET=http://127.0.0.1:8000 npm run dev
```

The Vite proxy forwards `/api` and sets the `Origin` header the forgery check expects.

## Test

```sh
./vendor/bin/pest                # feature tests on an in-memory SQLite, unit tests
./vendor/bin/pint --test         # formatting
```

Feature tests are named after the sections of `../api/coach-smoke.sh`, so the port's coverage can be
read against the Node suite it replaces.

## PHP settings production needs

The contract has bodies PHP's defaults refuse: a sync is up to 16 MB of JSON (`PUT /api/data`),
an exercise video up to `MEDIA_MAX_VIDEO_MB` (90) raw. Set these in the cPanel PHP selector (or
`.user.ini`) for the backend's PHP version; the test suite cannot see them.

| ini | at least | why |
|---|---|---|
| `post_max_size` | `100M` | above the largest raw upload; PHP refuses larger bodies before Laravel runs (the app still gets the 413 sentence, see `bootstrap/app.php`) |
| `upload_max_filesize` | `100M` | same, for the multipart path should one ever exist |
| `memory_limit` | `256M` | decoding a 16 MB state blob into objects to strip `active` |
| `max_execution_time` | `120` | a 90 MB upload over a slow link |

## Where things are

- `app/Http/Middleware/` — `ReflectOrigin` (CORS as the Node API did it: reflect, never
  credentials; preflight 204 for any path), `NoStore`, `CsrfOrigin` (the `csrfOk` rules; no token).
- `app/Support/` — `Say` (error templates → `msg: {k, v}`), `Json` (every JSON answer), `ClientSafe`
  (a 4xx the caller may read; anything else is `500 {error:'server error'}`).
- `config/fitpal.php` — the environment contract, names kept from the Node API.
- `routes/api.php` — every route registered under `/api` and bare, because the production mount
  is AT `/api` and strips the prefix before Laravel sees the path.
