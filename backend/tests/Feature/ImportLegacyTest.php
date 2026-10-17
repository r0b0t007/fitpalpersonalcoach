<?php

// fitpal:import-legacy against a data directory shaped like the Node API's.

use App\Auth\SessionToken;
use App\Models\User;
use Tests\Support\Passkey;

beforeEach(function () {
    config(['fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173', 'fitpal.session_secret' => str_repeat('ab', 32)]);
    config(['webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost']);
    $this->dir = sys_get_temp_dir().'/fitpal-import-'.bin2hex(random_bytes(4));
    mkdir($this->dir);
});

afterEach(function () {
    array_map('unlink', glob($this->dir.'/*') ?: []);
    rmdir($this->dir);
});

it('imports accounts with their dates, their passkeys and their raw state, and can be run again', function () {
    $uid = 'q1w2e3r4t5y6u7i8';
    $pk = new Passkey;
    $pk->userHandle = Passkey::b64u($uid);
    file_put_contents($this->dir.'/db.json', json_encode([
        'users' => [['id' => $uid, 'name' => 'Imported', 'coach' => true, 'sv' => 2, 'created' => '2025-03-04T10:20:30.000Z', 'lastReminder' => '2026-10-01', 'lastCheckinReminder' => '2026-09-28']],
        'creds' => [['id' => $pk->credentialId, 'userId' => $uid, 'publicKey' => $pk->coseKey(), 'counter' => 4, 'transports' => ['internal']]],
    ]));
    file_put_contents($this->dir.'/state-'.$uid.'.json', '{"routines":{},"units":"kg","_ts":1700000000000}');
    file_put_contents($this->dir.'/state-nobody000000000.json', '{}');   // no such account: left alone

    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()->expectsOutputToContain('users 1 · passkeys 1 · states 1');

    $user = User::query()->find($uid);
    expect($user->created_at->toIso8601ZuluString())->toBe('2025-03-04T10:20:30Z')
        ->and($user->last_reminder)->toBe('2026-10-01')
        ->and($user->last_checkin_reminder)->toBe('2026-09-28')
        ->and($user->sv)->toBe(2)
        ->and($user->coach)->toBeTrue();

    $pk->counter = 4;
    $pk->login($this)->assertOk()->assertJsonPath('user.coach', true);

    $this->withHeader('Authorization', 'Bearer '.SessionToken::make($user))->get('/api/data')
        ->assertOk()->assertContent('{"state":{"routines":{},"units":"kg","_ts":1700000000000}}');

    // Idempotent: the same directory again changes nothing and fails nothing.
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    expect(User::query()->count())->toBe(1)->and(User::query()->find($uid)->created_at->toIso8601ZuluString())->toBe('2025-03-04T10:20:30Z');
});
