<?php

// A coach signing up on their own (CHW-272, spec §2 flow, §4, §4a): name, email and a passkey,
// behind SELF_SERVE_COACH and only while billing is on, then read-only until the checkout. The
// address waits in pending_email until its link is opened.

use App\Domain\Entitlement;
use App\Mail\AccountMail;
use App\Models\User;
use App\Support\ClientLimit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Laragear\WebAuthn\Models\WebAuthnCredential;
use Tests\Support\Billing;
use Tests\Support\Coaching;
use Tests\Support\Passkey;

beforeEach(function () {
    config([
        'fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173',
        'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost',
        'fitpal.session_secret' => str_repeat('ab', 32),
        'fitpal.self_serve_coach' => true, 'fitpal.invite_only' => true, 'fitpal.bootstrap_code' => '', 'fitpal.free_cap' => 0,
    ]);
    Billing::on();
    Mail::fake();
    $this->f = Coaching::twoCoaches();
});

function coachSignup(array $body, ?Passkey $pk = null): TestResponse
{
    $pk ??= new Passkey;
    $options = test()->postJson('/api/register/options', $body + ['coach' => true]);
    if ($options->status() !== 200) {
        return $options;
    }

    return test()->postJson('/api/register/verify', ['cid' => $options->json('cid'), 'credential' => $pk->attest($options->json('options'))]);
}

/** The confirmation link mailed to $to, as the coach would open it. */
function confirmLinkTo(string $to): TestResponse
{
    $mail = Mail::sent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'confirm' && $m->hasTo($to))->last();
    parse_str((string) parse_url(str_replace('/#/link', '/link', $mail->url), PHP_URL_QUERY), $q);

    return test()->postJson('/api/login/link', ['t' => $q['t']]);
}

it('creates a coach on an invite-only instance without an invite, the address waiting for its link', function () {
    $pk = new Passkey;
    $res = coachSignup(['name' => 'Nadia', 'email' => ' Nadia@Example.com '], $pk)->assertOk();
    $user = User::query()->find($res->json('user.id'));
    expect($user->only(['name', 'email', 'pending_email', 'coach', 'self_serve', 'admin']))
        ->toBe(['name' => 'Nadia', 'email' => null, 'pending_email' => 'nadia@example.com', 'coach' => true, 'self_serve' => true, 'admin' => false])
        ->and(WebAuthnCredential::query()->where('authenticatable_id', $user->id)->count())->toBe(1)
        ->and($res->getCookie('gymsid', false)?->getValue())->not->toBeEmpty();
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.ok', 'uid' => $user->id, 'msg' => 'self-serve']);
    $pk->login($this)->assertOk()->assertJsonPath('user.id', $user->id);

    // The mail confirms the address: opened, it becomes the account's sign-in address.
    confirmLinkTo('nadia@example.com')->assertOk()->assertExactJson(['ok' => true, 'email' => 'nadia@example.com']);
    $user->refresh();
    expect($user->only(['email', 'pending_email']))->toBe(['email' => 'nadia@example.com', 'pending_email' => null])
        ->and($user->email_verified_at)->not->toBeNull();
});

it('writes the confirmation in the language the app sent, English otherwise', function (?string $lang, string $expect) {
    coachSignup(['name' => 'Nadia', 'email' => 'nadia@example.com'] + ($lang !== null ? ['lang' => $lang] : []))->assertOk();
    expect(Mail::sent(AccountMail::class)->sole()->lang)->toBe($expect);
})->with([['fr', 'fr'], ['it', 'en'], [null, 'en']]);

it('takes the coach flag as a form or another client may send it', function (mixed $flag) {
    $res = coachSignup(['name' => 'Nadia', 'email' => 'nadia@example.com', 'coach' => $flag])->assertOk();
    expect(User::query()->find($res->json('user.id'))->self_serve)->toBeTrue();
})->with([[true], ['true'], [1], ['1']]);

it('leaves a self-serve coach read-only until the checkout licenses them', function () {
    $res = coachSignup(['name' => 'Nadia', 'email' => 'nadia@example.com'])->assertOk();
    $user = User::query()->find($res->json('user.id'));
    expect(Entitlement::for($user)->toArray())->toMatchArray(['status' => 'none', 'cap' => 0, 'canWrite' => false]);
    $this->postJson('/api/coach/invites/new', [], bearer($user))->assertStatus(402);
});

it('stays closed while SELF_SERVE_COACH is off, or while billing is off with no Free plan, invite-only or not', function (array $config) {
    config($config);
    $this->postJson('/api/register/options', ['name' => 'Nadia', 'email' => 'nadia@example.com', 'coach' => true])
        ->assertStatus(403)->assertExactJson(['error' => 'coach sign-up is not open on this server']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.denied', 'msg' => 'self-serve-closed']);
})->with([
    'flag off, invite-only' => [['fitpal.self_serve_coach' => false]],
    'flag off, open' => [['fitpal.self_serve_coach' => false, 'fitpal.invite_only' => false]],
    'flag off, Free plan, billing off' => [['fitpal.self_serve_coach' => false, 'fitpal.free_cap' => 3, 'fitpal.creem.api_key' => '']],
    'billing off: a free, unlimited coach for anyone' => [['fitpal.creem.api_key' => '']],
]);

it('says the same for an address that has an account, and refuses it only when its link is opened', function () {
    $f = $this->f;
    $f->a->forceFill(['email' => 'coach.a@example.com'])->save();
    foreach (['', 'nope', str_repeat('a', 250).'@x.io'] as $email) {
        $this->postJson('/api/register/options', ['name' => 'N', 'email' => $email, 'coach' => true])->assertStatus(400)->assertExactJson(['error' => 'that is not an email address']);
    }
    // No 409 here: that would look the address up for anyone.
    coachSignup(['name' => 'N', 'email' => 'Coach.A@example.com'])->assertOk();
    confirmLinkTo('coach.a@example.com')->assertStatus(409)->assertExactJson(['error' => 'that email address is already used by another account']);
    expect(User::query()->where('name', 'N')->value('email'))->toBeNull();
});

it('lets nobody squat an address: the one who confirms it has it', function () {
    // A stranger types the owner's address and makes a passkey; they cannot open its mail.
    $stranger = coachSignup(['name' => 'Squatter', 'email' => 'owner@example.com'])->assertOk()->json('user.id');
    // The owner can still sign up with it, and confirm it.
    $owner = coachSignup(['name' => 'Owner', 'email' => 'owner@example.com'])->assertOk()->json('user.id');
    confirmLinkTo('owner@example.com')->assertOk();
    expect(User::query()->find($owner)->email)->toBe('owner@example.com')
        ->and(User::query()->find($stranger)->email)->toBeNull();
    // A sign-in link to that address now reaches the owner's account alone.
    $this->postJson('/api/login/email', ['email' => 'owner@example.com'])->assertOk();
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'signin' && $m->hasTo('owner@example.com'));
});

it('refuses at verify when the sign-up was closed after the options', function () {
    $pk = new Passkey;
    $options = $this->postJson('/api/register/options', ['name' => 'N', 'email' => 'n@example.com', 'coach' => true])->assertOk();
    config(['fitpal.self_serve_coach' => false]);
    $this->postJson('/api/register/verify', ['cid' => $options->json('cid'), 'credential' => $pk->attest($options->json('options'))])->assertStatus(403);
    expect(User::query()->where('name', 'N')->exists())->toBeFalse();
});

it('keeps coach sign-ups to 10 an hour from one place, counting only real ones', function () {
    foreach (range(1, 5) as $i) {
        $this->postJson('/api/register/options', ['name' => 'N', 'email' => 'typo', 'coach' => true])->assertStatus(400);
    }
    foreach (range(1, 10) as $i) {
        $this->postJson('/api/register/options', ['name' => 'N', 'email' => "n{$i}@example.com", 'coach' => true])->assertOk();
    }
    $this->postJson('/api/register/options', ['name' => 'N', 'email' => 'n11@example.com', 'coach' => true])
        ->assertStatus(429)->assertExactJson(['error' => 'too many sign-ups from here — try again later']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.denied', 'msg' => 'self-serve-throttled']);
});

it('limits by the connection too, whatever forwarded address a caller claims', function () {
    $hit = 0;
    foreach (range(1, 101) as $i) {
        $request = Request::create('/api/register/options', 'POST', server: ['REMOTE_ADDR' => '192.0.2.1', 'HTTP_CF_CONNECTING_IP' => '198.51.100.'.($i % 250)]);
        $hit += ClientLimit::over($request, 'register-coach', 10, 100, 3600) ? 1 : 0;
    }
    expect($hit)->toBe(1)->and(RateLimiter::attempts('register-coach:peer:192.0.2.1'))->toBe(100);
});

it('makes no admin of a self-serve coach, and does not let one kill the bootstrap code', function () {
    foreach (['invites', 'progress_photos', 'media_uploads', 'push_subscriptions', 'presence', 'licences', 'assignments', 'coach_programs', 'exercise_media', 'users'] as $table) {
        DB::table($table)->delete();
    }
    config(['fitpal.bootstrap_code' => 'first-account-key-2026']);
    // A stranger signs up first, sending the bootstrap code for good measure.
    $first = coachSignup(['name' => 'Early', 'email' => 'early@example.com', 'code' => 'first-account-key-2026'])->assertOk()->json('user.id');
    expect(User::query()->find($first)->isAdmin())->toBeFalse();
    // The owner's bootstrap still works.
    $owner = (new Passkey)->register($this, 'Owner', 'first-account-key-2026')->assertOk()->json('user.id');
    expect(User::query()->find($owner)->isAdmin())->toBeTrue();
});

it('opens on the Free plan with billing off: the coach is capped at FREE_CAP, never unlimited', function () {
    config(['fitpal.free_cap' => 3, 'fitpal.creem.api_key' => '']);
    $res = coachSignup(['name' => 'Salma', 'email' => 'salma@example.com'])->assertOk();
    $coach = User::query()->find($res->json('user.id'));
    expect(Entitlement::for($coach)->toArray())->toMatchArray(['status' => 'free', 'cap' => 3, 'used' => 0, 'canWrite' => true, 'canTakeClient' => true]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.ok', 'uid' => $coach->id, 'msg' => 'self-serve']);
});
