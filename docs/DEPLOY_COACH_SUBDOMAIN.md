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

3. **`~/fitpal-coach-api/.env`** — created by hand and never deployed (rsync excludes it):

   ```
   RP_ID=coach.fitpal.ma
   ORIGIN=https://coach.fitpal.ma
   PORT=3000
   DATA_DIR=/home/<user>/fitpal-coach-api/data
   ```

   `RP_ID` is load-bearing. WebAuthn passkeys are bound to an exact hostname, so a passkey
   created on `app.fitpal.ma` cannot sign in here and vice versa. That is correct — these are
   separate products with separate accounts — but it means coaches and clients enrol here
   fresh.

4. **`~/fitpal-coach-api/data/`** — create it, `chmod 700`. It holds users, passkey credentials,
   the session secret and every client's training. It is excluded from rsync, so the deploy
   never touches it. **This is the directory to back up.**

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

Still needed — **secrets**, which have to be pasted by a human:

```
SSH_HOST    server215.web-hosting.com
SSH_USER    <cPanel username>
SSH_KEY     private half of a key whose public half is in ~/.ssh/authorized_keys
```

Then, once cPanel is ready and only then, turn the deploys on:

```
DEPLOY_WEB=true
DEPLOY_API=true
```

They are unset today, which is why nothing in this repo can deploy yet.

## The guard

`deploy-web.yml` and `deploy-api.yml` each refuse a target of `""`, `.`, `./`, `..`, `~`, `/`
or `$HOME` before rsync runs. Any of those resolves to the account home, where `--delete`
would take `public_html/`, `opengym-api/`, `fitpal.ma/`, `mail/` and `.ssh/` with it. The
failure mode is a red build rather than a restore from backup.

Two related fixes live alongside it: the excludes are anchored (`/data/`, not `data/`, which
rsync would otherwise match at every depth including inside `node_modules/`), and the api sync
passes `-K` so cPanel's `node_modules` symlink into the Node venv is written *through* rather
than replaced with a real directory.

## Checking it worked

```
curl -fsS https://coach.fitpal.ma/api/health     # {"ok":true,...}
curl -fsS https://coach.fitpal.ma | grep '<title'
```

The frontend health check greps the served HTML for `<title>FIT`. If the brand in
`frontend/src/lib/brand.js` is ever changed to something that does not contain that string,
update the grep in `deploy-web.yml` with it.
