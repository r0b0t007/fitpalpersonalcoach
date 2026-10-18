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
        'users' => [
            ['id' => $uid, 'name' => 'Imported', 'coach' => true, 'sv' => 2, 'created' => '2025-03-04T10:20:30.000Z', 'lastReminder' => '2026-10-01', 'lastCheckinReminder' => '2026-09-28'],
            // The Node API's oldest accounts have `created: null`.
            ['id' => 'oldtimer00000000', 'name' => 'Old', 'created' => null],
        ],
        'creds' => [['id' => $pk->credentialId, 'userId' => $uid, 'publicKey' => $pk->coseKey(), 'counter' => 4, 'transports' => ['internal']]],
    ]));
    file_put_contents($this->dir.'/state-'.$uid.'.json', '{"routines":{},"units":"kg","_ts":1700000000000}');
    file_put_contents($this->dir.'/state-nobody000000000.json', '{}');   // no such account: left alone

    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()->expectsOutputToContain('users 2 · passkeys 1 · states 1');

    $user = User::query()->find($uid);
    $firstRunDate = User::query()->find('oldtimer00000000')->created_at;
    expect($user->created_at->toIso8601ZuluString())->toBe('2025-03-04T10:20:30Z')
        ->and($user->last_reminder)->toBe('2026-10-01')
        ->and($user->last_checkin_reminder)->toBe('2026-09-28')
        ->and($user->sv)->toBe(2)
        ->and($user->coach)->toBeTrue();

    $pk->counter = 4;
    $pk->login($this)->assertOk()->assertJsonPath('user.coach', true);

    $this->withHeader('Authorization', 'Bearer '.SessionToken::make($user))->get('/api/data')
        ->assertOk()->assertContent('{"state":{"routines":{},"units":"kg","_ts":1700000000000}}');

    // Idempotent: the same directory again changes nothing and fails nothing — including the
    // creation date of an account that had none, which keeps the FIRST import's.
    $this->travel(3)->days();
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    expect(User::query()->count())->toBe(2)
        ->and(User::query()->find($uid)->created_at->toIso8601ZuluString())->toBe('2025-03-04T10:20:30Z')
        ->and(User::query()->find('oldtimer00000000')->created_at->equalTo($firstRunDate))->toBeTrue();
});

it('verifies every account through /me and /data, and fails on a mismatch', function () {
    $users = [
        ['id' => 'vcoach0000000000', 'name' => 'Coach V', 'coach' => true],
        ['id' => 'vmember000000000', 'name' => 'Member V', 'coachId' => 'vcoach0000000000'],
        ['id' => 'vgone00000000000', 'name' => 'Gone', 'disabled' => true],
        ['id' => 'vfake00000000000', 'name' => 'Not really admin', 'admin' => 'yes'],   // Node: === true only
    ];
    file_put_contents($this->dir.'/db.json', json_encode(['users' => $users, 'creds' => []]));
    file_put_contents($this->dir.'/state-vmember000000000.json', '{"week":{},"history":[{"d":"2026-05-01"}],"_ts":5}');

    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])
        ->assertSuccessful()->expectsOutputToContain('verified 4 account(s)');
    expect(User::query()->find('vfake00000000000')->admin)->toBeFalse();

    // Something drifts after the import: --verify-only reads the database as it stands, names the
    // account and fails. (--verify would re-import first and so put it right.)
    User::query()->whereKey('vcoach0000000000')->update(['name' => 'Renamed']);
    DB::table('user_states')->where('user_id', 'vmember000000000')->update(['state' => '{"week":[],"_ts":5}']);
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify-only' => true])->assertFailed()
        ->expectsOutputToContain('vcoach0000000000: /me is')
        ->expectsOutputToContain('vmember000000000: /data differs');
    expect(User::query()->find('vcoach0000000000')->name)->toBe('Renamed');   // verify-only wrote nothing

    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])->assertSuccessful();
});
