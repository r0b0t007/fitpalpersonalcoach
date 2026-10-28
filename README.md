<div align="center">

# ⚡ FIT'ONE
### CLUB FITNESS

**The FIT'ONE member app — plan your training, follow the club's classes, track every set.**

A white-label deployment of **[openGym](https://gitea.com/DuarteSantos/openGym)**, rebranded in
the club's black & metallic gold, with membership by invite or access request, a public
group-session timetable, and a test-gated CI/CD pipeline deploying to Namecheap hosting.

<br>

![Built on openGym](https://img.shields.io/badge/built%20on-openGym-000000?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-installable-a78bfa?style=flat-square)
![React](https://img.shields.io/badge/React-19-38bdf8?style=flat-square&logo=react&logoColor=white)
![No tracking](https://img.shields.io/badge/telemetry-none-f472b6?style=flat-square)


</div>

<br>

<div align="center">
<table>
<tr>
<td align="center"><img src="assets/screenshots/home.png" alt="Home" width="230"><br><sub><b>Home</b> — today's workout & weight</sub></td>
<td align="center"><img src="assets/screenshots/workout.png" alt="Workout" width="230"><br><sub><b>Guided workout</b> — animated demos & sets</sub></td>
<td align="center"><img src="assets/screenshots/stats.png" alt="Stats" width="230"><br><sub><b>Stats</b> — heatmap, charts & PRs</sub></td>
</tr>
</table>
</div>

## What FIT'ONE adds on top of openGym

- **⚡ Brand** — black `#000000` / metallic gold `#D4AF37` identity: logo, app icons, default
  accent, PWA manifest and native app names. Brand strings live in one module
  (`frontend/src/lib/brand.js`), so upstream merges stay a one-file diff.
- **📋 Access requests** (`REQUEST_ACCESS=1`) — visitors without an invite code can ask to
  join from the sign-in screen; the admin approves a request into a single-use invite code
  and texts it back. Per-phone dedupe, auto-expiry, and no unauthenticated surface beyond
  this one endpoint.
- **👥 Group sessions** — coached classes on a month calendar, visible to everyone including
  guests. Admins manage the timetable (weekly repeats, series-wide edit/delete) from the
  dashboard; members view it under the new **Sessions** tab. View-only by design — booking
  happens at the desk.
- **🚀 CI/CD** — every PR runs the frontend, api and mcp test suites; pushes to `main`
  deploy the api and the static frontend to Namecheap shared hosting behind opt-in switches,
  a manual-approval environment and post-deploy health checks. See
  **[docs/DEPLOY_NAMECHEAP.md](docs/DEPLOY_NAMECHEAP.md)**.

## How a member gets access

With the club configuration below (`INVITE_ONLY=1`, `REQUEST_ACCESS=1`):

1. **Open the club's URL** on your phone and add it to the home screen — it installs as a
   full-screen app. The **Sessions** timetable is visible right away, account or not.
2. **Tap "Create new profile."** No invite code yet? Tap **"No code yet? Request access"**
   and leave your name, phone number and an optional note.
3. **The gym approves the request** in the admin dashboard. Approval mints a single-use
   invite code, and the admin texts it to the number you left (the app itself never
   contacts anyone — one tap opens a prefilled SMS).
4. **Enter your name + the code and confirm with a passkey** — Face ID, fingerprint or
   device PIN. No password exists anywhere; the code is burned on use and the dashboard
   shows you as *joined*.
5. **From then on it's one tap** — "Sign in with passkey." Sessions last 90 days by
   default, and your plan, workouts and body weight sync to your profile on any device.

**The front-desk shortcut:** admins can also generate an invite code directly from the
dashboard's *Invite codes* card and hand it over on the spot — same machinery, no request.

> Passkeys are bound to the exact domain (`RP_ID`) over HTTPS. Pick the final domain
> **before** members register — changing it later invalidates every passkey.

## Club setup

The recommended `.env` for a members-only club (see `.env.example` for the full comments):

```bash
RP_ID=gym.example.com        # the final domain — decide before anyone registers
ORIGIN=https://gym.example.com
RP_NAME=FIT'ONE
INVITE_ONLY=1                # profiles need an invite code
REQUEST_ACCESS=1             # …but visitors can request one from the sign-in screen
ALLOW_GUEST=0                # a profile is the only way in (timetable stays public)
BOOTSTRAP_CODE=<long-random> # lets the first account in and makes it an admin
```

Bootstrap order: deploy → open the app → *Create new profile* → enter `BOOTSTRAP_CODE`
as the invite code. That account is created as an admin, and the **You** tab then shows the
**Admin dashboard**, where access requests, the class timetable, invite codes and member
accounts live.

`INVITE_ONLY` on an empty database would otherwise be a lockout with no key: registering
needs an invite, invites are minted only by an admin, and admins are recognised only by
`ADMIN_UIDS` — so nobody, including you, could get in. `BOOTSTRAP_CODE` breaks that loop
without opening the door, and **disarms itself the moment a user exists**. Use a long
random string — `openssl rand -hex 16`; shorter than 16 characters is ignored with a
warning. It needs `INVITE_ONLY=1` to be usable at all, since that is what makes the
sign-in form ask for a code. `ADMIN_UIDS` still works and is how you add further admins.

**Clear it once you're in.** Disarming is re-checked per request against the current user
count rather than recorded once, so an instance whose data directory is lost or restored
from an empty backup re-arms while the variable is still set.

### Coaches

A **coach** writes training programs and sends them to the members assigned to them, and can
see those members' training. They cannot touch invites, access requests or accounts — that is
the whole point of the role, so a gym can hand a trainer programming duties without handing
over the instance.

There is no env var: an admin grants the role in the admin dashboard (member → *Coaching* →
**Make a coach**), then assigns members to that coach on each member's page. Admins are coaches
implicitly and can reach any member. Revoking the role unassigns their members and cuts their
access immediately.

A coach builds the program in the ordinary **Plan** screen — there is no separate builder — then
*Today → Send my current plan instead*, picks members, and optionally sets their weekly schedule too.
Members are **asked before anything changes**: the program shows up as a card on Home with the
coach's name and note, and accepting adds the routines as **new** ones. Nothing they already had
is modified, renamed or removed, and declining leaves their plan untouched.

Members are told who their coach is in Settings. Someone reading your training history should
never be invisible to you.
Hosting and pipeline specifics: **[docs/DEPLOY_NAMECHEAP.md](docs/DEPLOY_NAMECHEAP.md)**;
generic self-hosting (HTTPS, passkeys): **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

---

Everything below is the upstream **openGym** documentation — it all still applies to this
deployment. FIT'ONE is built on openGym and keeps its source attribution.

## Why

Most workout apps lock your data behind a login on their servers, nag you to upgrade, or
disappear when the startup does. openGym is the opposite: **it runs on your box, your data
stays in a folder you control, and it's yours to fork.** It still feels modern — installable
as a home-screen app, passkey sign-in, offline support, sync across your phone and laptop.

## Features

- ⚖️ **Body-weight tracking** — interactive chart with a goal line you set, gains/losses colored by whether they move toward it
- 🏋️ **Weekly plan** — a routine per weekday, over a library of **1,324 exercises** (searchable, with animated demos), browsable **by muscle** on a body map
- ✨ **Four starter plans** — Push/Pull/Legs, Upper/Lower, Full Body, 5×5; loaded as ordinary routines you can edit, and a routine can be copied in one tap
- 🗓️ **Reschedule any day** — sick, missed a session, or fewer gym days this week? Move a workout to another day without touching your weekly plan
- 📅 **Your week starts where you say** — Monday or Sunday, in Settings. The weekly plan, the day strip on Home, the calendar and every "this week" total follow it, so the app reads the way the calendar on your wall does
- 🧭 **A workout screen that gets out of the way** — one ⋯ menu per exercise (note, details, progression, bar weight, warm-up, superset, swap, move, remove), the set number as the set's own menu (drop set, rest-pause burst, remove), and a scrollable **list view** of the whole session with the header pinned. Four switches under Settings → Workout controls bring any of the old button rows back
- 🌈 **Colour-coded RIR / RPE** — one tap logs how hard a set was, with a sentence per level ("one more rep in the tank"); the same colour whether you think in RIR or RPE, a free field for in-between values
- 📖 **History without leaving the workout** — the exercise's last sessions and a progress line, from the ⋯ menu or the exercise details
- ⭐ **Favourite exercises** — star what you use, it sorts first in the picker and the library
- ▶️ **Guided workouts** — it knows what day it is and starts today's session; asks your body weight first, pre-fills your weights from last time, rest timer, PR detection, per-exercise weight tracking. On a rest day it doesn't just say "rest day" — it names when your next session is and what it is
- 🙈 **Animations are your call** — the exercise demos can be full size, small, or hidden entirely during a workout. Hidden collapses the media rather than leaving a gap, for anyone who finds a looping GIF between sets more distracting than useful
- ☀️ **The screen stays awake while you train** — no unlocking the phone and finding your place again between every set. On for as long as a workout is running, released the moment you finish it, and switchable off in Settings
- 🔗 **Supersets** — plan them into a routine or pair two exercises *mid-session* with “make superset with previous/next”, then work through the group back-to-back with a single rest at the end of each round. Unpair at any time; a group of one dissolves itself
- 🔥 **Warm-up sets** — mark the ramp-up rows as warm-ups and they stay out of the numbers that should not see them: no effect on your estimated 1RM, your progression, or the fatigue map, while still being there in the session where you need them. A weight change cascades down the rows that share their phase, not across the divide
- ➖ **Change your mind mid-session** — add an exercise you decided to do, or remove one you didn't, without ending the workout. Removing a member of a superset asks which one
- ⏱️ **Timed exercises** — planks, hangs, wall sits and loaded carries are logged by time, not reps, with a work timer that counts the set itself (separate from the rest timer) and logs the time you actually held. They can carry weight too
- ⏲️ **Rest per exercise** — heavy triples and curls don't want the same break: give any exercise its own rest time and it overrides the global timer for that exercise (a superset rests once, taking the longest). Travels with shared plans
- 🧘 **Planned deloads** — flag a routine as excluded from automatic progression: its sessions open with the routine's own target weights, stay in your history and statistics, and never become the baseline your next regular session progresses from
- 📈 **Progression that follows a rule** — pick one per routine, override it per exercise: linear, **Greyskull LP** (AMRAP top set, double jumps, 10 % resets), double progression through a **visible rep range** (both bounds editable, per-side exercises step in twos), or adding time. Your weights are already right when the session opens, and every target says *why* it's that number. Missed reps never advance the load, stalls trigger a deload, and bodyweight exercises progress in reps instead
- 💪 **Estimated 1RM** — per exercise, from your best eligible set (it names which one), with its own progress curve and a calculator for sets you haven't done. Won't guess above 12 reps
- 🎯 **Effort per set, in your scale** — an optional third column rating how hard a set was, as **RIR** (reps left in the tank) or **RPE** (the same judgement on a 10-point scale). Off by default; each set keeps the scale it was logged with, and nothing else reads the value — your progression and 1RM are unaffected
- 💪 **Bodyweight exercises, logged as bodyweight** — push-ups, pull-ups, dips and 300-odd others arrive knowing they carry no load, so there's no weight column and no working-weight prompt: one stepper, log the reps. Add a dip belt and it reads as an addition, and progression goes back to following the weight. Without one, reps climb — and past a ceiling you set, a set is added instead of a rep, up to the point where the honest advice is load or a harder variation
- ↔️ **Reps per side** — for lunges, single-arm rows and the rest. You log the total, the app shows the split ("8 per side"), and the target steps in twos so it never lands on a number one side can't have
- 🏋️ **Plate math for barbell work** — barbell, EZ, trap bar and Smith machine carry a bar weight (20 kg / 45 lb and friends, or your own per exercise), and the workout screen tells you what goes on each side: *Bar 20 kg · 30 kg per side*. You still log the total, so your history, progression and 1RM keep meaning exactly what they always did
- 📝 **Log a past workout** — forgot your phone, trained on paper, or switched apps? Add a session after the fact from History: date, start time, duration, routine or freestyle, then the normal workout screen — weights, reps, RIR/RPE, timed sets and all. If that day already has a workout you choose: replace it, keep both, or cancel. Backfilled sessions never claim PRs against workouts that came later
- 🎲 **Freestyle sessions** — train without a plan and pick exercises as you go. Each one arrives prefilled from the last time you did it — same sets, same reps and weight by position — so an unplanned session doesn't start by asking you to retype last week
- 🏃 **Cardio** — log time + speed, not just weight × reps
- 📤 **Share a plan** — send someone your routines and week schedule as a small file (no workouts, no weigh-ins), or print it as a clean PDF. Importing merges, so their plan is never overwritten
- 🔧 **Filter by equipment** — narrow the library to what you actually own; the options adapt to what you've picked, so every combination on screen has results behind it
- ✨ **Your own exercises** — a name and a body part is enough; they behave like built-in ones everywhere, with an optional description instead of an animation
- 🟩 **Activity heatmap** — a GitHub-style year view, shaded by time spent training
- 💪 **Muscle map, three ways** — a front-and-back body diagram you can read as **Balance** (where the volume went, over a week, a month or all time — naming the muscles you *haven't* trained), **Fatigue** (what is still recovering, weighted by how close each set was to your maximum, decaying smoothly rather than expiring at a window edge) or **Strength** (how long since you trained each muscle, and behind every one the exercises that built it with their estimated 1RM). It previews what a routine hits while you build it, and shows what you just trained when you finish. Male or female figure, your pick
- 📳 **See the timer end, not just hear it** — an opt-in screen flash when a rest or work timer finishes, for loud gyms and headphones
- 🔔 **Push notifications** — rest-timer alerts even with the app closed, plus an optional reminder on days you have a workout planned but haven't logged one — on the Android app scheduled per calendar date, so a day you already trained or rescheduled stays quiet. Opt in per profile; keys are generated on first run, nothing to configure
- 🔑 **Passkeys, not passwords** — Face ID / Touch ID / fingerprint login; each profile keeps its own data, synced across devices. Sign-ins last 90 days by default (configurable), and “sign out everywhere” in Settings ends every session on every device at once
- 🛠️ **Admin dashboard** (optional) — for whoever runs the instance: who's training right now, per-user history, disable accounts, and invite-only signup. Off by default, so a fresh instance stays open with no admin
- 🏋️ **Coaches** (optional) — a trainer who programs for assigned members and sees their training, without any of the admin powers. Programs are offered, not imposed: the member accepts, and their own routines are never changed
- 🎨 **Designed, not assembled** — light/dark themes and 8 accent colors saved to your profile, over a hand-drawn icon set instead of emoji, so it looks the same on every phone
- 🌍 **14 languages** — full UI translation (EN, DE, ES, FR, IT, PT (Portugal), PT (Brazil), PL, TR, RU, ZH, KO, HI, TH, HU); exercise instructions localized in 12 of them and built-in exercise names shown bilingually in PT-BR and HU, all loaded on demand so the app stays fast
- 📥 **Bring your history with you** — import from **FitNotes** (Android and iOS), **Strong** and **Hevy** (CSV or directly with a [Hevy Pro API key](https://hevy.com/settings?developer)), or body weight straight out of an **Apple Health** export. Exercise names are matched against the library and anything unrecognised becomes one of your own exercises, so nothing in the file is dropped
- 📦 **Yours to keep** — one-tap JSON export/import, guest mode, **no telemetry**; switching kg ↔ lb offers to convert every stored number
- 🤖 **Ask an AI about your training** (optional) — an [MCP server](mcp/README.md) lets a client like Claude Desktop or Cursor read your history in your own words: *"what did I bench last week?"*. Read-only, spawned locally by the client, nothing leaves your box — if you don't use an AI assistant, it never runs
- 📱 **Standalone Android app** — the whole tracker as a sideloadable APK: no account, no server, data on the phone, native workout reminders, and an **in-app update check** that downloads the next signed APK and verifies its checksum ([download](https://opengym.duarte-santos.ch))

## Quick start (self-host)

You need PHP 8.4 or newer with Composer for the API, and Node 22 or newer to build the app.
(This fork's API is a Laravel backend; upstream openGym's is a Node server.)

```bash
./scripts/fetch-media.sh                     # exercise media (~140 MB), once

cd backend  && cp .env.example .env          # set SESSION_SECRET to 64 hex characters
composer install && php artisan key:generate && php artisan migrate
php artisan serve &                          # the API, on :8000
cd ../frontend && npm install && npm run dev # the app, on :5173
```

Open **http://localhost:5173**, tap **Create profile**, and you're in.

> **About that media:** it reaches openGym through
> [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset), which
> redistributes [ExerciseDB v1](https://exercisedb.dev/) — its metadata and instruction text are
> MIT, but the images and animations are third-party content under *neither* that MIT license nor
> openGym's project terms, and their ownership is currently disputed between Gym visual and ExerciseDB.
> openGym ships none of it: your instance downloads it from upstream. Reusing it yourself,
> commercially or not, means clearing it with the rights holder — see [NOTICE.md](NOTICE.md).
> Want it reachable from your phone over the internet with passkeys? You'll need an HTTPS
> domain — a two-line change in `backend/.env`. See **[docs/SELF_HOSTING.md](docs/SELF_HOSTING.md)**.

## Mobile app (no server at all)

The same codebase also builds a **standalone mobile app** (Capacitor): no account, no sync,
no backend — everything stays on the phone, with native workout-day reminders and share-sheet
backups. Self-hosting gets you multi-device sync and profiles for friends & family; the
mobile app is the install-and-done flavor.

- **Android:** [**download the APK**](https://opengym.duarte-santos.ch) — or straight from
  [GitLab's package registry](https://gitlab.com/DuarteSantos8/opengym/-/packages), where every
  build sits next to its `.sha256` — and sideload it; openGym is deliberately not on the Play
  Store. Or build it yourself: **[docs/MOBILE.md](docs/MOBILE.md)**.
- **iPhone:** Apple doesn't allow installing apps outside the App Store, so there is no iOS
  download. Self-host and add it to your home screen from Safari (it's a full PWA), or build
  the native app onto your own device from Xcode — see **[docs/MOBILE.md](docs/MOBILE.md)**.

## How it works

```
┌─────────────┐        ┌──────────────────────────────┐
│  Your phone │──HTTPS─▶│  your web server             │
│  / laptop   │        │   ├─ serves frontend/dist/   │
└─────────────┘        │   └─ proxies /api ──────────┐│
                       └──────────────────────────────┘│
                                                        ▼
                                        ┌──────────────────────────┐
                                        │  backend (Laravel, PHP)  │
                                        │   ├─ database            │
                                        │   └─ DATA_DIR/media      │
                                        └──────────────────────────┘
```

- **frontend/** — React + Vite (React Router + Zustand), built with `npm run build` to static files in `dist/`
- **backend/** — Laravel (PHP 8.4+): passkeys, sync, coaching, push, an operator panel, storing accounts and training in SQLite or MySQL/MariaDB and uploaded media under `DATA_DIR/media`; one cron line runs its reminders and queue
- Whatever serves it — Apache, nginx, Caddy, LiteSpeed — hands out `dist/` and sends `/api` to Laravel, so it is all **one origin**. Passkeys require that.

The full HTTP API is documented as an OpenAPI spec in [`backend/openapi.yaml`](backend/openapi.yaml) — browsable at [opengym.duarte-santos.ch/api.html](https://opengym.duarte-santos.ch/api.html).

## Your data

Lives in `./data` on your host: `db.json` (profiles + public passkeys), `state-<user>.json`
(each user's plan, workouts, body weight, settings), `audit.log` (the admin activity log — sign-ins
and admin actions, no IP addresses unless you ask for them) and `secret` (the session-cookie key).
**Back up `./data` and you've backed up everything.** Passkey private keys never touch the
server — they stay in your phone's secure hardware / your password manager.

## Configuration

All via `.env` (see `.env.example`):

| Variable      | What it is                                           | Default                 |
|---------------|------------------------------------------------------|-------------------------|
| `RP_ID`       | Hostname passkeys are bound to                       | `localhost`             |
| `ORIGIN`      | Full URL the app is served from                      | `http://localhost:5173` |
| `PORT`        | Port the API listens on; your web server proxies `/api` to it | `3000`  |
| `RP_NAME`     | Name shown in the passkey prompt                     | `openGym`               |
| `SESSION_DAYS`| How long a sign-in lasts, in days                    | `90`                    |
| `ADMIN_UIDS`  | User ids that get the admin dashboard (comma-separated) | *(none)*             |
| `INVITE_ONLY` | Require an invite code to create a profile           | *(off)*                 |
| `BOOTSTRAP_CODE` | One-shot code that lets the **first** account in and makes it an admin; ignored under 16 chars, and inert once any user exists | *(none)* |
| `REQUEST_ACCESS` | Let visitors without a code request one from the sign-in screen (FIT'ONE) | *(off)* |
| `ALLOW_GUEST` | Offer "Continue without account" — set `0` to require a profile | *(on)*       |
| `AUDIT_LOG`   | Record sign-ins and admin actions — set `0` to record nothing | *(on)*        |
| `AUDIT_MAX`   | Events kept in the activity log; `0` for no limit    | `5000`                  |
| `AUDIT_DAYS`  | Days kept in the activity log; `0` to keep until `AUDIT_MAX` | `90`            |
| `AUDIT_IP`    | Record the caller's address: `off`, `net` (network only) or `full` | `off`     |
| `VAPID_SUBJECT` | Contact URL sent with push notifications           | your `ORIGIN`           |

Push notification keys are generated on first run and saved to `./data/vapid.json` — nothing to set.
`DATA_DIR` defaults to `data/` at the repo root, whatever directory you started the API from.
Point it wherever you back up.

## Roadmap

The plan lives in [ROADMAP.md](ROADMAP.md) and on the
[GitLab milestones](https://gitlab.com/DuarteSantos8/opengym/-/milestones): v1.3.5 programmes and
progression (explicit warm-up/work phases, AMRAP driver selection, multi-week programmes, adaptive
1RM), v1.3.6 accounts and sync (password and OIDC login, personal-trainer role, remote MCP), v1.3.7
mobile (timer in the notification bar, widgets, Withings). Ideas and merge requests welcome — the
[board](https://gitlab.com/DuarteSantos8/opengym/-/boards) shows what is planned, in progress and
waiting for a test on the staging instance.

## Tech

React 19 + Vite (React Router, Zustand) · Laravel (PHP) · WebAuthn · exercise data from
[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)
(MIT metadata and instructions; media © Gym visual — see [NOTICE.md](NOTICE.md)).
No cloud dependencies and no container runtime: the API is a PHP app with one cron line and the
frontend is a folder of static files, which is all the shared hosting this deploys to allows.

The training logic — progression rules, 1RM estimation, how a logged session is read back —
lives in pure functions under `frontend/src/lib/` with tests next to them: `npm test` in
`frontend/`. Vitest is a dev dependency; the app itself ships no runtime dependencies beyond
React, the router and Zustand.


The same pure helpers power an optional MCP server (`mcp/`) that lets an LLM client like
Claude Desktop read your data over stdio — see [mcp/README.md](mcp/README.md). Opt-in, not
part of a deploy.

## Community

- **[Discord](https://discord.gg/e62jY6fwVb)** — release announcements, self-hosting help and
  the back-and-forth that would be a slow issue thread. Quickest way to get an answer.
- **[Issues](https://gitlab.com/DuarteSantos8/opengym/-/issues)** — bugs, questions, self-hosting
  help and ideas. There are no Discussions here, so it all lives in one tracker: label a question
  `question` and an idea `idea`, and it gets treated as one rather than as agreed-on work. Use
  an issue over the Discord for anything the next person should be able to find by searching.
- **Login trouble?** Most of it is an `RP_ID`/`ORIGIN` mismatch — check
  [docs/SELF_HOSTING.md](docs/SELF_HOSTING.md) before opening an issue.
- **Merge requests** — [open one on GitLab](https://gitlab.com/DuarteSantos8/opengym/-/merge_requests); see
  [CONTRIBUTING.md](CONTRIBUTING.md).

> **On the GitHub repo:** `github.com/DuarteSantos8/openGym` is offline because the account was
> suspended. **GitLab is the home of the project** — same history, same tags, same releases, and
> the CI that builds the images and the APK runs there. (gitea.com/DuarteSantos/openGym was the
> first stopgap and is now only a mirror.) Old GitHub issue and PR numbers in
> [CHANGELOG.md](CHANGELOG.md) are kept as plain references; they don't map onto GitLab's
> numbering.

## Contributing

Issues and PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Good first issues: more starter
plans, exercise-data languages, import from other trackers. **A ⭐ helps more people find it.**

openGym is free and stays free: no subscription, no paid tier, nothing held back for sponsors.
If it replaced a paid tracker for you and you want to chip in, there's a coffee button
below (and a badge at the top) — a star, a bug report or a merge request is worth just as much.

<!-- GitLab has no Sponsor button the way GitHub's FUNDING.yml gave one, so the link has to
     stand on its own here. .github/FUNDING.yml stays put for the day that account returns. -->

<a href="https://buymeacoffee.com/duartesantos" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
       alt="Buy Me A Coffee"
       style="height: 60px !important;width: 217px !important;">
</a>

## Third-party content

**Third-party content is not, and openGym cannot sublicense it.** The exercise metadata and
instruction text originate from [ExerciseDB v1](https://exercisedb.dev/) and reach openGym through
[hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) under the
**MIT** license. The exercise images and animations are third-party content covered by neither
that license, and their ownership is **currently unresolved** — the upstream dataset
attributes them to [Gym visual](https://gymvisual.com/) under a non-transferable permission, while
[ExerciseDB/AscendAPI](https://exercisedb.io/faq) claims to be their creator and owner. A
clarification has been requested. openGym does not redistribute them (your instance fetches them
at first run) and does not relicense them. To reuse that media yourself, clear it with the rights
holder first.

Full third-party notices, including the body-diagram geometry: **[NOTICE.md](NOTICE.md)**.
