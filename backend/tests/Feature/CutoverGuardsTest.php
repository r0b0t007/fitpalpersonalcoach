<?php

// The cutover's one-way mistakes (R5, CHW-297), refused or named before they happen: an import on a
// live instance that is not deliberate, or that would bind every passkey to the wrong RP_ID or leave
// the media and push keys behind; and a live config that signs everyone out or silences push.

use App\Console\Commands\CheckConfig;
use App\Models\PushSubscription;
use App\Models\User;
use Tests\Support\Passkey;

const CUTOVER_LIVE = ['fitpal.rp_id' => 'coach.example', 'fitpal.origin' => 'https://coach.example',
    'webauthn.relying_party.id' => 'coach.example', 'webauthn.origins' => 'coach.example'];

beforeEach(function () {
    $this->dir = sys_get_temp_dir().'/fitpal-cutover-'.bin2hex(random_bytes(4));
    mkdir($this->dir);
    file_put_contents($this->dir.'/db.json', json_encode(['users' => [['id' => 'cutcoach00000000', 'name' => 'Coach', 'coach' => true]], 'creds' => []]));
    file_put_contents($this->dir.'/vapid.json', json_encode(['publicKey' => 'nodePublic', 'privateKey' => 'nodePrivate']));
    file_put_contents($this->dir.'/secret', str_repeat('cd', 32)."\n");
    config(CUTOVER_LIVE + ['fitpal.data_dir' => $this->dir, 'fitpal.vapid.public' => '', 'fitpal.vapid.private' => '',
        'fitpal.session_secret' => str_repeat('cd', 32)]);
});

afterEach(function () {
    array_map('unlink', glob($this->dir.'/*') ?: []);
    rmdir($this->dir);
});

function cutoverLive(): void
{
    app()->detectEnvironment(fn () => 'production');
}

it('imports on a live instance only when told it is the cutover', function () {
    cutoverLive();
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertFailed()
        ->expectsOutputToContain('--confirm-live')->expectsOutputToContain('nothing was imported');
    expect(User::query()->count())->toBe(0);

    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--confirm-live' => true])->assertSuccessful();
    expect(User::query()->find('cutcoach00000000'))->not->toBeNull();
});

it('refuses a live import under a localhost or plain-http origin, whatever the flag says', function (array $origin, string $said) {
    cutoverLive();
    config($origin);
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--confirm-live' => true])->assertFailed()
        ->expectsOutputToContain($said);
    expect(User::query()->count())->toBe(0);
})->with([
    'localhost' => [['fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173'], 'still localhost'],
    'plain http' => [['fitpal.origin' => 'http://coach.example'], 'is not https'],
    'another host' => [['fitpal.origin' => 'https://elsewhere.example'], 'is not the host of ORIGIN'],
]);

it('refuses a live import whose media or push keys would be left behind', function () {
    cutoverLive();
    config(['fitpal.data_dir' => $this->dir.'/elsewhere']);
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--confirm-live' => true])->assertFailed()
        ->expectsOutputToContain('DATA_DIR')->expectsOutputToContain('nothing was imported');
    expect(User::query()->count())->toBe(0);
});

it('still only warns on a laptop', function () {
    config(['fitpal.data_dir' => $this->dir.'/elsewhere']);
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()->expectsOutputToContain('DATA_DIR');
});

it('fails verify when a passkey was imported under another RP_ID', function () {
    $pk = new Passkey;
    $pk->userHandle = Passkey::b64u('cutcoach00000000');
    file_put_contents($this->dir.'/db.json', json_encode([
        'users' => [['id' => 'cutcoach00000000', 'name' => 'Coach', 'coach' => true]],
        'creds' => [['id' => $pk->credentialId, 'userId' => 'cutcoach00000000', 'publicKey' => $pk->coseKey(), 'counter' => 0]],
    ]));
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])->assertSuccessful()
        ->expectsOutputToContain('push and passkeys');

    config(['fitpal.rp_id' => 'other.example', 'fitpal.origin' => 'https://other.example']);
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify-only' => true])->assertFailed()
        ->expectsOutputToContain('a passkey is bound to coach.example, not to RP_ID (other.example)');
});

it('says when the live origin would break passkeys or the session cookie', function () {
    expect(CheckConfig::originProblems(true))->toBe([]);
    config(['fitpal.origin' => 'http://coach.example']);
    expect(CheckConfig::originProblems(false))->toBe([])
        ->and(CheckConfig::originProblems(true)[0])->toContain('is not https');
    config(['fitpal.rp_id' => 'example', 'fitpal.origin' => 'https://coach.example']);
    expect(CheckConfig::originProblems(true))->toBe([]);   // a parent domain is a valid RP_ID
    config(['fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173']);
    expect(CheckConfig::originProblems(false))->toBe([])
        ->and(CheckConfig::originProblems(true)[0])->toContain('still localhost');
});

it('says when SESSION_SECRET is not the Node secret, without printing either', function () {
    expect(CheckConfig::dataProblems())->toBe([]);   // the file's trailing newline does not count
    config(['fitpal.session_secret' => str_repeat('ef', 32)]);
    $problems = CheckConfig::dataProblems();
    expect($problems)->toHaveCount(1)
        ->and($problems[0])->toContain('SESSION_SECRET is not the secret')
        ->and($problems[0])->not->toContain(str_repeat('cd', 32))->not->toContain(str_repeat('ef', 32));
});

it('says when a new VAPID pair would strand the browsers already subscribed', function () {
    unlink($this->dir.'/vapid.json');
    expect(CheckConfig::dataProblems())->toBe([]);   // nobody subscribed: a new pair loses nothing

    $user = tap((new User)->forceFill(['id' => User::newId(), 'name' => 'Subscribed']))->save();
    PushSubscription::query()->forceCreate(['user_id' => $user->id,
        'endpoint' => 'https://push.example/1', 'endpoint_hash' => hash('sha256', 'https://push.example/1'),
        'p256dh' => 'k', 'auth' => 'a', 'created' => '2026-10-25T00:00:00.000Z']);
    expect(CheckConfig::dataProblems()[0])->toContain('no VAPID pair');
    config(['fitpal.vapid.public' => 'envPublic', 'fitpal.vapid.private' => 'envPrivate']);
    expect(CheckConfig::dataProblems())->toBe([]);
});

it('says when a live instance lets anyone register', function () {
    cutoverLive();
    config(['fitpal.invite_only' => false]);
    $this->artisan('fitpal:check-config')->assertFailed()->expectsOutputToContain('INVITE_ONLY is off');
});
