# Cutover runbook (R5): Node API → Laravel on coach.fitpal.ma

Read this from the top before starting. Every step names its check. A step whose check fails
means **stop**: go to [Rollback](#rollback). Do not improvise. Linear: CHW-299 (prepare),
CHW-300 (the window). The design is spec §9, §11 and §12, and
`docs/DEPLOY_COACH_SUBDOMAIN.md` describes the server.

**Shell:** `ssh -i ~/.ssh/fitpal_coach_ci -p 21098 pawputif@server215.web-hosting.com`. Every
path below is relative to the account home.

## What changes

| | Before | After |
|---|---|---|
| `~/coach.fitpal.ma/api` | Passenger mount (`.htaccess` with Node's env) | symlink → `~/fitpal-coach-backend/public` |
| API code | `~/fitpal-coach-api` (Node 22) | `~/fitpal-coach-backend` (Laravel, PHP 8.5) |
| Data | JSON files in `~/fitpal-coach-data` | MariaDB `pawputif_fitpalcoach`. `DATA_DIR` still points at `~/fitpal-coach-data` for `media/`, `vapid.json` and `secret`. |
| Deploys | `deploy-api.yml` (`DEPLOY_API`) | `deploy-backend.yml` (`DEPLOY_BACKEND`, `BACKEND_SERVER_DIR`, `BACKEND_CHECK_URL`) |
| Cron | none for this app | `schedule:run` every minute: queue, reminders, prune |

These stay as they are:
- `~/coach.fitpal.ma/` and its `deploy-web.yml`, which already excludes `/api`;
- the FIT'ONE and pawpawcare directories and their cron line;
- the session secret, so nobody is signed out;
- the passkeys, which stay bound to `coach.fitpal.ma`.

## Never

- **Never run Node and Laravel against the same data.** Node is stopped (step W3) before the
  import (W5).
- **Never run the import against production twice.** It refuses a database that already holds
  accounts (CHW-297). Don't work around that except as the rollback section says.
- **Never put a secret in chat, a commit or a command line.** `.env` values are written on the
  server by script, or pasted from the clipboard.
- **Never edit the crontab with `crontab -e` or a full `crontab -` rewrite.** Use the filter
  approach below; a rewrite once dropped the pawpawcare line.

## Before the window (CHW-299, done 2026-10-25)

These steps are done. They are kept here so the state is known, and so a rebuilt instance can
repeat them.

### P1. The production `.env`, written on the server before any deploy
One script, run over SSH, writes `~/fitpal-coach-backend/.env` (mode 600). It stops if the file
already exists. It prints no secret:
- **`DB_PASSWORD`:** generated on the server (40 letters and digits, so nothing needs quoting)
  and set with `uapi Mysql set_password user=pawputif_fitpal`. The script checks the login
  works before writing it.
- **`APP_KEY`:** `base64:` followed by 32 random bytes.
- **`SESSION_SECRET`:** the contents of `~/fitpal-coach-data/secret`, which is Node's.
- **`RESEND_API_KEY`:** a new key, `fitpal-coach-production` (sending only, fitpal.ma). It
  goes from the Resend dashboard to the clipboard, then through stdin into a one-off helper on
  the server that checks it looks like `re_…` and sets that one line. The clipboard is cleared
  afterwards.

The other keys:

| Key | Value |
|---|---|
| `APP_NAME` / `APP_ENV` / `APP_DEBUG` / `APP_URL` | `"FitPal Coach"` / `production` / `false` / `https://coach.fitpal.ma` |
| `LOG_CHANNEL` / `LOG_LEVEL` | `single` / `warning` |
| `DB_CONNECTION` / `DB_HOST` / `DB_PORT` | `mysql` / `127.0.0.1` / `3306` |
| `DB_DATABASE` / `DB_USERNAME` | `pawputif_fitpalcoach` / `pawputif_fitpal` |
| `RP_ID` / `ORIGIN` / `RP_NAME` | `coach.fitpal.ma` / `https://coach.fitpal.ma` / `FitPal Coach` |
| `INVITE_ONLY` / `ALLOW_GUEST` / `SELF_SERVE_COACH` | `1` / `0` / `0` (as Node runs; billing is R5b) |
| `BOOTSTRAP_CODE` / `ADMIN_UIDS` | empty (the owner is `admin` in the data itself) |
| `CREEM_*` | absent (billing off until R5b) |
| `DATA_DIR` | `/home/pawputif/fitpal-coach-data` |
| `VAPID_*` | absent, so `DATA_DIR/vapid.json` is used |
| `MAIL_MAILER` / `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME` | `resend` / `no-reply@fitpal.ma` / `"FitPal Coach"` |
| `QUEUE_CONNECTION` / `CACHE_STORE` / `SESSION_DRIVER` | `database` |
| `SESSION_DAYS`, `MEDIA_MAX_*`, `AUDIT_*` | `90`; `90` / `12`; `1`, `5000`, `90`, `off` |

After any later edit to `.env`, run `php artisan optimize`, which caches the config again. Never
run `optimize:clear`: it also empties the application cache, losing pending rest-timer pushes and
recent-sign-in marks.

### P2. First deploy, unmounted
GitHub repository variables:
- `BACKEND_SERVER_DIR=fitpal-coach-backend`;
- `DEPLOY_BACKEND=true`;
- **no** `BACKEND_CHECK_URL` until W9. Node answers on coach.fitpal.ma until the swap, so that
  check could only be red, and a red that means nothing teaches everyone to ignore red.

**Deploy backend** (run 40225176465) was green. It was a first install, so there was nothing to
dump; it ran every migration on the production MariaDB, then `optimize` and
`configuration ok`. On the server afterwards: 23 tables, 0 users, no cron line, and the `/api`
mount still Node's.

From here on, every merge that touches `backend/` deploys here, unmounted.

### P3. The import rehearsed on production, unmounted
This was done on the production instance itself, not on the lab. It runs the same code, `.env`
and MariaDB as the window, and the lab's test accounts survive. One script did it:

```sh
cp -a ~/fitpal-coach-data ~/fitpal-coach-rehearsal-data          # an isolated copy (umask 077)
cd ~/fitpal-coach-backend && php artisan config:clear            # so DATA_DIR below is read
DATA_DIR=~/fitpal-coach-rehearsal-data php artisan fitpal:import-legacy ~/fitpal-coach-rehearsal-data --verify --confirm-live
DATA_DIR=~/fitpal-coach-rehearsal-data php artisan fitpal:import-legacy ~/fitpal-coach-rehearsal-data --verify-only
# then, whatever happened (an EXIT trap):
php artisan migrate:fresh --force && rm -rf ~/fitpal-coach-rehearsal-data && php artisan optimize
```

Result:
- the import read `users 8 · passkeys 2 · states 7 · audit 27 · invites 1 · programs 1 ·
  assignments 5 · push 0 · demos 1 · photos 0`;
- the check said `verified 8 account(s): … and so do the demos, photos, push and passkeys`;
- the stored passkey `rp_id` was `coach.fitpal.ma`;
- `--verify-only` passed;
- a second `--confirm-live` import was refused ("this database already holds accounts").

**Afterwards:** 0 users, the copy deleted, `configuration ok`.

To repeat it, run the same script. W5 refuses to run unless the database is empty.

## The window (CHW-300)

Allow about 30 minutes. The owner is present for the passkey and phone checks. Write down the
time of each step.

**W1. Freeze deploys.** Set `DEPLOY_BACKEND=false` and `DEPLOY_API=false`, then wait for any
running deploy to finish (Actions tab).

**W2. Save what a rollback needs.**
```sh
mkdir -p ~/r5-rollback
cp -a ~/coach.fitpal.ma/api/.htaccess ~/r5-rollback/api.htaccess     # Passenger block + Node's only copy of its env
tar czf ~/r5-rollback/nodevenv.tgz -C ~ nodevenv/fitpal-coach-api
```
**Check:** both files exist and are not empty.

**W3. Stop Node.**
```sh
cloudlinux-selector destroy --json --interpreter nodejs --app-root fitpal-coach-api
mv ~/coach.fitpal.ma/api ~/r5-rollback/api-mount
```
**Check:**
- `ps aux | grep -c '[f]itpal-coach-api'` prints `0`;
- `curl -s https://coach.fitpal.ma/api/health` no longer contains `"ok":true`.

The `destroy` comes first: otherwise a restart of the app rewrites `<docroot>/api/.htaccess`,
which after the swap is Laravel's `public/.htaccess`.

**W4. Snapshot the quiet data.**
```sh
tar czf ~/r5-rollback/data-$(date +%F-%H%M).tgz -C ~ fitpal-coach-data
```

**W5. Import, once.**
```sh
cd ~/fitpal-coach-backend
php artisan fitpal:import-legacy ~/fitpal-coach-data --verify --confirm-live
```
**Check:** it ends with `verified 8 account(s)` and prints no `verify` error. If it refuses,
read the reason: each refusal names the setting, and nothing has been written. Fix `.env`, run
`php artisan optimize`, and run it again.

Then, still with nothing mounted, so nothing can have written to Laravel yet:
- `php artisan fitpal:import-legacy ~/fitpal-coach-data --verify-only` passes;
- `php artisan fitpal:check-config` prints `configuration ok`.

From W6 on, `--verify-only` differs by design. Any open app can sync to Laravel the moment it
is mounted, so it is never run as a pass/fail check after this point.

**W6. Swap the mount.**
```sh
ln -s ~/fitpal-coach-backend/public ~/coach.fitpal.ma/api
```
**Check:** `curl -s https://coach.fitpal.ma/api/config` contains `"login_email"`.

**W7. Add the cron line, keeping the others.**
```sh
crontab -l > ~/r5-rollback/crontab.before
{ cat ~/r5-rollback/crontab.before; echo '* * * * * cd ~/fitpal-coach-backend && /usr/local/bin/php artisan schedule:run -q >> storage/logs/cron.log 2>&1'; } > /tmp/crontab.new
diff ~/r5-rollback/crontab.before /tmp/crontab.new    # exactly one added line
crontab /tmp/crontab.new && crontab -l | grep -c schedule:run
```

**W8. Checks.** The owner, at https://coach.fitpal.ma:
- [ ] signs in with the existing passkey;
- [ ] sees the roster (6 demo clients) and the program;
- [ ] plays the exercise demo video;
- [ ] enables notifications, starts a rest timer and gets the push;
- [ ] a paired phone, if one is paired, is still signed in;
- [ ] Account → adds their email, and the confirm mail arrives and its link redeems;
- [ ] `php artisan fitpal:panel-login LDH3HiEWUyOzK7tY` (the owner types the password), then signs in at `/api/admin-panel`.

**W9. Unfreeze.**
- Set `BACKEND_CHECK_URL=https://coach.fitpal.ma/api/config` and `DEPLOY_BACKEND=true`.
- Leave `DEPLOY_API=false`, for good.
- Dispatch **Deploy backend**.

**Check:** green, including "Check Laravel answers".

## Rollback

This is possible for 7 days. It puts Node back on its untouched files. **Anything written in
Laravel since the window is lost.**

1. Set `DEPLOY_BACKEND=false`.
2. Remove the cron line: `crontab -l | grep -v 'fitpal-coach-backend' > /tmp/c && diff <(crontab -l) /tmp/c; crontab /tmp/c`.
3. Swap the mount back. Before W6 there is no symlink to remove; the first line handles both cases:
   ```sh
   [ -L ~/coach.fitpal.ma/api ] && rm ~/coach.fitpal.ma/api
   mv ~/r5-rollback/api-mount ~/coach.fitpal.ma/api
   ```
4. Restore the venv if `destroy` removed it:
   ```sh
   [ -d ~/nodevenv/fitpal-coach-api ] || tar xzf ~/r5-rollback/nodevenv.tgz -C ~
   ```
5. Re-register the app. Either:
   - `cloudlinux-selector create --json --interpreter nodejs --version 22 --app-root fitpal-coach-api --domain coach.fitpal.ma --app-uri api --startup-file server.js`, or
   - cPanel → Setup Node.js App, with the same values.

   Then compare `~/coach.fitpal.ma/api/.htaccess` with `~/r5-rollback/api.htaccess`, and copy
   the env block back if it differs.
6. Set `DEPLOY_API=true` and dispatch **Deploy API**, which reinstalls `node_modules`.
7. **Check:** `curl -s https://coach.fitpal.ma/api/health` shows `"users":8`, and the owner signs in.

If the import refused or failed part-way **before W6**, Node is only stopped and there is no cron
line yet. Run steps 3–7, then empty the Laravel database with `migrate:fresh --force` before the
next try.

Each backend deploy also keeps its own dump in `~/fitpal-coach-backend/storage/backups/`
(`db-<time>-<commit>.sql.gz`, the newest five), taken in maintenance mode before it changes
anything. That is the undo for a bad backend deploy after the cutover, which is a different
case from this rollback to Node.

## After 7 quiet days (CHW-301)

Retire `api/` and its CI. Delete `~/fitpal-coach-api` and `~/r5-rollback`, and the Node files in
`~/fitpal-coach-data`. **Keep `secret`, `vapid.json` and `media/`**, which Laravel reads at
runtime.
