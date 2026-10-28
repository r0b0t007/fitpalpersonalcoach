# Filming the app for the tutorial videos

The coach tutorial series (ten episodes, built with HyperFrames outside this repo at
`../fitpal-coach-videos/`) uses **real screenshots of the app**, never redrawn UI. This is how
they are taken, and why they are taken this way.

## The constraint

Every shot has to be **exactly 359×776 px** — the screen box inside the video's phone mockup.
Anything else is resampled on the way into the render, and resampled 13 px UI text looks soft.

Two obvious approaches do not work:

- **HyperFrames' own `capture` crawler** cannot get past the passkey sign-in. There is no
  password to script, which is the whole point of the auth design.
- **Screenshotting a real browser window** cannot produce 776 px of viewport: a maximised window
  on a 1536×864 CSS desktop leaves about 695 px once the browser's own chrome is taken out, and
  Chrome's screenshot is capped at 1568×710 anyway.

## The harness

`frontend/dev/capture-boot.html`, served at `/capture-boot.html` by a dev-only Vite plugin
(`captureHarness` in `frontend/vite.config.js`). It is **not** in `frontend/public/`: everything
there is copied into `dist/` and rsynced to coach.fitpal.ma, and a page that takes a session
cookie from a query string and drives the app inside an iframe has no business on a production
origin. `apply: 'serve'` keeps it out of every build; `npm run build` is the check.

The page takes four parameters:

| param | meaning |
|---|---|
| `c` | session cookie value to plant, e.g. `gymsid=<uid>:<expiry>:<sv>.<mac>` |
| `u` | app route to open, e.g. `/#/clients` |
| `do` | `;`-separated steps: `click:<text>`, `type:<selector>\|<text>`, `scroll:<px>`, `wait:<ms>` |
| `rect` | `\|`-separated element names whose on-screen box to report, for placing callouts |

It opens the app in an iframe of exactly 359×776, runs the steps, and freezes every transition
and animation before the shot is taken. `click:` and `rect` match on an element's visible text
(placeholder and `aria-label` count), and a name may be prefixed `sheet:` to scope the search
inside an open sheet — without it, `Omar Tazi` matches the roster row still visible behind the
backdrop rather than the row inside the sheet.

## Taking a shot

```bash
chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run \
  --user-data-dir=<SHORT PATH> \
  --window-size=359,776 --force-device-scale-factor=1 \
  --virtual-time-budget=9000 \
  --screenshot=<out.png> \
  "http://localhost:5173/capture-boot.html?c=…&u=…&do=…"
```

Four flags matter and each one was learned by getting a blank PNG:

- **`--window-size=359,776` with `--force-device-scale-factor=1`** is what makes the output the
  exact size the video wants, with no resampling anywhere in the chain.
- **`--virtual-time-budget`** lets the SPA's first data fetch and the harness's own waits finish
  before the screenshot fires. It also runs those waits on a clock CSS transitions do not follow,
  which is why the harness freezes them rather than sleeping past them — a sheet filmed right
  after it opens came back entirely black, backdrop already opaque and the panel still off the
  bottom of the screen.
- **`--user-data-dir` must be a SHORT path.** Nested under a deep temp directory, Chrome's own
  cache paths overrun Windows' 260-character limit and it exits without writing the screenshot
  and without an error you would notice. `%TEMP%\hfcap\<name>` works.
- **Git Bash rewrites POSIX-looking arguments.** `/#/clients` becomes
  `C:/Program Files/Git/#/clients` and the iframe loads nothing; `MSYS_NO_PATHCONV=1` stops that,
  but then `--screenshot=/c/Users/…` is passed through verbatim and the file lands under
  `C:\c\Users\…`, written and then invisible to every later command. Set the variable and convert
  the output path with `cygpath -w`.

## Getting a session

The API signs its cookie as `<uid>:<expiry>:<sv>` HMAC-SHA256 with `DATA_DIR/secret`
(`makeSession` in `api/server.js`). For a local capture instance, mint one directly:

```js
const payload = uid + ':' + (Date.now() + 90 * 86400000) + ':0'
const mac = crypto.createHmac('sha256', readFileSync(DATA_DIR + '/secret')).update(payload).digest('base64url')
// cookie value: 'gymsid=' + payload + '.' + mac
```

Only ever against a throwaway local `DATA_DIR`. Never against production.

## Placing callouts

The video draws gold tethers and rings onto the phone's screen. Their boxes are **measured, not
eyeballed**: `?rect=` returns each element's `getBoundingClientRect` in the capture's own 359×776
pixels and as a percentage of it, and the percentages go straight into the frame's markup, so a
marker rides the screenshot exactly. Guessing coordinates off a screenshot puts a ring half a row
out, and that only shows up in the final render.

## Seeding what is on screen

The captures are filmed against six demo clients, seeded onto the capture instance's coach:

```bash
cd backend
php artisan fitpal:seed-demo --tz=Africa/Casablanca   # the coach's calendar; --coach <id> if there are several
php artisan fitpal:seed-demo --list                   # what is there
php artisan fitpal:seed-demo --remove                 # exactly what it added, and nothing else
```

The same run always produces the same histories, so a `--remove` and a re-seed film the same
roster. `--tz` matters: the dates are calendar days, and seeded in UTC a check-in filed "today"
reads as yesterday for a coach east of Greenwich in the first hours after midnight. The demo
clients have no passkey, so nobody can sign in as one. On a production instance the command asks
for `--force`.

Some states cannot be reached by clicking — a used invite in the sheet's **Joined** section
needs a real passkey registration, which no automation can drive — so those rows are written
into the capture instance's database directly (`php artisan tinker`; an `invites` row with
`used_by` and `used_at` set). Nothing needs restarting: the backend reads the database on every
request. Keep them consistent with what the other episodes already filmed.
