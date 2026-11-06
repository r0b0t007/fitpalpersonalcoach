<?php

// A coach signing up with an emailed code instead of a passkey (CHW-368): the coaches fitpal.ma
// sends to /#/start come from Instagram, whose browser fails or loses passkeys. Same gates as the
// passkey sign-up (SelfServeTest); the code proves the address, so the account has it at once.

use App\Coaching\Terms;
use App\Mail\AccountMail;
use App\Mail\SignupCodeMail;
use App\Models\CoachSignup;
use App\Models\User;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Laragear\WebAuthn\Models\WebAuthnCredential;
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
});

function signupStart(array $body = []): TestResponse
{
    return test()->postJson('/api/coach/signup/start', $body + ['name' => 'Nadia', 'email' => 'nadia@example.com', 'lang' => 'fr', 'terms' => Terms::VERSION]);
}

/** The code in the newest sign-up mail to $to. */
function signupCodeTo(string $to): string
{
    return Mail::sent(SignupCodeMail::class, fn (SignupCodeMail $m) => $m->hasTo($to))->last()->code;
}

function signupVerify(string $email, string $code): TestResponse
{
    return test()->postJson('/api/coach/signup/verify', ['email' => $email, 'code' => $code]);
}

it('mails a code, and the code makes a coach whose address is proven, with no passkey', function () {
    signupStart(['email' => ' Nadia@Example.com '])->assertOk()->assertExactJson(['ok' => true]);
    $mail = Mail::sent(SignupCodeMail::class)->sole();
    expect($mail->hasTo('nadia@example.com'))->toBeTrue()->and($mail->lang)->toBe('fr')
        ->and($mail->code)->toMatch('/^\d{6}$/')
        ->and(User::query()->where('name', 'Nadia')->exists())->toBeFalse();

    $res = signupVerify('NADIA@example.com', $mail->code)->assertOk();
    $user = User::query()->find($res->json('user.id'));
    expect($user->only(['name', 'email', 'pending_email', 'coach', 'self_serve', 'admin', 'terms_version']))
        ->toBe(['name' => 'Nadia', 'email' => 'nadia@example.com', 'pending_email' => null, 'coach' => true, 'self_serve' => true, 'admin' => false, 'terms_version' => Terms::VERSION])
        ->and($user->email_verified_at)->not->toBeNull()
        ->and(WebAuthnCredential::query()->where('authenticatable_id', $user->id)->count())->toBe(0)
        ->and($res->getCookie('gymsid', false)?->getValue())->not->toBeEmpty()
        ->and(CoachSignup::query()->count())->toBe(0);
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.ok', 'uid' => $user->id, 'msg' => 'self-serve-code']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.terms.accept', 'uid' => $user->id, 'msg' => Terms::VERSION]);
    // The code is spent: it makes one account.
    signupVerify('nadia@example.com', $mail->code)->assertStatus(400)->assertExactJson(['error' => 'that code has expired — ask for a new one']);

    // Its way back in is the emailed code, as a client's is.
    $this->postJson('/api/login/email', ['email' => 'nadia@example.com'])->assertOk();
    Mail::assertSent(AccountMail::class, fn ($m) => $m->kind === 'signin' && $m->hasTo('nadia@example.com'));
});

it('keeps the terms only when they are the current ones, and writes in English for a language it has not', function () {
    signupStart(['terms' => '2020-01-01', 'lang' => 'it'])->assertOk();
    expect(Mail::sent(SignupCodeMail::class)->sole()->lang)->toBe('en');
    $id = signupVerify('nadia@example.com', signupCodeTo('nadia@example.com'))->assertOk()->json('user.id');
    expect(User::query()->find($id)->terms_version)->toBeNull();
});

it('starts again on a second request: one sign-up per address, only the newest code works', function () {
    signupStart()->assertOk();
    $first = signupCodeTo('nadia@example.com');
    signupStart(['name' => 'Nadia B'])->assertOk();
    $second = signupCodeTo('nadia@example.com');
    expect(CoachSignup::query()->count())->toBe(1);
    if ($first !== $second) {
        signupVerify('nadia@example.com', $first)->assertStatus(400);
    }
    $id = signupVerify('nadia@example.com', $second)->assertOk()->json('user.id');
    expect(User::query()->find($id)->name)->toBe('Nadia B');
});

it('spends the code after five wrong tries', function () {
    signupStart()->assertOk();
    $code = signupCodeTo('nadia@example.com');
    $wrong = $code === '000000' ? '111111' : '000000';
    foreach (range(1, CoachSignup::MAX_ATTEMPTS) as $i) {
        signupVerify('nadia@example.com', $wrong)->assertStatus(400)->assertExactJson(['error' => 'that code is wrong — check the email and try again']);
    }
    signupVerify('nadia@example.com', $code)->assertStatus(429)->assertExactJson(['error' => 'too many tries — request a new code']);
    expect(User::query()->where('name', 'Nadia')->exists())->toBeFalse();
});

it('refuses an expired code, and an address nobody started with, alike', function () {
    signupStart()->assertOk();
    $code = signupCodeTo('nadia@example.com');
    $this->travel(CoachSignup::CODE_MINUTES + 1)->minutes();
    signupVerify('nadia@example.com', $code)->assertStatus(400)->assertExactJson(['error' => 'that code has expired — ask for a new one']);
    signupVerify('nobody@example.com', '123456')->assertStatus(400)->assertExactJson(['error' => 'that code has expired — ask for a new one']);
});

it('says nothing about an address at start, and refuses one with an account only once its code is proven', function () {
    $this->f->a->forceFill(['email' => 'coach.a@example.com'])->save();
    signupStart(['email' => 'Coach.A@example.com'])->assertOk()->assertExactJson(['ok' => true]);
    signupVerify('coach.a@example.com', signupCodeTo('coach.a@example.com'))
        ->assertStatus(409)->assertExactJson(['error' => 'that email address is already used by another account']);
    expect(User::query()->where('name', 'Nadia')->exists())->toBeFalse();
});

it('takes an address another sign-up only typed: whoever proves it has it', function () {
    // A passkey sign-up that named this address and never confirmed it holds nothing.
    $this->f->a->forceFill(['pending_email' => 'nadia@example.com'])->save();
    signupStart()->assertOk();
    $id = signupVerify('nadia@example.com', signupCodeTo('nadia@example.com'))->assertOk()->json('user.id');
    expect(User::query()->find($id)->email)->toBe('nadia@example.com');
});

it('refuses a bad name or address before mailing anything', function () {
    signupStart(['name' => '  '])->assertStatus(400)->assertExactJson(['error' => 'name required']);
    foreach (['', 'nope', str_repeat('a', 250).'@x.io'] as $email) {
        signupStart(['email' => $email])->assertStatus(400)->assertExactJson(['error' => 'that is not an email address']);
    }
    Mail::assertNothingSent();
});

it('stays closed while self-serve sign-up is, at start and again at verify', function () {
    config(['fitpal.self_serve_coach' => false]);
    signupStart()->assertStatus(403)->assertExactJson(['error' => 'coach sign-up is not open on this server']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.denied', 'msg' => 'self-serve-closed']);
    Mail::assertNothingSent();

    config(['fitpal.self_serve_coach' => true]);
    signupStart()->assertOk();
    $code = signupCodeTo('nadia@example.com');
    config(['fitpal.self_serve_coach' => false]);
    signupVerify('nadia@example.com', $code)->assertStatus(403)->assertExactJson(['error' => 'coach sign-up is not open on this server']);
    expect(User::query()->where('name', 'Nadia')->exists())->toBeFalse();
});

it('shares the passkey sign-up\'s 10 an hour from one place', function () {
    foreach (range(1, 10) as $i) {
        signupStart(['email' => "n{$i}@example.com"])->assertOk();
    }
    signupStart(['email' => 'n11@example.com'])->assertStatus(429)->assertExactJson(['error' => 'too many sign-ups from here — try again later']);
    expect(Mail::sent(SignupCodeMail::class))->toHaveCount(10);
});

it('mails one address at most 3 codes in 15 minutes, answering alike after', function () {
    foreach (range(1, 4) as $i) {
        signupStart()->assertOk()->assertExactJson(['ok' => true]);
    }
    expect(Mail::sent(SignupCodeMail::class))->toHaveCount(3);
});

it('is pruned a day after it was started', function () {
    signupStart()->assertOk();
    $this->travel(25)->hours();
    $this->artisan('fitpal:prune')->assertSuccessful();
    expect(CoachSignup::query()->count())->toBe(0);
});
