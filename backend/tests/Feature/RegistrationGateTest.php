<?php

// Who may create an account (api/server.js register/options and verify, domain.mjs
// bootstrapMatches): open instances take anyone; INVITE_ONLY ones take a valid code, and the very
// first account may come in with BOOTSTRAP_CODE and becomes the admin.

use App\Auth\Bootstrap;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Support\Passkey;

const BOOT = 'k3y-0f-the-f1rst-account';

beforeEach(fn () => config([
    'fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173', 'fitpal.session_secret' => str_repeat('ab', 32),
    'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost',
    'fitpal.invite_only' => false, 'fitpal.bootstrap_code' => '',
]));

it('lets anyone register on an open instance, with or without a code', function () {
    (new Passkey)->register($this, 'Open')->assertOk();
    (new Passkey)->register($this, 'Holding a dead link', 'NOT-A-CODE')->assertOk();
});

it('refuses a sign-up without a valid code on an invite-only instance, and records why without the code', function () {
    config(['fitpal.invite_only' => true]);
    $this->postJson('/api/register/options', ['name' => 'Nadia'])->assertStatus(403)->assertExactJson(['error' => 'a valid invite code is required']);
    $this->postJson('/api/register/options', ['name' => 'Nadia', 'code' => 'GUESS1234'])->assertStatus(403);

    $rows = DB::table('audit_events')->get();
    expect($rows)->toHaveCount(2)
        ->and($rows[0]->ev)->toBe('auth.register.denied')->and($rows[0]->name)->toBe('Nadia')->and($rows[0]->msg)->toBe('invite-rejected')
        ->and(json_encode($rows))->not->toContain('GUESS1234');
});

it('makes the first account an admin with the bootstrap code, case-insensitively, then the code is dead', function () {
    config(['fitpal.invite_only' => true, 'fitpal.bootstrap_code' => BOOT]);
    $r = (new Passkey)->register($this, 'Owner', strtolower(BOOT));
    $r->assertOk()->assertJsonPath('user.admin', true)->assertJsonPath('user.coach', true);
    expect(User::query()->first()->admin)->toBeTrue();

    // A second person with the same code: there is an account now, so the code opens nothing.
    $this->postJson('/api/register/options', ['name' => 'Late', 'code' => BOOT])->assertStatus(403);
});

it('re-checks the bootstrap code at verify: whoever finishes second is refused, not made admin', function () {
    config(['fitpal.invite_only' => true, 'fitpal.bootstrap_code' => BOOT]);
    $a = new Passkey;
    $b = new Passkey;
    // Both get through options while the database is empty...
    $oa = $this->postJson('/api/register/options', ['name' => 'A', 'code' => BOOT])->assertOk()->json();
    $ob = $this->postJson('/api/register/options', ['name' => 'B', 'code' => BOOT])->assertOk()->json();
    // ...the first to verify wins; the second finds the code spent.
    $this->postJson('/api/register/verify', ['cid' => $oa['cid'], 'credential' => $a->attest($oa['options'])])->assertOk()->assertJsonPath('user.admin', true);
    $this->postJson('/api/register/verify', ['cid' => $ob['cid'], 'credential' => $b->attest($ob['options'])])
        ->assertStatus(403)->assertExactJson(['error' => 'invite code is no longer valid — ask for a new one']);
    expect(User::query()->count())->toBe(1)
        ->and(DB::table('audit_events')->where('msg', 'invite-invalid')->count())->toBe(1);
});

it('ignores a bootstrap code that is too short, empty, or used once accounts exist', function () {
    expect(Bootstrap::matches('SHORT', 0, 'SHORT'))->toBeFalse()
        ->and(Bootstrap::matches(BOOT, 0, BOOT))->toBeTrue()
        ->and(Bootstrap::matches(BOOT, 1, BOOT))->toBeFalse()
        ->and(Bootstrap::matches('', 0, ''))->toBeFalse()
        ->and(Bootstrap::matches(BOOT.'x', 0, BOOT))->toBeFalse();
});

it('on an open instance, applies the code only if someone actually supplies it, as Node did', function () {
    // Node checks the code at verify whatever INVITE_ONLY says; the form just never asks for one
    // there, which is what fitpal:check-config warns about.
    config(['fitpal.bootstrap_code' => BOOT]);
    (new Passkey)->register($this, 'Holder of the code', BOOT)->assertOk()->assertJsonPath('user.admin', true);
    (new Passkey)->register($this, 'Everyone after', BOOT)->assertOk()->assertJsonPath('user.admin', false);
});

it('says so when the bootstrap or session configuration will not behave', function () {
    config(['fitpal.bootstrap_code' => 'short', 'fitpal.invite_only' => false]);
    $this->artisan('fitpal:check-config')->assertFailed()
        ->expectsOutputToContain('under 16 characters')
        ->expectsOutputToContain('INVITE_ONLY is off');

    config(['fitpal.bootstrap_code' => BOOT, 'fitpal.invite_only' => true, 'fitpal.session_secret' => '']);
    $this->artisan('fitpal:check-config')->assertFailed()->expectsOutputToContain('SESSION_SECRET');

    config(['fitpal.session_secret' => str_repeat('ab', 32)]);
    $this->artisan('fitpal:check-config')->assertSuccessful()->expectsOutputToContain('configuration ok');
});
