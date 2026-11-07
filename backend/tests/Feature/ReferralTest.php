<?php

// Coach referrals (CHW-350, docs/superpowers/specs/2026-11-07-coach-referrals-design.md): a coach
// who signs up through another coach's link, and whose join-request client trains, banks that
// referrer one free month.

use App\Coaching\Referrals;
use App\Coaching\Terms;
use App\Mail\SignupCodeMail;
use App\Models\CoachPage;
use App\Models\ReferralCredit;
use App\Models\User;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\DB;
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

it('checks every referred coach in turn, a batch at a time', function () {
    $coaches = collect(['n1@example.com', 'n2@example.com', 'n3@example.com'])
        ->map(fn ($e) => referredSignup($e, 'yasmine.fit'))->sortBy('id')->values();
    acceptedClient($coaches[2], 'sara@example.com', REF_ACCEPTED + 1, '2025-11-08');

    expect(Referrals::creditDue(Request::create('/'), 2))->toBe(0);   // looked at the first two
    expect(Referrals::creditDue(Request::create('/'), 2))->toBe(1);   // the third, then wrapped round
    expect(ReferralCredit::query()->sole()->referred_id)->toBe($coaches[2]->id);
});

it('banks when the first workout is at the very moment of acceptance', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED, null);
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(1);
});

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
