<?php

// Coach referrals (CHW-350, docs/superpowers/specs/2026-11-07-coach-referrals-design.md): a coach
// who signs up through another coach's link, and whose join-request client trains, banks that
// referrer one free month.

use App\Coaching\Referrals;
use App\Coaching\Terms;
use App\Filament\Resources\ReferralCredits\Pages\ListReferralCredits;
use App\Filament\Resources\ReferralCredits\ReferralCreditResource;
use App\Filament\Resources\Users\Pages\ListUsers;
use App\Mail\SignupCodeMail;
use App\Models\CoachPage;
use App\Models\ReferralCredit;
use App\Models\User;
use App\Support\ClientSafe;
use Filament\Actions\Testing\TestAction;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Livewire\Livewire;
use Tests\Support\Billing;
use Tests\Support\Coaching;

beforeEach(function () {
    config([
        'fitpal.session_secret' => str_repeat('ab', 32),
        'fitpal.self_serve_coach' => true, 'fitpal.invite_only' => true, 'fitpal.bootstrap_code' => '', 'fitpal.free_cap' => 3, 'fitpal.join_requests' => true,
    ]);
    Billing::on();
    Mail::fake();
    $this->f = Coaching::twoCoaches();
    $this->f->a->forceFill(['email' => 'yasmine@example.com', 'terms_version' => Terms::VERSION])->save();
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
function acceptedClient(User $coach, string $email, ?int $firstWorkoutAt, ?string $lastWorkout, bool $onRoster = true, string $status = 'accepted'): User
{
    $m = tap((new User)->forceFill(['id' => User::newId(), 'name' => 'Client', 'coach_id' => $onRoster ? $coach->id : null]))->save();
    DB::table('join_requests')->insert(['id' => substr(md5($email), 0, 24), 'coach_id' => $coach->id, 'email' => $email, 'member_id' => $m->id,
        'name' => 'Client', 'intake' => '{}', 'status' => $status, 'attempts' => 0, 'created' => REF_ACCEPTED - 60_000, 'decided' => REF_ACCEPTED]);
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
    // Only coaches with an accepted client are looked at: the first two have one who never trained.
    acceptedClient($coaches[0], 'idle0@example.com', null, null);
    acceptedClient($coaches[1], 'idle1@example.com', null, null);
    acceptedClient($coaches[2], 'sara@example.com', REF_ACCEPTED + 1, '2025-11-08');

    expect(Referrals::creditDue(Request::create('/'), 2))->toBe(0);   // looked at the first two
    expect(Referrals::creditDue(Request::create('/'), 2))->toBe(1);   // the third, then wrapped round
    expect(ReferralCredit::query()->sole()->referred_id)->toBe($coaches[2]->id);
});

it('banks when the first workout is at the very moment of acceptance', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED, '2025-11-07');
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(1);
});

it('banks nothing for history uploaded after the acceptance, whose last workout is an earlier day', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 3_600_000, '2025-11-01');
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(0);
});

it('records no referrer whose pending address is the new coach\'s', function () {
    $this->f->a->forceFill(['email' => null, 'pending_email' => 'nadia@example.com'])->save();
    expect(Referrals::referrerFor('yasmine.fit', 'Nadia@example.com'))->toBeNull();
});

// ---------------------------------------------------------------- what the coach sees

it("tells a coach their own link's counts and nobody else's", function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    referredSignup('omar@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 1, '2025-11-08');
    creditRun();

    $this->getJson('/api/coach/referrals', bearer($this->f->a))->assertOk()
        ->assertExactJson(['handle' => 'yasmine.fit', 'signedUp' => 2, 'activated' => 1]);
    // Coach B has no page and no referrals: none of A's leak into B's answer.
    $this->getJson('/api/coach/referrals', bearer($this->f->b))->assertOk()
        ->assertExactJson(['handle' => null, 'signedUp' => 0, 'activated' => 0]);
    expect($this->getJson('/api/billing/me', bearer($this->f->a))->assertOk()->json('referralMonths'))->toBe(1)
        ->and($this->getJson('/api/billing/me', bearer($this->f->b))->json('referralMonths'))->toBe(0);
    // A client is no coach.
    $this->getJson('/api/coach/referrals', bearer($this->f->a1))->assertStatus(403);
});

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
        ->toThrow(ClientSafe::class, 'this coach has no unused referral month');
});

it('lists each credit for the owner: who earned it, for whom, when, and how it was used (CHW-374)', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 1, '2025-11-08');
    creditRun();
    // Coach B's own credit, for someone else, already used: the filters keep it off A's list.
    (new User)->forceFill(['id' => 'tOther0000000000', 'name' => 'Omar', 'email' => 'omar@example.com', 'coach' => true])->save();
    ReferralCredit::query()->create(['id' => ReferralCredit::newId(), 'referrer_id' => $this->f->b->id,
        'referred_id' => 'tOther0000000000', 'months' => 1, 'created' => 1, 'used_at' => 2, 'used_note' => 'Applied by hand']);
    $mine = ReferralCredit::query()->where('referrer_id', $this->f->a->id)->sole();
    $theirs = ReferralCredit::query()->where('referrer_id', $this->f->b->id)->sole();

    $this->actingAs($this->f->admin, 'web');
    Livewire::test(ListReferralCredits::class)->assertCanSeeTableRecords([$mine, $theirs])
        ->assertSee('nadia@example.com')->assertSee('omar@example.com')->assertSee('Applied by hand')
        ->filterTable('referrer', $this->f->a->id)
        ->assertCanSeeTableRecords([$mine])->assertCanNotSeeTableRecords([$theirs])
        ->resetTableFilters()->filterTable('used', false)
        ->assertCanSeeTableRecords([$mine])->assertCanNotSeeTableRecords([$theirs])
        // A suspicious address is what the owner has in hand: either coach's finds the row.
        ->resetTableFilters()->searchTable('omar@example.com')
        ->assertCanSeeTableRecords([$theirs])->assertCanNotSeeTableRecords([$mine])
        ->searchTable('yasmine@example.com')
        ->assertCanSeeTableRecords([$mine])->assertCanNotSeeTableRecords([$theirs]);
    // Two referrers with one name stay apart in the filter: each carries its address.
    $this->f->b->forceFill(['name' => 'Coach A', 'email' => 'second@example.com'])->save();
    expect(Livewire::test(ListReferralCredits::class)->instance()->getTable()->getFilter('referrer')->getOptions())
        ->toBe([$this->f->a->id => 'Coach A (yasmine@example.com)', $this->f->b->id => 'Coach A (second@example.com)']);

    // From a coach's row, straight to their credits; a coach with none has no such link.
    Livewire::test(ListUsers::class)
        ->assertActionVisible(TestAction::make('referralCredits')->table($this->f->a))
        ->assertActionHasUrl(TestAction::make('referralCredits')->table($this->f->a),
            ReferralCreditResource::getUrl('index', ['filters' => ['referrer' => ['value' => $this->f->a->id]]]))
        ->assertActionHidden(TestAction::make('referralCredits')->table($this->f->admin));

    // A referred coach who objected (fitpal:referral-forget) is no longer named on the credit.
    $this->artisan('fitpal:referral-forget', ['email' => 'nadia@example.com'])->assertSuccessful();
    Livewire::test(ListReferralCredits::class)->assertCanSeeTableRecords([$mine->fresh()])
        ->assertDontSee('nadia@example.com')->assertSee('Forgotten on objection');
});

it('banks nothing while join requests are off', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 3_600_000, '2025-11-07');
    config(['fitpal.join_requests' => false]);
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(0);

    config(['fitpal.join_requests' => true]);
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(1);
});

it('reads no client data of a referred coach who has not accepted terms that instruct the check', function () {
    // Part B §2 makes the check the referred coach's instruction from the 2026-11-07 terms (CHW-372).
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 3_600_000, '2025-11-07');
    foreach ([null, '2026-11-06'] as $older) {
        $nadia->forceFill(['terms_version' => $older])->save();
        creditRun();
        expect(ReferralCredit::query()->count())->toBe(0);
    }

    $nadia->forceFill(['terms_version' => Referrals::TERMS_FROM])->save();
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(1);
    // A coach who signs up today accepts terms that instruct it.
    expect(Terms::VERSION >= Referrals::TERMS_FROM)->toBeTrue();
});

it('banks nothing for a pending or declined join request whose member trained', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'p@example.com', REF_ACCEPTED + 3_600_000, '2025-11-07', true, 'pending');
    acceptedClient($nadia, 'd@example.com', REF_ACCEPTED + 3_600_000, '2025-11-07', true, 'declined');
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(0);
});

it('keeps the month but names no one after an objection, and never credits that coach again', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 3_600_000, '2025-11-07');
    creditRun();
    expect(Referrals::monthsUnused($this->f->a))->toBe(1);

    $this->artisan('fitpal:referral-forget', ['email' => 'nadia@example.com'])->assertSuccessful();
    expect($nadia->fresh()->referred_by)->toBeNull();
    creditRun();
    expect(Referrals::monthsUnused($this->f->a))->toBe(1)
        ->and(ReferralCredit::query()->count())->toBe(1)
        ->and(ReferralCredit::query()->sole()->referred_id)->toBeNull();
});

it('fails the forget command for an unknown address', function () {
    $this->artisan('fitpal:referral-forget', ['email' => 'nobody@example.com'])->assertFailed();
});

it("stops the check on a client's objection, by their own address, and never credits their coach", function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    $sara = acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 3_600_000, '2025-11-07');
    $sara->forceFill(['email' => 'sara@example.com'])->save();

    $this->artisan('fitpal:referral-forget', ['email' => 'sara@example.com'])->assertSuccessful();
    expect($nadia->fresh()->referred_by)->toBeNull();
    creditRun();
    expect(ReferralCredit::query()->count())->toBe(0);

    // A client with no coach has nothing to stop.
    $sara->forceFill(['coach_id' => null])->save();
    $this->artisan('fitpal:referral-forget', ['email' => 'sara@example.com'])->assertFailed();
});

it('waits to credit a referrer until they accept the terms with the referral programme', function () {
    $nadia = referredSignup('nadia@example.com', 'yasmine.fit');
    acceptedClient($nadia, 'sara@example.com', REF_ACCEPTED + 3_600_000, '2025-11-07');
    foreach ([null, '2026-11-06'] as $older) {
        $this->f->a->forceFill(['terms_version' => $older])->save();
        creditRun();
        expect(ReferralCredit::query()->count())->toBe(0);
    }

    $this->f->a->forceFill(['terms_version' => Referrals::TERMS_FROM])->save();
    creditRun();
    expect(ReferralCredit::query()->sole()->referrer_id)->toBe($this->f->a->id);
});
