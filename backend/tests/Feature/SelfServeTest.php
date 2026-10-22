<?php

// A coach signing up on their own (CHW-272, spec §2 flow, §4, §4a): name, email and a passkey,
// behind SELF_SERVE_COACH, then read-only until the checkout licenses them.

use App\Domain\Entitlement;
use App\Mail\AccountMail;
use App\Models\LoginLink;
use App\Models\User;
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
        'fitpal.self_serve_coach' => true, 'fitpal.invite_only' => true, 'fitpal.bootstrap_code' => '',
    ]);
    Mail::fake();
    RateLimiter::clear('register-coach:127.0.0.1');
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

it('creates a coach with their email, on an invite-only instance, without an invite', function () {
    $pk = new Passkey;
    $res = coachSignup(['name' => 'Nadia', 'email' => ' Nadia@Example.com '], $pk)->assertOk();
    $user = User::query()->find($res->json('user.id'));
    expect($user->only(['name', 'email', 'coach', 'self_serve', 'admin']))->toBe(['name' => 'Nadia', 'email' => 'nadia@example.com', 'coach' => true, 'self_serve' => true, 'admin' => false])
        ->and($user->email_verified_at)->toBeNull()
        ->and($user->coach_id)->toBeNull()
        ->and(WebAuthnCredential::query()->where('authenticatable_id', $user->id)->count())->toBe(1)
        ->and($res->getCookie('gymsid', false)?->getValue())->not->toBeEmpty();
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.ok', 'uid' => $user->id, 'msg' => 'self-serve']);
    $pk->login($this)->assertOk()->assertJsonPath('user.id', $user->id);
});

it('mails the account its first sign-in link, which verifies the address when opened', function () {
    $res = coachSignup(['name' => 'Nadia', 'email' => 'nadia@example.com', 'lang' => 'fr'])->assertOk();
    $mail = Mail::sent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'signin' && $m->hasTo('nadia@example.com'))->sole();
    expect($mail->lang)->toBe('fr')->and(LoginLink::query()->count())->toBe(1);
    parse_str((string) parse_url(str_replace('/#/link', '/link', $mail->url), PHP_URL_QUERY), $q);
    $this->postJson('/api/login/link', ['t' => $q['t']])->assertOk();
    expect(User::query()->find($res->json('user.id'))->email_verified_at)->not->toBeNull();
});

it('falls back to English for the mail when the app sends no language it has', function () {
    coachSignup(['name' => 'Nadia', 'email' => 'nadia@example.com', 'lang' => 'it'])->assertOk();
    expect(Mail::sent(AccountMail::class)->sole()->lang)->toBe('en');
});

it('leaves a self-serve coach read-only until the checkout licenses them', function () {
    Billing::on();
    $res = coachSignup(['name' => 'Nadia', 'email' => 'nadia@example.com'])->assertOk();
    $user = User::query()->find($res->json('user.id'));
    expect(Entitlement::for($user)->toArray())->toMatchArray(['status' => 'none', 'cap' => 0, 'canWrite' => false]);
    $this->postJson('/api/coach/invites/new', [], bearer($user))->assertStatus(402);
    // With billing off (no Creem), an instance has no paying path, and the coach writes.
    config(['fitpal.creem.api_key' => '']);
    $this->postJson('/api/coach/invites/new', [], bearer($user))->assertOk();
});

it('refuses a coach sign-up while SELF_SERVE_COACH is off, invite-only or not', function (bool $inviteOnly) {
    config(['fitpal.self_serve_coach' => false, 'fitpal.invite_only' => $inviteOnly]);
    $this->postJson('/api/register/options', ['name' => 'Nadia', 'email' => 'nadia@example.com', 'coach' => true])
        ->assertStatus(403)->assertExactJson(['error' => 'coach sign-up is not open on this server']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.denied', 'msg' => 'self-serve-closed']);
    // A sign-up without `coach` is the ordinary one, untouched.
    if (! $inviteOnly) {
        (new Passkey)->register($this, 'Client')->assertOk();
    }
})->with(['invite-only' => [true], 'open' => [false]]);

it('refuses a bad or taken address before the passkey prompt, and again when the account is written', function () {
    $f = $this->f;
    $f->a->forceFill(['email' => 'coach.a@example.com'])->save();
    foreach (['', 'nope', str_repeat('a', 250).'@x.io'] as $email) {
        $this->postJson('/api/register/options', ['name' => 'N', 'email' => $email, 'coach' => true])->assertStatus(400)->assertExactJson(['error' => 'that is not an email address']);
    }
    $taken = ['error' => 'that email address already has an account — sign in with it instead'];
    $this->postJson('/api/register/options', ['name' => 'N', 'email' => 'Coach.A@example.com', 'coach' => true])->assertStatus(409)->assertExactJson($taken);

    // Free at options, taken by the time the account is written.
    $pk = new Passkey;
    $options = $this->postJson('/api/register/options', ['name' => 'N', 'email' => 'late@example.com', 'coach' => true])->assertOk();
    $f->b->forceFill(['email' => 'late@example.com'])->save();
    $this->postJson('/api/register/verify', ['cid' => $options->json('cid'), 'credential' => $pk->attest($options->json('options'))])
        ->assertStatus(409)->assertExactJson($taken);
    expect(User::query()->where('name', 'N')->exists())->toBeFalse()
        ->and(WebAuthnCredential::query()->count())->toBe(0);
    Mail::assertNothingSent();
});

it('refuses at verify when SELF_SERVE_COACH was turned off after the options', function () {
    $pk = new Passkey;
    $options = $this->postJson('/api/register/options', ['name' => 'N', 'email' => 'n@example.com', 'coach' => true])->assertOk();
    config(['fitpal.self_serve_coach' => false]);
    $this->postJson('/api/register/verify', ['cid' => $options->json('cid'), 'credential' => $pk->attest($options->json('options'))])->assertStatus(403);
    expect(User::query()->where('name', 'N')->exists())->toBeFalse();
});

it('tells the second of two sign-ups with one address at once that it is taken, not a server error', function () {
    $pk = new Passkey;
    $options = $this->postJson('/api/register/options', ['name' => 'N', 'email' => 'race@example.com', 'coach' => true])->assertOk();
    $raced = false;
    DB::connection()->beforeExecuting(function (string $sql) use (&$raced) {
        if (! $raced && str_starts_with($sql, 'insert into "users"')) {
            $raced = true;
            DB::table('users')->where('id', 'tU1000000000000x')->update(['email' => 'race@example.com']);
        }
    });
    $this->postJson('/api/register/verify', ['cid' => $options->json('cid'), 'credential' => $pk->attest($options->json('options'))])
        ->assertStatus(409)->assertExactJson(['error' => 'that email address already has an account — sign in with it instead']);
    expect($raced)->toBeTrue();
});

it('keeps coach sign-ups to 10 an hour from one place', function () {
    foreach (range(1, 10) as $i) {
        $this->postJson('/api/register/options', ['name' => 'N', 'email' => "n{$i}@example.com", 'coach' => true])->assertOk();
    }
    $this->postJson('/api/register/options', ['name' => 'N', 'email' => 'n11@example.com', 'coach' => true])
        ->assertStatus(429)->assertExactJson(['error' => 'too many sign-ups from here — try again later']);
});

it('makes no admin of a self-serve coach, even with the bootstrap code on an empty instance', function () {
    // An empty instance, where the bootstrap code would make the first account admin.
    foreach (['invites', 'progress_photos', 'media_uploads', 'push_subscriptions', 'presence', 'licences', 'assignments', 'coach_programs', 'exercise_media', 'users'] as $table) {
        DB::table($table)->delete();
    }
    config(['fitpal.bootstrap_code' => 'BOOT-123']);
    $res = coachSignup(['name' => 'Nadia', 'email' => 'nadia@example.com', 'code' => 'BOOT-123'])->assertOk();
    expect(User::query()->find($res->json('user.id'))->isAdmin())->toBeFalse();
});
