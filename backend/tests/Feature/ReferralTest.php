<?php

// Coach referrals (CHW-350, docs/superpowers/specs/2026-11-07-coach-referrals-design.md): a coach
// who signs up through another coach's link, and whose join-request client trains, banks that
// referrer one free month.

use App\Coaching\Referrals;
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
