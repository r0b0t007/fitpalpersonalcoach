# Coach referrals (CHW-350)

**Status:** design approved 2026-11-07. Builds the second growth loop of
`docs/growth/2026-11-funnel-and-promotion.md` §2.

## What it does

A coach shares a link. A coach who signs up through it, and gets a client training, earns the
referrer **one free month**, banked. The referrer sees the balance in Plan & billing. The owner
applies it by hand when the coach pays.

## Decisions (owner, 2026-11-07)

| Question | Decision |
|---|---|
| What a credit gives today | **Banked.** Billing is off and every coach is on Free, so a credit is a month counted in Plan & billing, used when they pay. Granted (manual) licences keep having no end date. |
| What counts as activation | **A join-request client's first workout.** A client who came through the referred coach's public page (a join request the coach accepted) logs a workout after being accepted. That client's email differs from both coaches' emails. |
| How activation is detected | **An hourly check** (`fitpal:referral-credits`), the pattern of the digest and the prune. A credit lands within the hour. |

**Consequence:** join requests are off in production until the CNDP answers (CHW-367). Links and
sign-ups work before then, but no referral can activate until join requests are switched on.

## Out of scope

- **Affiliates** (20% recurring for 10k+ accounts): a separate issue, after checking whether
  Creem's affiliate features can do it.
- **A reward for the referred coach.**
- **Applying a credit automatically** at checkout: decided with CHW-302, when billing goes live.
- **The passkey sign-up path** (`AuthController::coachOptions`): the app no longer calls it for
  coaches (Start.jsx uses the email code since CHW-368), so it takes no `ref`.

## 1. The link

**The coach's link** is `https://fitpal.ma/?ref=<handle>`, where the handle is their public page's
(`coach_pages.handle`). A coach with no page has no link yet.

**fitpal.ma carries it in the URL only, never in storage.** `site-coach/site.js`, loaded by the
three landings (`index.html`, `en/index.html`, `es/index.html`), reads `ref` from the page's own
query string and validates it with the handle pattern (`/^[a-z0-9._]{3,30}$/`). If it is valid,
`site.js` appends it to:
- every `https://coach.fitpal.ma/#/start?…` link, as `&ref=<handle>` inside the hash route;
- the links between the three landings (the language switchers), so the ref survives a language
  change.

Nothing is written to cookies, localStorage or sessionStorage, so there is no consent question for
the visitor. The SEO pages load no script, so referral links point at the home page. A link
straight to `coach.fitpal.ma/#/start?plan=free&ref=<handle>` works too.

**The app:** `Start.jsx` reads `ref` beside `plan` and `period`, and sends it with
`coachSignupStart` (`lib/api.js`) as `ref`.

## 2. Storing the referrer

**Migration:**
- `coach_signups.ref`: string 30, nullable.
- `users.referred_by`: string 16, nullable and indexed, the referrer's user id. No foreign key: a
  coach's account can't be deleted in the app (`DeleteAccount` refuses coaches), and the code
  ignores a referrer it can't find.

**`CoachSignupController::start`** reads `ref` with `Input::jsString`, normalises it with
`Handle::normalise`, and keeps it only if `Handle::valid`. Otherwise it stores null. It stores the
ref and never refuses because of it.

**`CoachSignupController::verify`**, inside the transaction that makes the user, resolves the ref
with `CoachPage::findPublic`. It sets `referred_by` only when all of these hold:
- the page's coach exists and is enabled (`findPublic` returns a coach);
- that coach is not the new user (a new user can't own a page yet, but the check stays);
- the coach's email, lower-cased, differs from the new coach's email.

Otherwise `referred_by` stays null, quietly. An audit event `coach.referral.signup` records a set
`referred_by`: user is the new coach, target is the referrer, and there is no msg.

## 3. Banking credits

**Table `referral_credits`:**

| column | type | note |
|---|---|---|
| `id` | string 32 | like the licence ids |
| `referrer_id` | string 16, FK users, cascade on delete | who earns the month |
| `referred_id` | string 16, FK users, cascade on delete, **unique** | one credit per referred coach, ever |
| `months` | tinyint, default 1 | |
| `created` | bigint ms | |
| `used_at` | bigint ms, nullable | set by the owner |
| `used_note` | string 120, nullable | e.g. "applied to the first Solo invoice" |

**Command `fitpal:referral-credits`,** scheduled `hourly()` with `withoutOverlapping(10)` and
`runInBackground()`, like `fitpal:coach-digest`. It works in one pass:
1. Select referred coaches (`users.referred_by` not null, coach, not disabled) with no
   `referral_credits` row.
2. For each one, look for an activating client. That is a `join_requests` row for that coach with
   `status = 'accepted'` (its client is `member_id`, its acceptance time `decided`, in ms) whose
   client:
   - is still on the coach's roster (`users.coach_id` = the coach);
   - has trained since the acceptance: `user_states.first_workout_at >= decided` (a new account),
     or `user_states.last_workout` (YYYY-MM-DD) is a later day than `decided`'s UTC date (an
     account that had trained before it joined);
   - has a request email (`join_requests.email`), lower-cased, different from both the referred
     coach's and the referrer's.
3. If one exists and the referrer is still an enabled coach, insert the credit. The unique index
   makes a second run or a race insert nothing: catch the duplicate and skip it. Record the audit
   event `coach.referral.credit` (user is the referrer, target is the referred coach).
4. A referrer who is disabled gets nothing for now. The referred coach stays without a credit
   row, so the next run checks them again, and the credit lands if the referrer is enabled again.
   A referrer who no longer exists is skipped the same way.

It handles at most 500 referred coaches a run, so a run stays well under the host's 50 s.

## 4. What coaches see

**Account, a new card « Parraine un coach »** (`views/coach/ReferralCard.jsx`, under Plan &
billing):
- **No public page:** « Publiez votre page pour avoir votre lien de parrainage. » with a link to
  the page editor.
- **With a page:** the link `fitpal.ma/?ref=<handle>`, with Copy and Share (`navigator.share` when
  there is one), and one line: « Un mois offert pour chaque coach inscrit par votre lien dont un
  client fait sa première séance. »
- **Counts:** « {0} inscrits · {1} actifs », as counts only, with no names. Signed up is the
  coaches with `referred_by` = them; active is their credit rows.
- Changing the handle changes the link, and old links stop crediting. The card always shows the
  current link.

**Plan & billing** (`PlanBillingSection`): one row « Mois offerts », with the unused months, shown
only when there is at least one.

**API:** `GET /api/coach/referrals` returns `{ handle, signedUp, activated, monthsUnused }` for the
signed-in coach only. `monthsUnused` is the sum of `months` where `used_at` is null.

## 5. Using a credit (owner)

**Filament,** on the coach's user page: a "Referral months" panel listing their credits (referred
coach, date, used or not), with a **Mark used** action that asks for a note. It sets
`used_at`/`used_note` and records audit `admin.referral.use` (user is the admin, target is the
referrer, msg is the note truncated to 120).

**No licence change.** The owner applies the month however the coach pays, by hand, until CHW-302
decides how checkout uses it.

## 6. Privacy

- **The legal notice** (`mentions-legales.html` and `es/legal.html`, `en/legal.html`) gets one line
  under the coach's data: if you signed up through another coach's link, we record which coach
  referred you, to credit them. They see how many coaches they referred, never who.
- **Retention:** coach accounts are not deleted in the app today. If one ever is, its credit rows
  go with it (the foreign keys on `referral_credits`). The audit events age out with the audit
  log.
- The change goes through the lawve-ai/awesome-legal-skills review, labelled "not legal advice".

## 7. Errors and edge cases

- **Unknown, malformed or reserved handle:** ignored. The sign-up succeeds without a referrer.
- **The referrer renames their page between the click and the sign-up:** the old handle resolves
  to nothing, so there is no referrer. This is accepted.
- **A coach account removed by hand** (outside the app): the cascade removes its credit rows,
  used ones included. The audit log keeps the history.
- **Two accounts, one person:** the email checks stop the plain cases (same email for both
  coaches, or a client sharing a coach's email). Anything subtler needs a real person training,
  which is the point. The owner can see every credit in Filament before using it.

## 8. Tests

**Pest:**
- Sign-up with a valid ref stores `referred_by`. Unknown, malformed or reserved refs leave it null.
  A referrer with the same email leaves it null. A disabled referrer leaves it null.
- The command:
  - credits a join-request client's workout after acceptance, for a new account and for one that
    trained before it joined (a later day);
  - doesn't credit a workout before acceptance, one on the acceptance day by an account that had
    trained before, a client added by invite, a client who left, or a
    client sharing an email with a coach;
  - doesn't credit when the referrer is disabled;
  - a second run inserts nothing.
- `GET /api/coach/referrals` counts only the caller's own referrals; another coach's are never in
  it.
- The Filament Mark used action sets the fields and records the audit event.
- The schedule: the command is registered hourly, on the 5-minute grid (`CHW-311`'s test).

**Vitest:**
- `Start.jsx` sends `ref`.
- `ReferralCard` without a page, with a page, and with its counts.
- The Plan & billing row shows only when there are months.
- `site.js` rewrites the start links and the language switchers for a valid ref, and leaves them
  alone for an invalid one. A small test with happy-dom loading the file.

**Guards:**
- labels for `coach.referral.signup`, `coach.referral.credit` and `admin.referral.use` in
  `lib/audit.js`, with the floors in `check-audit-labels.mjs` raised;
- every new string in the fr/es/de packs;
- the html-validate and asset checks of `deploy-site-coach.yml` on the `site.js` change (bump
  `site.js?v=`).

## Done when

A coach who signed up through another coach's link, and whose join-request client logs a workout,
gives that referrer a month that shows in Plan & billing. The owner can see it and mark it used in
the admin panel.
