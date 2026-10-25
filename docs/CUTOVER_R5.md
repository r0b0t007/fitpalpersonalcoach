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

## Before the window (CHW-299)

### P1. Rehearse the import on the lab
The point is to prove the import and `--verify` against a copy of the real data. Use the
copy only on the lab, and delete it afterwards.

```sh
cp -a ~/fitpal-coach-data ~/fitpal-coach-lab/rehearsal-data
cd ~/fitpal-coach-lab/backend
# .env: DATA_DIR=/home/pawputif/fitpal-coach-lab/rehearsal-data and
#       SESSION_SECRET=<contents of rehearsal-data/secret> (by script, see P2).
php artisan optimize && php artisan migrate:fresh --force
php artisan fitpal:import-legacy ~/fitpal-coach-lab/rehearsal-data --verify --confirm-live
```
**Check:** it ends with `verified 8 account(s)`.

Passkeys don't work on the lab, because they are bound to `coach.fitpal.ma`. The lab
therefore imports with `RP_ID=lab.fitpal.ma` and verifies everything except passkeys.

The lab runs `APP_ENV=production`, so the production guards apply. If the import refuses,
it names the setting. Expect one of: the database isn't empty, `SESSION_SECRET` isn't the
copy's, or `VAPID_*` is set in the lab `.env` (unset it, so the copy's `vapid.json` is used).

**Afterwards:**
1. Run `migrate:fresh --force` again.
2. `rm -rf ~/fitpal-coach-lab/rehearsal-data`.
3. Put the lab's own `DATA_DIR` and `SESSION_SECRET` back.
4. `php artisan optimize`.

**Check:** the lab database holds no production rows.

### P2. Write the production `.env`, before any deploy
```sh
mkdir -p ~/fitpal-coach-backend && cd ~/fitpal-coach-backend
touch .env && chmod 600 .env
```
Set these values with `~/lab-env-set.php`, or an editor. Do not echo any of them. Anything not
listed takes the default in `config/`.

| Key | Value |
|---|---|
| `APP_NAME` / `APP_ENV` / `APP_DEBUG` | `"FitPal Coach"` / `production` / `false` |
| `APP_KEY` | `base64:` followed by `php -r 'echo base64_encode(random_bytes(32));'`, written by the same script |
| `LOG_CHANNEL` / `LOG_LEVEL` | `single` / `warning` |
| `DB_CONNECTION` / `DB_HOST` / `DB_PORT` | `mysql` / `127.0.0.1` / `3306` |
| `DB_DATABASE` / `DB_USERNAME` | `pawputif_fitpalcoach` / `pawputif_fitpal` |
| `DB_PASSWORD` | reset on the server: `uapi Mysql set_password user=pawputif_fitpal password=<generated>`, written straight into `.env` by the same script |
| `RP_ID` / `ORIGIN` / `RP_NAME` | `coach.fitpal.ma` / `https://coach.fitpal.ma` / `FitPal Coach` |
| `INVITE_ONLY` / `ALLOW_GUEST` / `SELF_SERVE_COACH` | `1` / `0` / `0` (as Node runs; billing is R5b) |
| `BOOTSTRAP_CODE` | empty (accounts exist) |
| `CREEM_*` | unset (billing off until R5b) |
| `DATA_DIR` | `/home/pawputif/fitpal-coach-data` |
| `SESSION_SECRET` | the contents of `~/fitpal-coach-data/secret`, copied by script: `php -r '…'` reads the file and writes the key |
| `VAPID_*` | unset, so `DATA_DIR/vapid.json` is used |
| `MAIL_MAILER` / `MAIL_FROM_ADDRESS` / `MAIL_FROM_NAME` | `resend` / `no-reply@fitpal.ma` / `FitPal Coach` |
| `RESEND_API_KEY` | a new key, `fitpal-coach-production` (sending only, fitpal.ma), pasted from the clipboard |
| `QUEUE_CONNECTION` / `CACHE_STORE` / `SESSION_DRIVER` | `database` |

### P3. First deploy, with production unmounted
GitHub repository variables:
- `BACKEND_SERVER_DIR=fitpal-coach-backend`
- `BACKEND_CHECK_URL`: leave it **unset** until W9. Node answers on coach.fitpal.ma until the
  swap, so that check could only be red, and a red that means nothing teaches everyone to
  ignore red.
- `DEPLOY_BACKEND=true`

Then dispatch **Deploy backend**. A first install has nothing to dump, so it syncs, migrates,
optimizes and runs `fitpal:check-config`.

**Check:** the run is green. Then check on the server:

```sh
cd ~/fitpal-coach-backend
php artisan fitpal:check-config         # → configuration ok (the deploy's last step ran it too)
php artisan route:list --path=api/config
```
After any later edit to `.env`, run `php artisan optimize`, which caches the config again. Never use `optimize:clear`: it also empties the application cache (pending rest-timer pushes, recent-sign-in marks). The
config is cached, so an edit is not seen until then.
Nothing runs yet: there is no mount, no cron and no import.

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
