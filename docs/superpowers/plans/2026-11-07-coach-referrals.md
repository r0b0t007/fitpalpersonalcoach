# Coach referrals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A coach who signs up through another coach's link, and whose join-request client logs a workout, banks that referrer one free month, visible in Plan & billing and usable from the admin panel (CHW-350).

**Architecture:** The ref travels in URLs only: fitpal.ma's `site.js`, then `#/start?ref=`, then the sign-up request. At code verification the backend resolves it to `users.referred_by`. An hourly command, `fitpal:referral-credits`, banks credits in a new `referral_credits` table. All the domain logic lives in one class, `App\Coaching\Referrals`, so the controller, the command, the API and the Filament action are thin.

**Tech Stack:**
- Backend: Laravel 13 / PHP 8.4, Pest, Filament.
- Frontend: React 19, Vitest with happy-dom.
- Site: static HTML/JS on Cloudflare Pages.

**Spec:** `docs/superpowers/specs/2026-11-07-coach-referrals-design.md`

## Global Constraints

- **Credits are banked only.** No licence is created, changed or given an end date.
- **Activation:** an accepted `join_requests` row of the referred coach whose client:
  - is still on that coach's roster;
  - trained after acceptance: `first_workout_at >= decided`, or `last_workout` is a later UTC day than `decided`;
  - has a request email different from both coaches' emails.
- **The ref:** it is never written to cookies or browser storage. It is valid only if it passes `Handle::valid` and is not `Handle::reserved`. A bad ref is ignored and never fails a sign-up.
- **Strings:** every app string goes through `t()`/`tp()`, with fr (vous), es (tú) and de (du) entries. `npm run check:i18n` and `node scripts/french-vous.mjs` must pass.
- **API errors:** every `ClientSafe` message is a key in every pack (`backend/scripts/check-error-strings.mjs`).
- **Audit:** every new `Audit::record` event gets a label in `frontend/src/lib/audit.js`. The floors in `backend/scripts/check-audit-labels.mjs` (61 today) end at 64.
- **The scheduler:** it runs every 5 minutes (CHW-311). The new command is `hourly()`. It handles at most 500 referred coaches a run.
- **No new dependencies.**
- **Commits** end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01F2HrhrFSAFLcZnvn9Hq2cK
  ```
- **Branch:** `ahmedchioua/chw-350-referrals` (it already holds the spec).

**Commands** (on Windows, Pest needs `OPENSSL_CONF=C:\xampp\php\extras\ssl\openssl.cnf` only for the push tests):
- Backend tests: `cd backend && ./vendor/bin/pest <file>`
- Style: `./vendor/bin/pint --test`
- Frontend tests: `cd frontend && npx vitest run <file>`

## File map

| File | Responsibility |
|---|---|
| `backend/database/migrations/2026_11_07_100000_add_referrals.php` | `coach_signups.ref`, `users.referred_by`, `referral_credits` |
| `backend/app/Models/ReferralCredit.php` | the credit row |
| `backend/app/Coaching/Referrals.php` | ref normalising, referrer lookup, activation, crediting, counts, mark used |
| `backend/app/Http/Controllers/CoachSignupController.php` | stores the ref; sets `referred_by` |
| `backend/app/Console/Commands/ReferralCredits.php` | the hourly command |
| `backend/routes/console.php` | schedule |
| `backend/app/Http/Controllers/CoachReferralController.php` | `GET /api/coach/referrals` |
| `backend/app/Http/Controllers/BillingController.php` | `referralMonths` in `/api/billing/me` |
| `backend/routes/api.php` | the route |
| `backend/app/Filament/Resources/Users/UserResource.php` | column and "Mark a referral month used" |
| `backend/scripts/check-audit-labels.mjs` | floors |
| `backend/tests/Feature/ReferralTest.php` | all backend tests |
| `frontend/src/lib/api.js` | `coachSignupStart(…, ref)` |
| `frontend/src/views/Start.jsx` | sends `?ref=` |
| `frontend/src/lib/share.js` | share, then clipboard (moved out of InviteSheet) |
| `frontend/src/lib/referrals.js` | `referralLink(handle)` |
| `frontend/src/views/coach/ReferralCard.jsx` | the Account card |
| `frontend/src/views/coach/billing.jsx` | the "Free months" row |
| `frontend/src/views/coach/sheets.jsx` | InviteSheet uses `shareLink` |
| `frontend/src/views/coach/CoachAccount.jsx` | mounts the card |
| `frontend/src/lib/audit.js` | 3 labels |
| `frontend/src/locales/{fr,es,de}.js` | strings |
| `site-coach/site.js` and the three landings | carry the ref |
| `site-coach/mentions-legales.html`, `es/legal.html`, `en/legal.html` | the privacy line |

---

### Task 1: Store the referrer at sign-up

**Files:**
- Create: `backend/database/migrations/2026_11_07_100000_add_referrals.php`
- Create: `backend/app/Models/ReferralCredit.php`
- Create: `backend/app/Coaching/Referrals.php`
- Modify: `backend/app/Models/CoachSignup.php` (`$fillable`)
- Modify: `backend/app/Http/Controllers/CoachSignupController.php`
- Modify: `frontend/src/lib/audit.js`, `frontend/src/locales/{fr,es,de}.js`, `backend/scripts/check-audit-labels.mjs`
- Test: `backend/tests/Feature/ReferralTest.php`

**Interfaces:**
- Produces:
  - `Referrals::normaliseRef(mixed $raw): ?string`
  - `Referrals::referrerFor(?string $ref, string $email): ?User`
  - the `ReferralCredit` model, with columns `id, referrer_id, referred_id, months, created, used_at, used_note`
  - `ReferralCredit::newId(): string`
  - `users.referred_by`
  - test helpers `referralPage(User $coach, string $handle): void` and `referredSignup(string $email, ?string $ref): User`

- [ ] **Step 1: Write the failing tests.** Create `backend/tests/Feature/ReferralTest.php`:

```php
<?php

// Coach referrals (CHW-350, docs/superpowers/specs/2026-11-07-coach-referrals-design.md): a coach
// who signs up through another coach's link, and whose join-request client trains, banks that
// referrer one free month.

use App\Coaching\Terms;
use App\Mail\SignupCodeMail;
use App\Models\CoachPage;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Tests\Support\Billing;
use Tests\Support\Coaching;

beforeEach(function () {
    config([
        'fitpal.session_secret' => str_repeat('ab', 32),
        'fitpal.self_serve_coach' => true, 'fitpal.invite_only' => true, 'fitpal.bootstrap_code' => '', 'fitpal.free_cap' => 3,
    ]);
    Billing::on();
    Mail::fake();
    $this->f = Coaching::twoCoaches();
    $this->f->a->forceFill(['email' => 'yasmine@example.com'])->save();
    referralPage($this->f->a, 'yasmine.fit');
});

function referralPage(User $coach, string $handle): void
{
    Coaching::own(new CoachPage, $coach, ['handle' => $handle, 'open' => true, 'created' => 1, 'updated' => 1]);
}

/** Signs a coach up with the emailed code, through a ref or none, and returns the new account. */
function referredSignup(string $email, ?string $ref): User
{
    test()->postJson('/api/coach/signup/start', ['name' => 'Nadia', 'email' => $email, 'lang' => 'fr', 'terms' => Terms::VERSION]
        + ($ref !== null ? ['ref' => $ref] : []))->assertOk();
    $code = Mail::sent(SignupCodeMail::class, fn (SignupCodeMail $m) => $m->hasTo($email))->last()->code;
    $id = test()->postJson('/api/coach/signup/verify', ['email' => $email, 'code' => $code])->assertOk()->json('user.id');

    return User::query()->findOrFail($id);
}

// ---------------------------------------------------------------- sign-up

it('records the coach whose link the new coach signed up through', function () {
    $nadia = referredSignup('nadia@example.com', ' @Yasmine.FIT ');
    expect($nadia->referred_by)->toBe($this->f->a->id);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.referral.signup', 'uid' => $nadia->id, 'tgt' => $this->f->a->id]);
});

it('signs up without a referrer for no ref, an unknown one, a malformed one or a reserved one', function () {
    foreach ([null, 'nobody.here', '../x', 'start'] as $i => $ref) {
        expect(referredSignup("n$i@example.com", $ref)->referred_by)->toBeNull();
    }
    $this->assertDatabaseMissing('audit_events', ['ev' => 'coach.referral.signup']);
});

it('records no referrer whose own address is the new coach\'s, nor a disabled one', function () {
    // An address in use can't reach verify (it is refused there), so the address check is the lookup's.
    expect(Referrals::referrerFor('yasmine.fit', 'YASMINE@example.com'))->toBeNull()
        ->and(Referrals::referrerFor('yasmine.fit', 'nadia@example.com')?->id)->toBe($this->f->a->id);

    $this->f->a->forceFill(['disabled' => true])->save();
    expect(referredSignup('later@example.com', 'yasmine.fit')->referred_by)->toBeNull();
});
```

Add `use App\Coaching\Referrals;` to the imports.

- [ ] **Step 2: Run them and see them fail.**

Run: `cd backend && ./vendor/bin/pest tests/Feature/ReferralTest.php`
Expected: FAIL. Class `App\Coaching\Referrals` not found, and the `referred_by` column is missing.

- [ ] **Step 3: Write the migration.** Create `backend/database/migrations/2026_11_07_100000_add_referrals.php`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Coach referrals (CHW-350). The handle a sign-up came through, until its code is verified.
        Schema::table('coach_signups', function (Blueprint $table) {
            $table->string('ref', 30)->nullable();
        });
        // Who referred a coach. No foreign key: a coach's account is never deleted in the app
        // (DeleteAccount refuses coaches), and a referrer that can't be found is skipped.
        Schema::table('users', function (Blueprint $table) {
            $table->string('referred_by', 16)->nullable();
            $table->index('referred_by');
        });
        // A month banked for a referrer, once per referred coach ever (the unique index).
        Schema::create('referral_credits', function (Blueprint $table) {
            $table->string('id', 32)->primary();
            $table->string('referrer_id', 16);
            $table->string('referred_id', 16)->unique();
            $table->unsignedTinyInteger('months')->default(1);
            $table->bigInteger('created');              // epoch ms, as the join requests keep them
            $table->bigInteger('used_at')->nullable();  // set by the owner, from the admin panel
            $table->string('used_note', 120)->nullable();
            $table->index('referrer_id');
            $table->foreign('referrer_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('referred_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('referral_credits');
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['referred_by']);
            $table->dropColumn('referred_by');
        });
        Schema::table('coach_signups', function (Blueprint $table) {
            $table->dropColumn('ref');
        });
    }
};
```

- [ ] **Step 4: Write the model.** Create `backend/app/Models/ReferralCredit.php`:

```php
<?php

namespace App\Models;

use App\Support\Js;
use Illuminate\Database\Eloquent\Model;

/**
 * A free month banked for a coach who referred another (CHW-350, App\Coaching\Referrals). Not
 * scoped to a coach context: it is read for its referrer only (Referrals::summary), and written by
 * the hourly command and the admin panel.
 */
class ReferralCredit extends Model
{
    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['id', 'referrer_id', 'referred_id', 'months', 'created', 'used_at', 'used_note'];

    protected function casts(): array
    {
        return ['months' => 'integer', 'created' => 'integer', 'used_at' => 'integer'];
    }

    /** 28 characters, base64url, like a licence's id. */
    public static function newId(): string
    {
        return 'ref_'.Js::token(18);
    }
}
```

- [ ] **Step 5: Write the domain class.** Create `backend/app/Coaching/Referrals.php` with the sign-up part. Tasks 2 to 4 add the rest.

```php
<?php

namespace App\Coaching;

use App\Models\CoachPage;
use App\Models\User;

/**
 * Coach referrals (CHW-350, docs/superpowers/specs/2026-11-07-coach-referrals-design.md). A coach
 * shares fitpal.ma/?ref=<their page's handle>, and the ref rides the URLs to the sign-up. A coach
 * who signs up through it, and whose join-request client trains, banks the referrer one month.
 * Banked only: no licence changes here. The owner applies a month when the coach pays.
 */
final class Referrals
{
    /** A ref as a link carries it, or null for one that is no public page's handle. */
    public static function normaliseRef(mixed $raw): ?string
    {
        $handle = Handle::normalise($raw);

        return Handle::valid($handle) && ! Handle::reserved($handle) ? $handle : null;
    }

    /**
     * The coach a new coach's ref names, while they coach (an enabled coach with that page), and
     * never one whose own address is the new coach's. Null otherwise: the sign-up goes ahead
     * without one.
     */
    public static function referrerFor(?string $ref, string $email): ?User
    {
        $handle = self::normaliseRef($ref);
        if ($handle === null) {
            return null;
        }
        [, $coach] = CoachPage::findPublic($handle);
        if ($coach === null || ($coach->email !== null && mb_strtolower($coach->email) === mb_strtolower($email))) {
            return null;
        }

        return $coach;
    }
}
```

- [ ] **Step 6: Store the ref and set `referred_by`.** In `backend/app/Models/CoachSignup.php`, add `'ref'` to `$fillable`:

```php
    protected $fillable = ['email', 'name', 'lang', 'terms', 'ref', 'code_hash', 'attempts', 'code_expires', 'created'];
```

In `CoachSignupController.php`, add `use App\Coaching\Referrals;`. Then, in `start()`, inside the `updateOrCreate` attributes, after `'terms' => …,`:

```php
            // The coach whose link this came through (CHW-350), checked when the code is verified.
            'ref' => Referrals::normaliseRef(Input::jsString($request, 'ref')),
```

In `verify()`, replace the user creation:

```php
                $user = new User(['id' => User::newId(), 'name' => $signup->name]);
                $user->forceFill(['coach' => true, 'self_serve' => true, 'email' => $email, 'email_verified_at' => now()]
                    + ($signup->terms === Terms::VERSION ? ['terms_version' => $signup->terms, 'terms_at' => Js::nowMs()] : []))->save();
```

with:

```php
                $user = new User(['id' => User::newId(), 'name' => $signup->name]);
                $user->forceFill(['coach' => true, 'self_serve' => true, 'email' => $email, 'email_verified_at' => now(),
                    // Who referred them (CHW-350): only a coach still coaching, never their own address.
                    'referred_by' => Referrals::referrerFor($signup->ref, $email)?->id]
                    + ($signup->terms === Terms::VERSION ? ['terms_version' => $signup->terms, 'terms_at' => Js::nowMs()] : []))->save();
```

After the `coach.terms.accept` audit block, before the `return`:

```php
        if ($user->referred_by !== null) {
            Audit::record($request, 'coach.referral.signup', ['user' => $user, 'target' => User::query()->find($user->referred_by)]);
        }
```

- [ ] **Step 7: Run the tests and see them pass.**

Run: `./vendor/bin/pest tests/Feature/ReferralTest.php tests/Feature/CoachSignupCodeTest.php`
Expected: PASS. The existing sign-up tests are unchanged.

- [ ] **Step 8: The audit label.** In `frontend/src/lib/audit.js`, next to `'coach.page.save'`:

```js
  'coach.referral.signup': () => t('Signed up through a referral link'),
```

Add the key to each pack, next to `'Saved their public page'`:
- fr.js: `'Signed up through a referral link': 'S’est inscrit par un lien de parrainage',`
- es.js: `'Signed up through a referral link': 'Se registró con un enlace de recomendación',`
- de.js: `'Signed up through a referral link': 'Hat sich über einen Empfehlungslink angemeldet',`

In `backend/scripts/check-audit-labels.mjs`, set `const EVENT_FLOOR = 62` and `const LABEL_FLOOR = 62`.

Run: `node backend/scripts/check-audit-labels.mjs && (cd frontend && npm run check:i18n)`
Expected: `OK    62 audit events, all labelled`, then the packs in sync.

- [ ] **Step 9: Style and commit.**

```bash
cd backend && ./vendor/bin/pint && ./vendor/bin/pint --test && cd ..
git add backend/database/migrations/2026_11_07_100000_add_referrals.php backend/app/Models/ReferralCredit.php backend/app/Models/CoachSignup.php backend/app/Coaching/Referrals.php backend/app/Http/Controllers/CoachSignupController.php backend/tests/Feature/ReferralTest.php backend/scripts/check-audit-labels.mjs frontend/src/lib/audit.js frontend/src/locales
git commit -m "Referrals: record who referred a coach at sign-up (CHW-350)"
```

---

### Task 2: Bank credits hourly

**Files:**
- Modify: `backend/app/Coaching/Referrals.php`
- Create: `backend/app/Console/Commands/ReferralCredits.php`
- Modify: `backend/routes/console.php`
- Modify: `frontend/src/lib/audit.js`, the packs, `backend/scripts/check-audit-labels.mjs`
- Test: `backend/tests/Feature/ReferralTest.php`

**Interfaces:**
- Consumes: `ReferralCredit`, `users.referred_by` (Task 1).
- Produces:
  - `Referrals::BATCH = 500`
  - `Referrals::activated(User $coach, User $referrer): bool`
  - `Referrals::creditDue(Request $request): int` (the number of credits inserted)
  - the command `fitpal:referral-credits`
  - the test helper `acceptedClient(...)`

- [ ] **Step 1: Write the failing tests.** Append to `ReferralTest.php`, and add `use Illuminate\Console\Scheduling\Schedule;`, `use Illuminate\Support\Facades\DB;` and `use App\Models\ReferralCredit;` to the imports:

```php
// ---------------------------------------------------------------- crediting

const REF_ACCEPTED = 1_762_473_600_000;   // 2025-11-07 00:00 UTC

/**
 * A client accepted from $coach's page at REF_ACCEPTED, who asked with $email, with their state's
 * workout columns as given. The account itself has no address: users.email is unique, and the
 * cases test a request's address that equals a coach's.
 */
function acceptedClient(User $coach, string $email, ?int $firstWorkoutAt, ?string $lastWorkout, bool $onRoster = true): User
{
    $m = tap((new User)->forceFill(['id' => User::newId(), 'name' => 'Client', 'coach_id' => $onRoster ? $coach->id : null]))->save();
    DB::table('join_requests')->insert(['id' => substr(md5($email), 0, 24), 'coach_id' => $coach->id, 'email' => $email, 'member_id' => $m->id,
        'name' => 'Client', 'intake' => '{}', 'status' => 'accepted', 'attempts' => 0, 'created' => REF_ACCEPTED - 60_000, 'decided' => REF_ACCEPTED]);
    // Straight to the table: UserState's saving hook would derive the workout columns from the state.
    DB::table('user_states')->insert(['user_id' => $m->id, 'state' => '{}', 'ts' => 1, 'first_workout_at' => $firstWorkoutAt, 'last_workout' => $lastWorkout]);

    return $m;
}

function creditRun(): void
{
    test()->artisan('fitpal:referral-credits')->assertSuccessful();
}

it('banks a month once a join-request client of the referred coach trains after being accepted', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(0);   // no client yet

    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 3_600_000, '2025-11-07');
    creditRun();
    $credit = ReferralCredit::query()->sole();
    expect($credit->only(['referrer_id', 'referred_id', 'months', 'used_at']))
        ->toBe(['referrer_id' => $this->f->a->id, 'referred_id' => $nadia->id, 'months' => 1, 'used_at' => null]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.referral.credit', 'uid' => $this->f->a->id, 'tgt' => $nadia->id]);

    creditRun();   // a second run banks nothing more
    expect(ReferralCredit::query()->count())->toBe(1);
});

it('counts a client who trained before joining only from a later day than the acceptance', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'old@example.com', REF_ACCEPTED - 86_400_000, '2025-11-07');   // same day as the acceptance
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(0);

    DB::table('user_states')->update(['last_workout' => '2025-11-08']);
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(1);
});

it('banks nothing for a client who never trained, who left, or who shares a coach\'s address', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'idle@example.com', null, null);
    acceptedClient($nadia, 'gone@example.com', REF_ACCEPTED + 1, '2025-11-08', onRoster: false);
    acceptedClient($nadia, 'YASMINE@example.com', REF_ACCEPTED + 1, '2025-11-08');
    acceptedClient($nadia, 'nadia@example.com', REF_ACCEPTED + 1, '2025-11-08');
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(0);
});

it('banks nothing for a client added by invite, with no join request', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    $m = tap((new User)->forceFill(['id' => User::newId(), 'name' => 'Invited', 'email' => 'inv@example.com', 'coach_id' => $nadia->id]))->save();
    DB::table('user_states')->insert(['user_id' => $m->id, 'state' => '{}', 'ts' => 1, 'first_workout_at' => REF_ACCEPTED, 'last_workout' => '2025-11-08']);
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(0);
});

it('waits while the referrer is disabled, and banks once they are back', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 1, '2025-11-08');
    $this->f->a->forceFill(['disabled' => true])->save();
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(0);

    $this->f->a->forceFill(['disabled' => false])->save();
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(1);
});

it('runs hourly in the background', function () {
    $e = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'fitpal:referral-credits'));
    expect($e->expression)->toBe('0 * * * *')->and($e->runInBackground)->toBeTrue()->and($e->withoutOverlapping)->toBeTrue();
});
```

- [ ] **Step 2: Run them and see them fail.**

Run: `./vendor/bin/pest tests/Feature/ReferralTest.php`
Expected: FAIL with `The command "fitpal:referral-credits" does not exist.`

- [ ] **Step 3: Add activation and crediting to `Referrals`.** Add to the imports:

```php
use App\Audit\Audit;
use App\Models\ReferralCredit;
use App\Support\Js;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
```

Add to the class:

```php
    /** Referred coaches looked at per run: one run stays well inside the host's 50 s. */
    public const BATCH = 500;

    /**
     * Whether $coach has activated, for the referral: a client who came through their page (a
     * join request they accepted) is still on their roster and has trained since, and asked with
     * an address that is neither coach's. A new account's first workout counts from the
     * acceptance; an account that trained before it joined counts from the next UTC day.
     */
    public static function activated(User $coach, User $referrer): bool
    {
        $coachEmails = array_filter([mb_strtolower((string) $coach->email), mb_strtolower((string) $referrer->email)]);
        $rows = DB::table('join_requests as j')
            ->join('users as m', 'm.id', '=', 'j.member_id')
            ->join('user_states as s', 's.user_id', '=', 'm.id')
            ->where('j.coach_id', $coach->id)->where('j.status', 'accepted')->whereNotNull('j.decided')
            ->where('m.coach_id', $coach->id)
            ->get(['j.email', 'j.decided', 's.first_workout_at', 's.last_workout']);
        foreach ($rows as $r) {
            if (in_array(mb_strtolower(trim((string) $r->email)), $coachEmails, true)) {
                continue;
            }
            $decided = (int) $r->decided;
            if ($r->first_workout_at !== null && (int) $r->first_workout_at >= $decided) {
                return true;
            }
            if ($r->last_workout !== null && $r->last_workout > gmdate('Y-m-d', intdiv($decided, 1000))) {
                return true;
            }
        }

        return false;
    }

    /**
     * The hourly pass (fitpal:referral-credits): one month for the referrer of each referred
     * coach who has activated and has no credit yet. The unique index on referred_id makes a
     * second run, or two at once, insert nothing. Returns how many were banked.
     */
    public static function creditDue(Request $request): int
    {
        $referred = User::query()
            ->whereNotNull('referred_by')->where('coach', true)->where('disabled', false)
            ->whereNotExists(fn ($q) => $q->from('referral_credits')->whereColumn('referral_credits.referred_id', 'users.id'))
            ->orderBy('id')->limit(self::BATCH)->get();
        $banked = 0;
        foreach ($referred as $coach) {
            $referrer = User::query()->find($coach->referred_by);
            if ($referrer === null || ! $referrer->isCoach() || $referrer->disabled || ! self::activated($coach, $referrer)) {
                continue;
            }
            try {
                ReferralCredit::query()->create([
                    'id' => ReferralCredit::newId(), 'referrer_id' => $referrer->id, 'referred_id' => $coach->id,
                    'months' => 1, 'created' => Js::nowMs(),
                ]);
            } catch (UniqueConstraintViolationException) {
                continue;   // another run banked it first
            }
            Audit::record($request, 'coach.referral.credit', ['user' => $referrer, 'target' => $coach]);
            $banked++;
        }

        return $banked;
    }
```

- [ ] **Step 4: Write the command.** Create `backend/app/Console/Commands/ReferralCredits.php`:

```php
<?php

namespace App\Console\Commands;

use App\Coaching\Referrals;
use Illuminate\Console\Command;
use Illuminate\Http\Request;

/** Hourly (routes/console.php): banks the referral months that are due (CHW-350, App\Coaching\Referrals). */
final class ReferralCredits extends Command
{
    protected $signature = 'fitpal:referral-credits';

    protected $description = 'Bank a free month for each coach whose referred coach has activated';

    public function handle(): int
    {
        $n = Referrals::creditDue(Request::create('/fitpal:referral-credits'));
        $this->info("{$n} referral month(s) banked");

        return self::SUCCESS;
    }
}
```

- [ ] **Step 5: Schedule it.** In `backend/routes/console.php`, after the `fitpal:coach-digest` line:

```php

// Coach referrals (app/Console/Commands/ReferralCredits.php, CHW-350): banks a free month for each
// coach whose referred coach has activated. Hourly is soon enough for a month; in the background,
// so the reminders due that minute do not wait behind it.
Schedule::command('fitpal:referral-credits')->hourly()->withoutOverlapping(10)->runInBackground();
```

- [ ] **Step 6: Run the tests and see them pass.**

Run: `./vendor/bin/pest tests/Feature/ReferralTest.php`
Expected: PASS (9 tests).

- [ ] **Step 7: The audit label.** In `audit.js`:

```js
  'coach.referral.credit': () => t('Earned a free month for a referral'),
```

In the packs:
- fr: `'Earned a free month for a referral': 'A gagné un mois offert grâce à un parrainage',`
- es: `'Earned a free month for a referral': 'Ganó un mes gratis por una recomendación',`
- de: `'Earned a free month for a referral': 'Hat einen Gratismonat für eine Empfehlung bekommen',`

Set both floors to 63.

Run: `node backend/scripts/check-audit-labels.mjs && (cd frontend && npm run check:i18n)`
Expected: `OK    63 audit events, all labelled`.

- [ ] **Step 8: Style and commit.**

```bash
cd backend && ./vendor/bin/pint && ./vendor/bin/pint --test && cd ..
git add backend/app/Coaching/Referrals.php backend/app/Console/Commands/ReferralCredits.php backend/routes/console.php backend/tests/Feature/ReferralTest.php backend/scripts/check-audit-labels.mjs frontend/src/lib/audit.js frontend/src/locales
git commit -m "Referrals: bank a month hourly once a referred coach's client trains (CHW-350)"
```

---

### Task 3: The coach's counts, and the months in billing

**Files:**
- Modify: `backend/app/Coaching/Referrals.php`
- Create: `backend/app/Http/Controllers/CoachReferralController.php`
- Modify: `backend/routes/api.php`, `backend/app/Http/Controllers/BillingController.php`
- Test: `backend/tests/Feature/ReferralTest.php`

**Interfaces:**
- Consumes: `ReferralCredit` and `users.referred_by`.
- Produces:
  - `Referrals::summary(User $coach): array{signedUp: int, activated: int, monthsUnused: int}`
  - `Referrals::monthsUnused(User $coach): int`
  - `GET /api/coach/referrals` returns `{handle: ?string, signedUp, activated, monthsUnused}`
  - `/api/billing/me` gains `referralMonths: int`

- [ ] **Step 1: Write the failing tests.** Append to `ReferralTest.php`:

```php
// ---------------------------------------------------------------- what the coach sees

it("tells a coach their own link's counts and nobody else's", function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    referredSignup('omar@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 1, '2025-11-08');
    creditRun();

    $this->getJson('/api/coach/referrals', bearer($this->f->a))->assertOk()
        ->assertExactJson(['handle' => 'yasmine.fit', 'signedUp' => 2, 'activated' => 1, 'monthsUnused' => 1]);
    // Coach B has no page and no referrals: none of A's leak into B's answer.
    $this->getJson('/api/coach/referrals', bearer($this->f->b))->assertOk()
        ->assertExactJson(['handle' => null, 'signedUp' => 0, 'activated' => 0, 'monthsUnused' => 0]);
    expect($this->getJson('/api/billing/me', bearer($this->f->a))->assertOk()->json('referralMonths'))->toBe(1)
        ->and($this->getJson('/api/billing/me', bearer($this->f->b))->json('referralMonths'))->toBe(0);
    // A client is no coach.
    $this->getJson('/api/coach/referrals', bearer($this->f->a1))->assertStatus(403);
});
```

- [ ] **Step 2: Run it and see it fail.**

Run: `./vendor/bin/pest tests/Feature/ReferralTest.php --filter="own link"`
Expected: FAIL with a 404 on `/api/coach/referrals`.

- [ ] **Step 3: Add the counts to `Referrals`.**

```php
    /**
     * A coach's own referral counts, for their Account (GET /api/coach/referrals): coaches signed
     * up through their link, coaches who have activated, and months not used yet. Counts only:
     * never who.
     *
     * @return array{signedUp: int, activated: int, monthsUnused: int}
     */
    public static function summary(User $coach): array
    {
        return [
            'signedUp' => User::query()->where('referred_by', $coach->id)->count(),
            'activated' => ReferralCredit::query()->where('referrer_id', $coach->id)->count(),
            'monthsUnused' => self::monthsUnused($coach),
        ];
    }

    public static function monthsUnused(User $coach): int
    {
        return (int) ReferralCredit::query()->where('referrer_id', $coach->id)->whereNull('used_at')->sum('months');
    }
```

- [ ] **Step 4: The controller and route.** Create `backend/app/Http/Controllers/CoachReferralController.php`:

```php
<?php

namespace App\Http\Controllers;

use App\Coaching\Referrals;
use App\Models\CoachPage;
use App\Models\User;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * GET /api/coach/referrals → {handle, signedUp, activated, monthsUnused} (CHW-350): the Account
 * card. The handle is the coach's page's, which their link carries, or null with no page yet.
 */
final class CoachReferralController
{
    public function show(Request $request): JsonResponse
    {
        /** @var User $coach */
        $coach = $request->user('api');

        return Json::ok(['handle' => CoachPage::query()->find($coach->id)?->handle] + Referrals::summary($coach));
    }
}
```

In `backend/routes/api.php`, inside the `RequireCoach` group, after the `/coach/page/photo/remove` route:

```php
            // Coach referrals (CHW-350): the Account card's link and counts.
            Route::get('/coach/referrals', [CoachReferralController::class, 'show']);
```

Then add `use App\Http\Controllers\CoachReferralController;` with the other controller imports at the top of `api.php`.

In `BillingController::me`, add after `'portal' => …,`:

```php
            // Months banked from referrals (CHW-350), for the Plan & billing row.
            'referralMonths' => Referrals::monthsUnused($coach),
```

and add `use App\Coaching\Referrals;`.

- [ ] **Step 5: Run the tests and see them pass.**

Run: `./vendor/bin/pest tests/Feature/ReferralTest.php tests/Feature/LicenceGateTest.php`
Expected: PASS. If a billing test asserts `/api/billing/me` with `assertExactJson`, add `'referralMonths' => 0` to its expected array. Find them with `grep -rn "billing/me" backend/tests`.

- [ ] **Step 6: Style and commit.**

```bash
cd backend && ./vendor/bin/pint && ./vendor/bin/pint --test && cd ..
git add backend/app/Coaching/Referrals.php backend/app/Http/Controllers/CoachReferralController.php backend/app/Http/Controllers/BillingController.php backend/routes/api.php backend/tests
git commit -m "Referrals: a coach's counts, and the months in billing (CHW-350)"
```

---

### Task 4: Use a month from the admin panel

**Files:**
- Modify: `backend/app/Coaching/Referrals.php`
- Modify: `backend/app/Filament/Resources/Users/UserResource.php`
- Modify: the packs (the error key and the label), `frontend/src/lib/audit.js`, `backend/scripts/check-audit-labels.mjs`
- Test: `backend/tests/Feature/ReferralTest.php`

**Interfaces:**
- Consumes: `Referrals::monthsUnused` (Task 3).
- Produces:
  - `Referrals::markUsed(Request $request, User $admin, string $coachId, string $note): void`. It throws `ClientSafe(409, 'this coach has no unused referral month')`.
  - the Filament action `useReferralMonth`.

- [ ] **Step 1: Write the failing test.** Append to `ReferralTest.php`, and add `use App\Filament\Resources\Users\Pages\ListUsers;`, `use Filament\Actions\Testing\TestAction;` and `use Livewire\Livewire;` (copy these exact imports from `tests/Feature/AdminPanelTest.php`):

```php
// ---------------------------------------------------------------- the owner

it('lets the owner mark a month used, oldest first, with a note', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 1, '2025-11-08');
    creditRun();

    $this->actingAs($this->f->admin, 'web');
    Livewire::test(ListUsers::class)
        ->callAction(TestAction::make('useReferralMonth')->table($this->f->a), ['note' => 'Applied to the first Solo invoice'])
        ->assertNotified('Referral month marked used');
    $credit = ReferralCredit::query()->sole();
    expect($credit->used_at)->not->toBeNull()->and($credit->used_note)->toBe('Applied to the first Solo invoice')
        ->and(Referrals::monthsUnused($this->f->a))->toBe(0);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.referral.use', 'uid' => $this->f->admin->id, 'tgt' => $this->f->a->id]);

    // None left: refused, as the API would say it.
    expect(fn () => Referrals::markUsed(request(), $this->f->admin, $this->f->a->id, 'again'))
        ->toThrow(\App\Support\ClientSafe::class, 'this coach has no unused referral month');
});
```

Check `AdminPanelTest.php` for how it signs the admin into the panel before `Livewire::test(ListUsers::class)`. If it uses a helper or a guard other than `actingAs($admin, 'web')`, use the same.

- [ ] **Step 2: Run it and see it fail.**

Run: `./vendor/bin/pest tests/Feature/ReferralTest.php --filter="mark a month used"`
Expected: FAIL. The action `useReferralMonth` doesn't exist.

- [ ] **Step 3: Add `markUsed`.** Add `use App\Support\ClientSafe;` to the imports of `Referrals.php`, then:

```php
    /**
     * The owner used one of a coach's months (the admin panel): the oldest unused one is marked,
     * with a note of how. Banked only, so this changes no licence; the owner has applied the
     * month however the coach pays.
     */
    public static function markUsed(Request $request, User $admin, string $coachId, string $note): void
    {
        $note = Js::slice(Js::trim($note), 120);
        $credit = DB::transaction(function () use ($coachId, $note): ?ReferralCredit {
            $c = ReferralCredit::query()->where('referrer_id', $coachId)->whereNull('used_at')
                ->orderBy('created')->lockForUpdate()->first();
            $c?->forceFill(['used_at' => Js::nowMs(), 'used_note' => $note])->save();

            return $c;
        });
        if ($credit === null) {
            throw new ClientSafe(409, 'this coach has no unused referral month');
        }
        Audit::record($request, 'admin.referral.use', ['user' => $admin, 'target' => User::query()->find($coachId), 'msg' => $note]);
    }
```

- [ ] **Step 4: The panel.** In `UserResource.php`, add the imports `use App\Coaching\Referrals;` and `use Filament\Forms\Components\TextInput;`.

Add a column after the `plan` column:

```php
                // Referral months not used yet (CHW-350): the owner applies one when the coach pays.
                TextColumn::make('referralMonths')->label('Referral months')->placeholder('—')->toggleable()
                    ->state(fn (User $u) => $u->isCoach() ? (Referrals::monthsUnused($u) ?: null) : null),
```

Add an action after `grant`:

```php
                    Action::make('useReferralMonth')->label('Mark a referral month used')->icon(Heroicon::OutlinedCheckBadge)
                        ->visible(fn (User $u) => $u->isCoach() && Referrals::monthsUnused($u) > 0)
                        ->schema([TextInput::make('note')->label('How it was applied')->required()->maxLength(120)])
                        ->action(fn (User $u, array $data) => AdminAction::run(fn (Request $r, User $admin) => Referrals::markUsed($r, $admin, $u->id, (string) $data['note']), 'Referral month marked used')),
```

- [ ] **Step 5: The error key and the label.** `check-error-strings.mjs` wants the `ClientSafe` message in every pack. Add next to the other admin errors (search for `'that coach has a Creem subscription`):
- fr: `'this coach has no unused referral month': 'Ce coach n’a aucun mois de parrainage à utiliser',`
- es: `'this coach has no unused referral month': 'Este entrenador no tiene ningún mes de recomendación por usar',`
- de: `'this coach has no unused referral month': 'Dieser Coach hat keinen offenen Empfehlungsmonat',`

In `audit.js`, next to `'admin.licence.revoke'`:

```js
  'admin.referral.use': () => t('Marked a referral month used'),
```

In the packs:
- fr: `'Marked a referral month used': 'A utilisé un mois de parrainage',`
- es: `'Marked a referral month used': 'Usó un mes de recomendación',`
- de: `'Marked a referral month used': 'Hat einen Empfehlungsmonat eingelöst',`

Set both floors to 64.

- [ ] **Step 6: Run everything this touches.**

Run:

```bash
./vendor/bin/pest tests/Feature/ReferralTest.php tests/Feature/AdminPanelTest.php
cd .. && node backend/scripts/check-audit-labels.mjs && node backend/scripts/check-error-strings.mjs && (cd frontend && npm run check:i18n)
```

Expected: PASS, `OK    64 audit events, all labelled`, and the error strings and packs clean.

- [ ] **Step 7: Style and commit.**

```bash
cd backend && ./vendor/bin/pint && ./vendor/bin/pint --test && cd ..
git add backend frontend/src/lib/audit.js frontend/src/locales
git commit -m "Referrals: the owner marks a month used from the admin panel (CHW-350)"
```

---

### Task 5: Start sends the ref

**Files:**
- Modify: `frontend/src/lib/api.js:271`
- Modify: `frontend/src/views/Start.jsx`
- Test: `frontend/src/views/Start.test.jsx`

**Interfaces:**
- Produces: `coachSignupStart(name, email, lang, terms, ref)`. `ref` is optional, and is sent only when it's a non-empty string.

- [ ] **Step 1: Write the failing test.** In `frontend/src/views/Start.test.jsx`, add a mock at the top, before `const { default: Start } = await import('./Start.jsx')`, and add `vi` to the vitest import:

```js
let STARTED = null
vi.mock('../lib/api.js', async orig => ({
  ...(await orig()),
  coachSignupStart: async (...args) => { STARTED = args; return { ok: true } },
}))
```

Then add a test:

```js
const typeInto = (el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

it("sends the referral link's handle with the sign-up (CHW-350)", async () => {
  STARTED = null
  await render(FREE_ONLY, '?plan=free&ref=yasmine.fit')
  await act(async () => {
    typeInto(container.querySelector('input[autocomplete="name"]'), 'Nadia')
    typeInto(container.querySelector('input[type="email"]'), 'nadia@example.com')
    container.querySelector('#start-terms').click()
  })
  await act(async () => { [...container.querySelectorAll('button')].find(b => b.textContent.includes('Send me a code')).click() })
  expect(STARTED).toEqual(['Nadia', 'nadia@example.com', 'en', '2026-11-06', 'yasmine.fit'])
})
```

If `#start-terms` is not the checkbox itself (check `components/TermsConsent.jsx`), click the `input[type="checkbox"]` inside it.

- [ ] **Step 2: Run it and see it fail.**

Run: `cd frontend && npx vitest run src/views/Start.test.jsx`
Expected: FAIL. `STARTED` has 4 elements, with no `'yasmine.fit'`.

- [ ] **Step 3: Implement.** In `frontend/src/lib/api.js`, replace line 271:

```js
// ref: the handle of the coach whose referral link this came through (CHW-350), sent only when there is one.
export const coachSignupStart = (name, email, lang, terms, ref) => api('/api/coach/signup/start', { method: 'POST', body: JSON.stringify({ name, email, lang, terms, ...(ref ? { ref } : {}) }) })
```

In `Start.jsx`, in `send`, replace `await coachSignupStart(n, e, getLang(), config.terms_version)` with:

```js
await coachSignupStart(n, e, getLang(), config.terms_version, asked.get('ref'))
```

and add to the component's doc comment: ` * A referral link's ?ref=<handle> (CHW-350) is passed on as it came; the server checks it.`

- [ ] **Step 4: Run it and see it pass.**

Run: `npx vitest run src/views/Start.test.jsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/lib/api.js frontend/src/views/Start.jsx frontend/src/views/Start.test.jsx
git commit -m "Referrals: the sign-up sends the referral link's handle (CHW-350)"
```

---

### Task 6: The Account card and the Plan & billing row

**Files:**
- Create: `frontend/src/lib/share.js`, `frontend/src/lib/share.test.js`
- Create: `frontend/src/lib/referrals.js`
- Create: `frontend/src/views/coach/ReferralCard.jsx`, `frontend/src/views/coach/ReferralCard.test.jsx`
- Modify: `frontend/src/views/coach/sheets.jsx` (`sendLink` uses `shareLink`)
- Modify: `frontend/src/views/coach/billing.jsx` (`PlanBillingSection`)
- Modify: `frontend/src/views/coach/CoachAccount.jsx`
- Modify: `frontend/src/views/coach/billing.test.jsx`
- Modify: the packs

**Interfaces:**
- Consumes: `GET /api/coach/referrals` and `billing.referralMonths` (Task 3).
- Produces:
  - `shareLink({ url, title, text }): Promise<'shared'|'cancelled'|'copied'|'failed'>`
  - `referralLink(handle): string`
  - `<ReferralCard />`

- [ ] **Step 1: Write the failing tests.**

Create `frontend/src/lib/share.test.js`:

```js
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareLink } from './share.js'

afterEach(() => { vi.unstubAllGlobals(); delete navigator.share })

describe('shareLink', () => {
  it('shares when the phone can', async () => {
    navigator.share = vi.fn(async () => {})
    expect(await shareLink({ url: 'https://x', title: 'T' })).toBe('shared')
    expect(navigator.share).toHaveBeenCalledWith({ title: 'T', text: undefined, url: 'https://x' })
  })
  it('treats closing the share sheet as a no', async () => {
    navigator.share = vi.fn(async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }) })
    expect(await shareLink({ url: 'https://x' })).toBe('cancelled')
  })
  it('copies when it cannot share, and says so when neither works', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText } })
    expect(await shareLink({ url: 'https://x' })).toBe('copied')
    expect(writeText).toHaveBeenCalledWith('https://x')
    vi.stubGlobal('navigator', { ...navigator, share: undefined, clipboard: { writeText: () => Promise.reject(new Error('no')) } })
    expect(await shareLink({ url: 'https://x' })).toBe('failed')
  })
})
```

Create `frontend/src/views/coach/ReferralCard.test.jsx`:

```js
// @vitest-environment happy-dom
//
// The "Refer a coach" card (CHW-350): the coach's referral link and its counts, or the way to get one.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let ANSWER = null
vi.mock('../../lib/api.js', async orig => ({
  ...(await orig()),
  api: async path => { if (path === '/api/coach/referrals') return ANSWER; throw new Error('unexpected ' + path) },
}))
const { default: ReferralCard } = await import('./ReferralCard.jsx')

let container, root
const text = () => container.textContent
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
const render = async () => { await act(async () => { root.render(<MemoryRouter><ReferralCard /></MemoryRouter>) }) }

describe('the referral card', () => {
  it('asks a coach with no page to publish one first', async () => {
    ANSWER = { handle: null, signedUp: 0, activated: 0, monthsUnused: 0 }
    await render()
    expect(text()).toContain('Publish your page to get your referral link.')
    expect(text()).not.toContain('fitpal.ma/?ref=')
  })

  it("shows a coach's link and their counts, with no names", async () => {
    ANSWER = { handle: 'yasmine.fit', signedUp: 2, activated: 1, monthsUnused: 1 }
    await render()
    expect(text()).toContain('https://fitpal.ma/?ref=yasmine.fit')
    expect(text()).toContain('2 signed up · 1 active')
  })
})
```

In `frontend/src/views/coach/billing.test.jsx`, add a test with the file's own render helper. Read the file first and follow how its existing tests render `PlanBillingSection` with a `billing` prop:

```js
it('shows the free months from referrals only when there are some (CHW-350)', async () => {
  const free = { entitlement: { status: 'free', plan: 'free', cap: 3, used: 1, canWrite: true }, licence: null, plans: [{ plan: 'free', cap: 3, periods: [] }], portal: false }
  await renderSection({ ...free, referralMonths: 0 })
  expect(text()).not.toContain('Free months')
  await renderSection({ ...free, referralMonths: 2 })
  expect(text()).toContain('Free months')
  expect(text()).toContain('2')
})
```

Here `renderSection` and `text` stand for the file's existing helpers; use their real names. If the file has no helper for `PlanBillingSection`, write one beside the test, following the render pattern in `ReferralCard.test.jsx` above with `<PlanBillingSection billing={b} />`. Also set `useStore.setState({ config: { billing: false, free_cap: 3, plans: [...] } })` so `billingState` returns `'free'`.

- [ ] **Step 2: Run them and see them fail.**

Run: `npx vitest run src/lib/share.test.js src/views/coach/ReferralCard.test.jsx src/views/coach/billing.test.jsx`
Expected: FAIL. The modules `./share.js` and `./ReferralCard.jsx` are missing, and the "Free months" row is missing.

- [ ] **Step 3: Write `share.js` and `referrals.js`.**

`frontend/src/lib/share.js`:

```js
/* Share, then clipboard: the invite link (InviteSheet) and the referral link (ReferralCard).
 *
 * Both need transient user activation, which an await can spend, and the two failures are NOT
 * alike: navigator.share rejects (NotAllowedError) but navigator.clipboard.writeText simply never
 * settles when the document is not focused. So the clipboard gets a deadline, and this never
 * rejects: what it returns tells the caller what to say.
 *   'shared' | 'cancelled' (the coach closed the share sheet: say nothing) | 'copied' | 'failed'
 */
export async function shareLink({ url, title, text }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared' }
    // AbortError is the user closing the share sheet, not a failure: falling through to the
    // clipboard would tell them something was copied when they had just said no.
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled' }
  }
  try {
    await Promise.race([
      navigator.clipboard.writeText(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard never answered')), 2000)),
    ])
    return 'copied'
  } catch { return 'failed' }
}
```

`frontend/src/lib/referrals.js`:

```js
// Coach referrals (CHW-350): the link a coach shares. It goes to fitpal.ma's home, whose site.js
// carries the ref on to the sign-up; the server checks it (App\Coaching\Referrals).
export const referralLink = handle => 'https://fitpal.ma/?ref=' + encodeURIComponent(handle)
```

- [ ] **Step 4: InviteSheet uses `shareLink`.** In `frontend/src/views/coach/sheets.jsx`, replace the body of `sendLink` and its comment block above it:

```js
  // Share, then clipboard, then just show the link (lib/share.js): the freshly minted link must
  // end up somewhere the coach can see it, whatever the browser allows.
  const sendLink = async code => {
    const link = inviteLink(code)
    const how = await shareLink({ url: link, title: t('Join me on FitPal'), text: t('Here is your invite:') })
    if (how === 'copied') toast(t('Invite link copied'))
    else if (how === 'failed') toast(link)   // last resort: put it on screen, where it can at least be selected
  }
```

and add `import { shareLink } from '../../lib/share.js'`.

Run: `npx vitest run src/views/coach/InviteSheet.test.jsx`
Expected: PASS, with no change in behaviour.

- [ ] **Step 5: Write the card.** `frontend/src/views/coach/ReferralCard.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { referralLink } from '../../lib/referrals.js'
import { shareLink } from '../../lib/share.js'
import { useUI } from '../../store/useUI.js'
import { Row, Section } from '../../components/ui.jsx'

/**
 * Account's "Refer a coach" (CHW-350): the coach's referral link, to copy or share, and how many
 * coaches signed up through it and activated. Counts only, never who. The link is their public
 * page's handle, so a coach with no page is sent to make one first. Nothing is drawn until the
 * server answers, and nothing if it can't.
 */
export default function ReferralCard() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [r, setR] = useState(null)
  useEffect(() => {
    let live = true
    api('/api/coach/referrals').then(x => { if (live) setR(x) }, () => {})
    return () => { live = false }
  }, [])
  if (!r) return null

  const footer = t('One free month for every coach who signs up through your link and whose client logs a first workout.')
  if (!r.handle) return <Section title={t('Refer a coach')} footer={footer}>
    <Row icon="link" iconTint="var(--acc)" title={t('Publish your page to get your referral link.')}
      accessory="chevron" onClick={() => nav('/account/page')} />
  </Section>

  const link = referralLink(r.handle)
  const share = async () => {
    const how = await shareLink({ url: link, title: t('Coach your clients with FitPal') })
    if (how === 'copied') toast(t('Referral link copied'))
    else if (how === 'failed') toast(link)
  }
  return <Section title={t('Refer a coach')} footer={footer}>
    <Row icon="link" iconTint="var(--acc)" title={link} subtitle={t('Copy or share your link')} accessory="chevron" onClick={share} />
    <Row icon="person" iconTint="var(--blue)" title={t('Coaches you referred')}
      value={t('{0} signed up · {1} active', r.signedUp, r.activated)} />
  </Section>
}
```

- [ ] **Step 6: The Plan & billing row.** In `PlanBillingSection` (`billing.jsx`), after `const manage = …`:

```jsx
  // Months banked from referrals (CHW-350), used when the coach pays: shown only when there are some.
  const months = billing.referralMonths > 0 && <Row icon="sparkles" iconTint="var(--acc)" title={t('Free months')}
    subtitle={t('From coaches you referred. Used when you move to a paid plan.')} value={String(billing.referralMonths)} />
```

Then put `{months}` as the last child of each of the six `<Section title={t('Plan & billing')} …>` returns: `none`, `free`, `paused`, `granted`, and the final one.

- [ ] **Step 7: Mount the card.** In `CoachAccount.jsx`, add `import ReferralCard from './ReferralCard.jsx'`. Right after `<PlanBillingSection billing={billing} />`:

```jsx
    {/* Coach referrals (CHW-350): only where plans apply, which is where a month means something. */}
    {billed && <ReferralCard />}
```

- [ ] **Step 8: The strings.** Add to each pack, next to `'Plan & billing'`.

fr.js:

```js
  'Refer a coach': 'Parrainer un coach',
  'One free month for every coach who signs up through your link and whose client logs a first workout.': 'Un mois offert pour chaque coach inscrit par votre lien dont un client fait sa première séance.',
  'Publish your page to get your referral link.': 'Publiez votre page pour avoir votre lien de parrainage.',
  'Copy or share your link': 'Copier ou partager votre lien',
  'Coaches you referred': 'Coachs parrainés',
  '{0} signed up · {1} active': '{0} inscrits · {1} actifs',
  'Referral link copied': 'Lien de parrainage copié',
  'Coach your clients with FitPal': 'Coachez vos clients avec FitPal',
  'Free months': 'Mois offerts',
  'From coaches you referred. Used when you move to a paid plan.': 'Grâce aux coachs que vous avez parrainés. Utilisés quand vous passez à une formule payante.',
```

es.js:

```js
  'Refer a coach': 'Recomienda a un entrenador',
  'One free month for every coach who signs up through your link and whose client logs a first workout.': 'Un mes gratis por cada entrenador que se registre con tu enlace y cuyo cliente haga su primer entrenamiento.',
  'Publish your page to get your referral link.': 'Publica tu página para tener tu enlace de recomendación.',
  'Copy or share your link': 'Copia o comparte tu enlace',
  'Coaches you referred': 'Entrenadores recomendados',
  '{0} signed up · {1} active': '{0} registrados · {1} activos',
  'Referral link copied': 'Enlace de recomendación copiado',
  'Coach your clients with FitPal': 'Entrena a tus clientes con FitPal',
  'Free months': 'Meses gratis',
  'From coaches you referred. Used when you move to a paid plan.': 'Por los entrenadores que recomendaste. Se usan cuando pases a un plan de pago.',
```

de.js:

```js
  'Refer a coach': 'Coach empfehlen',
  'One free month for every coach who signs up through your link and whose client logs a first workout.': 'Ein Gratismonat für jeden Coach, der sich über deinen Link anmeldet und dessen Kunde sein erstes Training einträgt.',
  'Publish your page to get your referral link.': 'Veröffentliche deine Seite, um deinen Empfehlungslink zu bekommen.',
  'Copy or share your link': 'Link kopieren oder teilen',
  'Coaches you referred': 'Empfohlene Coaches',
  '{0} signed up · {1} active': '{0} angemeldet · {1} aktiv',
  'Referral link copied': 'Empfehlungslink kopiert',
  'Coach your clients with FitPal': 'Coache deine Kunden mit FitPal',
  'Free months': 'Gratismonate',
  'From coaches you referred. Used when you move to a paid plan.': 'Durch Coaches, die du empfohlen hast. Werden eingelöst, wenn du zu einem bezahlten Tarif wechselst.',
```

- [ ] **Step 9: Run the tests and the guards.**

Run:

```bash
npx vitest run src/lib/share.test.js src/views/coach/ReferralCard.test.jsx src/views/coach/billing.test.jsx src/views/coach/InviteSheet.test.jsx
npm run check:i18n && node ../scripts/french-vous.mjs
```

Expected: PASS, the packs in sync, and `0 steps rewritten`.

- [ ] **Step 10: Commit.**

```bash
git add frontend/src
git commit -m "Referrals: the Account card and the months in Plan & billing (CHW-350)"
```

---

### Task 7: fitpal.ma carries the ref

**Files:**
- Modify: `site-coach/site.js`
- Modify: `site-coach/index.html`, `site-coach/en/index.html`, `site-coach/es/index.html` (`site.js?v=7` becomes `site.js?v=8`)
- Test: `frontend/src/lib/site-ref.test.js`

**Interfaces:**
- Produces: on a landing opened with a valid `?ref=<handle>`:
  - every `https://coach.fitpal.ma/#/start…` link ends `&ref=<handle>`;
  - every language-switcher link (`a[hreflang]` to `/`, `/en/` or `/es/`) ends `?ref=<handle>`.

- [ ] **Step 1: Write the failing test.** `frontend/src/lib/site-ref.test.js`:

```js
// @vitest-environment happy-dom
//
// fitpal.ma's site.js carries a referral link's ?ref= onto the sign-up and language links (CHW-350),
// in the URLs only: nothing is stored on the visitor's device.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(resolve(__dirname, '../../../site-coach/site.js'), 'utf8')
const page = search => {
  history.replaceState(null, '', '/' + search)
  document.body.innerHTML = `
    <a id="free" href="https://coach.fitpal.ma/#/start?plan=free">Start</a>
    <a id="solo" href="https://coach.fitpal.ma/#/start?plan=solo&amp;period=month">Solo</a>
    <a id="en" class="lang" href="/en/" hreflang="en" lang="en">EN</a>
    <a id="legal" href="/mentions-legales">Legal</a>`
  new Function(SRC)()
  const href = id => document.getElementById(id).getAttribute('href')
  return { href, stored: localStorage.length + sessionStorage.length + document.cookie.length }
}

describe('site.js and a referral link', () => {
  it('carries a valid ref onto the sign-up links and the language switcher, and stores nothing', () => {
    const p = page('?ref=Yasmine.Fit')
    expect(p.href('free')).toBe('https://coach.fitpal.ma/#/start?plan=free&ref=yasmine.fit')
    expect(p.href('solo')).toBe('https://coach.fitpal.ma/#/start?plan=solo&period=month&ref=yasmine.fit')
    expect(p.href('en')).toBe('/en/?ref=yasmine.fit')
    expect(p.href('legal')).toBe('/mentions-legales')
    expect(p.stored).toBe(0)
  })

  it('leaves every link alone without a ref, or with one that is no handle', () => {
    for (const search of ['', '?ref=', '?ref=..x', '?ref=%E0%A4%A', '?ref=a"b']) {
      const p = page(search)
      expect(p.href('free')).toBe('https://coach.fitpal.ma/#/start?plan=free')
      expect(p.href('en')).toBe('/en/')
    }
  })
})
```

- [ ] **Step 2: Run it and see it fail.**

Run: `cd frontend && npx vitest run src/lib/site-ref.test.js`
Expected: FAIL. The links are unchanged.

- [ ] **Step 3: Implement.** In `site-coach/site.js`, update the header comment's first line to `/* FitPal Coach site behaviour: scroll reveal, and a referral link's ref.`, and add before the existing IIFE:

```js
/* A referral link (CHW-350): fitpal.ma/?ref=<a coach's page handle>. The ref is carried onto the
   sign-up links (coach.fitpal.ma/#/start…) and the language switcher, in the URLs only: nothing
   is written to cookies or storage, so the site still sets none. A ref that is no handle (the
   pattern of backend/app/Coaching/Handle.php) is ignored; the server checks the rest. */
(function () {
  'use strict'

  var m = /[?&]ref=([^&#]*)/.exec(window.location.search)
  if (!m) return
  var ref
  try { ref = decodeURIComponent(m[1]).trim().replace(/^@+/, '').toLowerCase() } catch (e) { return }
  if (!/^[a-z0-9._]{3,30}$/.test(ref) || ref.charAt(0) === '.' || ref.slice(-1) === '.' || ref.indexOf('..') >= 0) return

  var links = document.querySelectorAll('a[href]')
  for (var i = 0; i < links.length; i++) {
    var h = links[i].getAttribute('href')
    if (h.indexOf('https://coach.fitpal.ma/#/start') === 0) {
      links[i].setAttribute('href', h + (h.indexOf('?') >= 0 ? '&' : '?') + 'ref=' + ref)
    } else if (links[i].hasAttribute('hreflang') && /^\/(en\/|es\/)?$/.test(h)) {
      links[i].setAttribute('href', h + '?ref=' + ref)
    }
  }
})()

```

Bump the three landings: in `site-coach/index.html`, `site-coach/en/index.html` and `site-coach/es/index.html`, change `site.js?v=7` to `site.js?v=8`.

- [ ] **Step 4: Run it and see it pass, then the site's own checks.**

Run:

```bash
npx vitest run src/lib/site-ref.test.js
cd .. && grep -c 'site.js?v=8' site-coach/index.html site-coach/en/index.html site-coach/es/index.html
npx --yes html-validate@8 site-coach/index.html site-coach/en/index.html site-coach/es/index.html
```

Expected:
- the tests PASS;
- each file shows a count of 1;
- html-validate is clean. Check `deploy-site-coach.yml` for the exact html-validate version and config, and run that one.

- [ ] **Step 5: Commit.**

```bash
git add site-coach/site.js site-coach/index.html site-coach/en/index.html site-coach/es/index.html frontend/src/lib/site-ref.test.js
git commit -m "fitpal.ma: carry a referral link's ref to the sign-up, in the URL only (CHW-350)"
```

---

### Task 8: The privacy line, reviewed

**Files:**
- Modify: `site-coach/mentions-legales.html`, `site-coach/es/legal.html`, `site-coach/en/legal.html`

- [ ] **Step 1: Add the section.** Put it before `<h3>Connexion</h3>` (FR), `<h3>Acceso</h3>` (ES) and `<h3>Signing in</h3>` (EN).

FR:

```html
  <h3>Parrainage</h3>
  <p>
    Si vous créez votre compte coach depuis le lien de parrainage d'un autre coach, nous
    enregistrons quel coach vous a parrainé, pour lui créditer un mois offert quand l'un de vos
    clients fait sa première séance. Ce coach voit combien de coachs il a parrainés, jamais
    lesquels. Le lien passe seulement dans l'adresse de la page : rien n'est enregistré sur votre
    appareil.
  </p>
```

ES (tú):

```html
  <h3>Recomendaciones</h3>
  <p>
    Si creas tu cuenta de entrenador desde el enlace de recomendación de otro entrenador,
    guardamos qué entrenador te recomendó, para darle un mes gratis cuando uno de tus clientes
    haga su primer entrenamiento. Ese entrenador ve cuántos entrenadores ha recomendado, nunca
    cuáles. El enlace solo viaja en la dirección de la página: no se guarda nada en tu
    dispositivo.
  </p>
```

EN:

```html
  <h3>Referrals</h3>
  <p>
    If you create your coach account from another coach's referral link, we record which coach
    referred you, to credit them a free month when one of your clients logs a first workout. That
    coach sees how many coaches they referred, never which. The link travels only in the page's
    address: nothing is stored on your device.
  </p>
```

- [ ] **Step 2: The legal review.** Run the review with the lawve-ai/awesome-legal-skills skills, as the owner asks for every legal or privacy change (memory: `legal-skills-review.md`). Check:
  - the lawful basis: legitimate interest in running the referral programme;
  - transparency to the referred coach, who reads this at sign-up;
  - whether a referrer can work out from the "active" count that a named coach's client trained;
  - whether `conditions.html` (the coach terms) needs a referral-programme clause (what a month is worth, no cash value, how it's applied, abuse);
  - the French "Ce site ne dépose aucun cookie" line still being true.

  Put the findings in the PR body, labelled "Not legal advice". If the review says `conditions.html` needs a clause, draft it in the same three languages and include it here. If it says something must change before launch, stop and ask the owner.

- [ ] **Step 3: Validate and commit.**

```bash
npx --yes html-validate@8 site-coach/mentions-legales.html site-coach/es/legal.html site-coach/en/legal.html
git add site-coach/mentions-legales.html site-coach/es/legal.html site-coach/en/legal.html
git commit -m "Legal notice: what a referral records (CHW-350)"
```

---

### Task 9: The whole suite, then the PR

- [ ] **Step 1: Run every gate CI runs.**

```bash
cd backend && ./vendor/bin/pest && ./vendor/bin/pint --test && cd ..
node backend/scripts/check-error-strings.mjs && node backend/scripts/check-audit-labels.mjs
cd frontend && npx vitest run && npm run check:i18n && node ../scripts/french-vous.mjs && npm run build && cd ..
```

Expected: every suite passes, `OK    64 audit events, all labelled`, and the build succeeds.

- [ ] **Step 2: See it working.** Run the app locally (`backend`: `php artisan migrate && php artisan serve`; `frontend`: `npm run dev`).
  - Open `/#/start?plan=free&ref=<a local coach's handle>` and sign up.
  - Check `users.referred_by` with `php artisan tinker`.
  - As the referrer, open Account and see the card with "1 signed up · 0 active".

  Take a screenshot of the card.

- [ ] **Step 3: Push and open the PR.**

```bash
git push -u origin ahmedchioua/chw-350-referrals
gh pr create --title "Coach referrals: a banked free month per activated coach (CHW-350)" --body-file <body>
```

The body covers:
- the spec link;
- what each task added;
- that credits need join requests on in production (CNDP, CHW-367);
- the legal review findings, labelled "Not legal advice";
- the tests;
- the attribution lines:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01F2HrhrFSAFLcZnvn9Hq2cK
```

- [ ] **Step 4: Linear.** Move CHW-350 to In Review and link the PR. File a new issue in milestone C3 for the affiliate half: "Affiliates: 20% recurring for 10k+ coaches — check Creem's affiliate features first". It is related to CHW-350.
