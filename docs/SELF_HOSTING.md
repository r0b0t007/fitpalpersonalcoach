# Self-hosting FitPal Coach

Two processes and a folder of your data: an API (Node, no framework) and a static frontend that
any web server can hand out. This guide takes you from "just cloned it" to "using it from my phone
over the internet".

> There used to be a Docker path here — two images and a compose file. It was removed: this
> product deploys to a cPanel account over rsync, so the images were maintained, built in CI and
> published, and never run. What follows is what actually runs it.

## 1. Run it locally (5 minutes)

Requirements: Node 22 or newer, and git.

```bash
git clone https://gitlab.com/DuarteSantos8/opengym
cd openGym
cp .env.example .env
./scripts/fetch-media.sh          # exercise images/GIFs (~140 MB), once
```

`.env` is read by the API at startup, from the repo root. Anything already set in the
environment wins over the file, which is how deployments that configure variables in a hosting
panel (this product's own, for one) run with no `.env` at all.

Two processes. The API:

```bash
cd api && npm ci && node server.js          # :3000
```

The frontend, in another terminal:

```bash
cd frontend && npm install && npm run dev    # :5173, proxies /api to :3000
```

Open **http://localhost:5173** and create a profile with a passkey.

Check it's healthy:

```bash
curl http://localhost:3000/api/health      # {"ok":true,...}
```

## 2. Understand the passkey requirement (important)

openGym signs you in with **passkeys** (WebAuthn). Browsers enforce two rules:

1. Passkeys are bound to an exact **hostname** (`RP_ID`).
2. They only work over **HTTPS** — with one exception: `http://localhost`.

So `http://localhost:5173` works on the machine running it, but **another device (your
phone) cannot use `http://<your-LAN-ip>:5173`** — that's neither localhost nor HTTPS, so the
passkey prompt won't appear. To use openGym from your phone you need a real HTTPS hostname.

(You can still open it over LAN in **guest mode**, which stores data only in that browser.)

The standalone mobile app (`docs/MOBILE.md`) sidesteps this entirely for its "connect to my
server" mode: instead of a passkey ceremony (impossible from inside its WebView, which never
runs at your real hostname), it pairs by redeeming a short one-time code — minted from
Settings → "Pair the mobile app" in an already signed-in browser tab — for a bearer token
sent as an `Authorization` header rather than a cookie. Two consequences worth knowing if
you're poking at the API directly:

- `POST /api/pair/create` (needs a session) and `POST /api/pair/redeem` (doesn't) implement
  this — see `api/server.js`. The returned token is the exact same signed value a cookie
  carries, so "sign out everywhere" invalidates it too.
- The server reflects `Access-Control-Allow-Origin` for any request that sends an `Origin`
  header, so the app's own WebView origin can call the API cross-origin. It never sends
  `Access-Control-Allow-Credentials`, so this doesn't let a browser read your cookie session
  from another origin — only bearer-token requests benefit from it.

## 3. Expose it over HTTPS on your own domain

> Want HTTPS **without** exposing anything to the internet — a valid certificate on a LAN-only address? See [SELF_HOSTING_HTTPS.md](./SELF_HOSTING_HTTPS.md) (wildcard cert via a DNS challenge, Caddy in front).

Two things have to be true, and the second is the one people get wrong:

1. A hostname you control, served over HTTPS.
2. **The app and the API on the same origin.** `https://coach.example.com/` serves the built
   frontend, and `https://coach.example.com/api/*` reaches the API process. Not a second
   hostname, not a different port — passkeys are bound to the origin, and the session cookie is
   scoped to it.

Build the frontend once:

```bash
cd frontend && npm ci && npm run build      # → frontend/dist/
```

Then serve `frontend/dist/` as the document root and proxy `/api` to the API. Any web server
does this. Caddy, with automatic Let's Encrypt:

```caddy
coach.example.com {
    header {
        # The app ships no web server of its own, so these are yours to set. SECURITY.md
        # treats a missing one as a self-hosting bug, not an app bug.
        X-Frame-Options "DENY"
        Content-Security-Policy "frame-ancestors 'none'"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "same-origin"
    }

    handle /api/* {
        reverse_proxy localhost:3000
    }

    # Exercise images and GIFs, from ./scripts/fetch-media.sh. The app asks for them at /img
    # and /gif relative to the page, so they have to be served from this same origin — miss
    # this and the app works perfectly with every exercise picture broken.
    handle /img/* {
        root * /srv/fitpal
        file_server
    }
    handle /gif/* {
        root * /srv/fitpal
        file_server
    }

    handle {
        root * /srv/fitpal/frontend/dist
        file_server
    }
}
```

(`/srv/fitpal` being the clone, so `/img/*` resolves to `/srv/fitpal/media/img/…` — move the
`media/` folder wherever you like and point `root` at its parent. No `try_files` rewrite is
needed: the app is hash-routed, so the server only ever sees `/`.)

nginx, Apache and Cloudflare Tunnel all do the same job — one origin, `/api` to the API process,
`/img` and `/gif` to `media/`, everything else to `dist/`. On the cPanel account this product
actually deploys to, that is Apache with an `.htaccess`, and the media comes from a CDN instead
(`VITE_IMG_BASE`); see [DEPLOY_NAMECHEAP.md](./DEPLOY_NAMECHEAP.md).

Set your domain in `.env` and restart the API:

```bash
# .env
RP_ID=coach.example.com
ORIGIN=https://coach.example.com
RP_NAME=FitPal Coach
```

Visit `https://coach.example.com`, create your profile, and add it to your home screen
(iOS: Share → Add to Home Screen · Android: ⋮ → Add to Home screen).

> Changing `RP_ID` later invalidates existing passkeys (they were bound to the old hostname).

## 4. Multiple users

Anyone who can reach the URL can create their own profile — each gets isolated data. That's the
default: open signup, no admin.

If you'd rather control who gets in, three optional settings in `.env` turn that around:

```bash
ADMIN_UIDS=youruserid      # comma-separated; these users get the admin dashboard
INVITE_ONLY=1              # new profiles need an invite code
ALLOW_GUEST=0              # remove "Continue without account"
```

Register your own passkey profile first, then find your id in `./data/db.json` under `users[].id`
and put it in `ADMIN_UIDS`. You'll get an **Admin dashboard** row under **Account** (the coach shell's
Settings screen): who's training
right now, each user's workout history and body weight, the ability to disable an account (signed
out and locked out everywhere until you re-enable it), and — with `INVITE_ONLY=1` — generating and
revoking invite codes. Existing accounts keep working when you switch invite-only on. Admin access
is gated by your passkey and enforced server-side, so it needs no separate login.

### The activity log

The dashboard also keeps an **activity log**: sign-ins, sign-outs, failed attempts, refused
signups, and every admin action (disabling an account, creating or revoking an invite code). It
lives in `./data/audit.log` as one JSON object per line, so `tail -f data/audit.log` and `jq`
work on it directly, and the dashboard reads the same file.

It is on by default and keeps the last 5,000 events or 90 days, whichever comes first
(`AUDIT_LOG=0` turns it off entirely; `AUDIT_MAX` and `AUDIT_DAYS` change the caps). **IP
addresses are not recorded** unless you set `AUDIT_IP=net` (network only, e.g. `203.0.113.0/24`)
or `AUDIT_IP=full`. Neither the browser's user-agent nor the passkey id of a failed sign-in is
ever stored: the first is a fingerprint, and the second would let you follow an unknown device
from one attempt to the next.

Two things worth expecting. **Guests never appear** — guest mode never talks to the server, so
there is nothing to log, exactly as there is nothing for the rest of the dashboard to show. And
**a disabled account goes quiet**: a disabled user is refused at the session check, so their only
entries are the failed sign-ins they keep making.

Clearing the log from the dashboard records the clear itself, and the event ids keep counting, so
a gap is always visible.

`INVITE_ONLY=1` and `ALLOW_GUEST=0` answer different questions and are usually set together.
Invite-only controls who may *create a profile*; it says nothing about the **Continue without
account** button, which never creates one. Guest mode keeps everything in that browser and never
talks to the server — there is no account, no sync and nothing for the admin dashboard to show —
so on an instance meant for a known set of people it is a door that leads nowhere useful. With
`ALLOW_GUEST=0` the button is gone, and anyone already using the app as a guest is returned to the
login screen on their next visit. Their data is not deleted: it stays in that browser and comes
back if you ever switch guests on again, or moves into a real profile if they create one on the
same device.

Prefer to keep the whole thing off the open internet? A VPN or an auth proxy (Authelia, Cloudflare
Access…) in front still works, and composes with the above.

## 5. Limits and sizes

```bash
PORT=3000                  # port the API listens on; your web server proxies /api here
SESSION_DAYS=90            # how long a sign-in lasts
MEDIA_MAX_VIDEO_MB=90      # coach exercise demos (see below)
MEDIA_MAX_PHOTO_MB=12      # a client's own progress photos (see below)
```

The two media caps are separate from the 5 MB JSON body limit because uploads stream straight to
disk rather than being buffered and parsed — a large video is never a large Buffer in the node
heap, and no JSON route inherits the bigger number. Uploads land in `DATA_DIR/media/`, so the
existing backup covers them.

The two caps sit on two different routes with two different audiences. `MEDIA_MAX_VIDEO_MB` bounds
`POST /api/media/exercise`, which only a coach may call and whose files every signed-in member can
then watch. `MEDIA_MAX_PHOTO_MB` bounds `POST /api/media/photo`, which any member calls for
themselves and whose files only they and their coach can open — the metadata lives in
`DATA_DIR/media-<uid>.json`, deliberately beside `state-<uid>.json` rather than inside it, because
`PUT /api/data` replaces that file wholesale on every sync. 12 MB is generous and is not the number
that normally applies: the app re-draws each photo on a canvas at 1600 px before sending, which
lands around 300-500 KB. The cap exists for the raw-bytes path — the route takes a file, not a
form — and for a phone the resize failed on.

That client-side resize also strips the photo's EXIF, GPS included, because a canvas holds decoded
pixels and no metadata. It is a property of the app, **not** a guarantee this server enforces:
nothing in `api/` parses EXIF, and anything can post raw bytes at the route. Do not describe it to
clients as a server-side promise.

**Whatever sits in front of the app is the limit that actually fires, and it is yours to set.**
nginx's `client_max_body_size` defaults to 1 MB, Apache and Cloudflare have their own ceilings
(Cloudflare refuses bodies over 100 MB on free and pro), and a node cap above the proxy's is not
a cap at all: the upload dies out there, usually with an HTML error page the app cannot parse, and
the app reports a limit it never enforced. Raise your proxy's limit above `MEDIA_MAX_VIDEO_MB` so
node's is the one that gets hit — node can answer it in JSON, which is what the app knows how to
read.

Whether the API can refuse an upload *early* depends on the same proxy. It identifies a file from
its first 64 bytes and refuses before writing the rest, which only happens on a deployment that
streams to it. A proxy that buffers the whole body first — nginx does, by default — means the API
sees the upload only once it has fully arrived. The refusal is identical either way; the bytes are
simply already spent.

Note the difference from `VITE_IMG_BASE` / `VITE_GIF_BASE` (see Troubleshooting): those are
build-time values baked into the frontend bundle by `npm run build`, so changing them means
rebuilding `dist/`, not restarting anything.

## 6. Backups

Everything is in `./data`:

```bash
tar czf opengym-backup-$(date +%F).tar.gz data/
```

That archive contains all profiles, passkeys and workout history — and, if the activity log is
on, `audit.log` with everyone's sign-in times. Worth knowing before you ship the archive to a
backup service you don't run. Restore by unpacking it back into the project folder. (Individual
users can also export their own data as JSON from Settings.)

### Upgrading from a version that had the AI Coach

That feature has been removed. Nothing in the app reads its files any more, but nothing deletes
them either, and two of them hold credentials:

- `./data/coach.json` — your provider API keys, encrypted with `./data/secret`. Still in every
  backup archive you take, and still decryptable by anyone holding both files.
- `./coach-auth/` — the Codex provider's refresh-token cache, if you ever connected it.

Delete both, and revoke the keys at the provider while you are there — a key that is no longer
used by anything is still a live key. The app will not miss them:

    rm -f data/coach.json && rm -rf coach-auth

## 7. Notifications

openGym can push two kinds of alert to your phone/desktop, even when the app isn't open:
rest-timer-over, and a reminder on days you have a workout planned but haven't logged one yet.
Turn it on per-profile in **Settings → Notifications** (requires a signed-in passkey profile and
HTTPS — see section 3).

No setup needed server-side, and nothing to configure per timezone: VAPID keys are generated on
first run and saved to `./data/vapid.json`, and each user's browser reports its own timezone
automatically when they turn the reminder on — it fires at their local time, and follows them if
they travel, regardless of what timezone the server itself runs in.

**Keep screen awake** (Settings → *During a workout*) has the same transport requirement: the
Wake Lock API is only available over HTTPS or on `http://localhost`, so on a plain-LAN-IP
instance the switch shows as unsupported. Nothing to configure server-side either way, and iOS
refuses the lock while the phone is in Low Power Mode.

Push services like a contact address for whoever runs the server, in case they ever need to reach
you about your pushes. openGym sends your `ORIGIN` by default; set `VAPID_SUBJECT=mailto:you@example.com`
in `.env` if you would rather they had an inbox.

## 8. Updating

```bash
git pull
cd api      && npm ci && <restart the API process>
cd frontend && npm ci && npm run build      # → dist/, which your web server already serves
```

The app shell is versioned (`?v=N`) so clients pick up changes on next load. Your `./data` and the
downloaded media are untouched.

How you restart the API is yours: `systemd`, a process manager, or cPanel's "Restart" button. The
API holds nothing in memory that matters — state is on disk — so a hard restart is safe at any
moment.

## Passkeys fail even though `RP_ID` looks right

The most common support question, and the values are usually *nearly* correct. Work through
these in order — the first two account for most of it.

**1. Ask the server what it actually loaded.** It prints both values on startup:

```
# in the API's own log, on every start:
# gym-api on :3000 (rpID=coach.example.com, origin=https://coach.example.com)
```

If that disagrees with your `.env`, the process is still running the old environment — it reads
the file once, at startup. Restart it.

**2. Check the exact shape of each value.** They are not the same kind of string:

| | Correct | Wrong |
|---|---|---|
| `RP_ID` | `gym.example.com` | `https://gym.example.com`, `gym.example.com:8080`, `gym.example.com/` |
| `ORIGIN` | `https://gym.example.com` | `gym.example.com`, `https://gym.example.com/` |

`RP_ID` is a bare hostname: no scheme, no port, no trailing slash. `ORIGIN` is the full origin
*with* the scheme and *without* a trailing slash. Both must match your address bar exactly.

**3. Behind a tunnel or reverse proxy, use the public hostname.** With Cloudflare Tunnel,
Traefik, nginx or Caddy in front, the browser only ever sees the public name — so that is what
both values must be. Not the LAN IP, not the internal port:

```env
RP_ID=gym.example.com
ORIGIN=https://gym.example.com
```

The tunnel's own route may point wherever it likes (`http://localhost:8080` is fine). It is the
browser-facing name that has to appear here.

**4. `www.` is a different host.** A passkey registered on `gym.example.com` will not work on
`www.gym.example.com`. Pick one and redirect the other.

**5. Changing the hostname invalidates existing passkeys.** They were bound to the old one, so
everybody registers again — which is why it pays to settle the domain before others join.

> On a LAN without certificates there is nothing to configure that makes passkeys work over
> plain `http://192.168.x.x`: browsers only allow WebAuthn on HTTPS (or `localhost`). Use guest
> mode, the standalone mobile app (`docs/MOBILE.md`), or put a certificate in front of it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| No passkey prompt on my phone | You're on `http://` or an IP, not HTTPS. Set up a domain (section 3). |
| "verification failed" on login | `RP_ID`/`ORIGIN` don't match the URL in the address bar. See the section above — start with what the server logged on startup. |
| Media didn't download | Run `./scripts/fetch-media.sh`. It is safe to re-run — it skips a folder that already has files in it (`--force` re-downloads). |
| Exercise pictures are all broken | The media is there but nothing is serving it. `/img` and `/gif` have to come from the same origin as the app — see the web-server config in section 3. |
| Port 3000 already used | Set `PORT=3001` in `.env` and point your web server's `/api` proxy at the new one. |
| No "Notifications" option in Settings | Requires a signed-in profile and HTTPS (or `localhost`) — guest mode and plain HTTP over LAN can't subscribe. |
| Day reminder fires at the wrong time | Toggle it off and on in Settings so it re-detects your browser's timezone (also happens automatically on every app load — see section 7). |
| Want to reset a stuck login | Delete the cookie in your browser; sessions are just signed cookies. |
| Exercise images/GIFs blank when a routine is open | The media never downloaded, or `VITE_IMG_BASE` points somewhere unreachable — see the note below. |

### `VITE_IMG_BASE` / `VITE_GIF_BASE` are build-time, not run-time

These two are read by Vite when the frontend is **compiled**, so their values are baked into the
shipped JavaScript bundle. Changing them in `.env` does nothing to a `dist/` that already exists —
the bundle has already made up its mind.

Export them and rebuild:

```bash
cd frontend
VITE_IMG_BASE=https://media.example.com/img npm run build
```

If you would rather not rebuild, redirect the media path in your web server instead.
