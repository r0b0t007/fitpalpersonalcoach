<?php

// The cutover's one-way mistakes (R5, CHW-297), refused or named before they happen: an import on a
// live instance that is not deliberate, that runs twice, or that would bind every passkey to the
// wrong RP_ID, sign everyone out, or leave the media and push keys behind; and a live config that
// does the same without an import.

use App\Console\LiveChecks;
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

function cutoverSubscriber(): void
{
    $user = tap((new User)->forceFill(['id' => User::newId(), 'name' => 'Subscribed']))->save();
    PushSubscription::query()->forceCreate(['user_id' => $user->id,
        'endpoint' => 'https://push.example/1', 'endpoint_hash' => hash('sha256', 'https://push.example/1'),
        'p256dh' => 'k', 'auth' => 'a', 'created' => '2026-10-25T00:00:00.000Z']);
}

it('imports on a live instance once, when told it is the cutover', function () {
    cutoverLive();
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertFailed()
        ->expectsOutputToContain('--confirm-live')->expectsOutputToContain('nothing was imported');
    expect(User::query()->count())->toBe(0);

    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--confirm-live' => true])->assertSuccessful();
    expect(User::query()->find('cutcoach00000000'))->not->toBeNull();

    // Weeks later, the cutover script run again with its flag: the database says no.
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--confirm-live' => true])->assertFailed()
        ->expectsOutputToContain('already holds accounts');
});

it('refuses a live import under an origin the imported passkeys would not answer for', function (array $origin, string $said) {
    cutoverLive();
    config($origin);
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--confirm-live' => true])->assertFailed()
        ->expectsOutputToContain($said);
    expect(User::query()->count())->toBe(0);
})->with([
    'localhost' => [['fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173'], 'still a local address'],
    'loopback over https' => [['fitpal.rp_id' => '127.0.0.1', 'fitpal.origin' => 'https://127.0.0.1'], 'still a local address'],
    'plain http' => [['fitpal.origin' => 'http://coach.example'], 'is not https'],
    'another host' => [['fitpal.origin' => 'https://elsewhere.example'], 'is not the host of ORIGIN'],
    // Valid for a new registration, but Node registered these under the host itself.
    'a parent domain' => [['fitpal.rp_id' => 'example'], 'is not the host of ORIGIN'],
]);

it('refuses a live import that would sign everyone out, or leave media and push behind', function (array $config, string $said) {
    cutoverLive();
    config($config);
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--confirm-live' => true])->assertFailed()
        ->expectsOutputToContain($said)->expectsOutputToContain('nothing was imported');
    expect(User::query()->count())->toBe(0);
})->with([
    'another session secret' => [['fitpal.session_secret' => str_repeat('ef', 32)], 'SESSION_SECRET is not the secret'],
    'another data dir' => [['fitpal.data_dir' => sys_get_temp_dir().'/fitpal-elsewhere'], 'DATA_DIR'],
    'another VAPID pair' => [['fitpal.vapid.public' => 'envPublic', 'fitpal.vapid.private' => 'envPrivate'], 'VAPID_PUBLIC_KEY'],
]);

it('reads the host the way a browser does', function () {
    config(['fitpal.origin' => 'https://Coach.Example']);
    expect(LiveChecks::origin(true, exact: true))->toBe([]);
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
    expect(LiveChecks::origin(true))->toBe([]);
    config(['fitpal.origin' => 'http://coach.example']);
    expect(LiveChecks::origin(false))->toBe([])
        ->and(LiveChecks::origin(true)[0])->toContain('is not https');
    config(['fitpal.rp_id' => 'example', 'fitpal.origin' => 'https://coach.example']);
    expect(LiveChecks::origin(true))->toBe([]);   // a parent domain is a valid RP_ID for a new registration
    config(['fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173']);
    expect(LiveChecks::origin(false))->toBe([])
        ->and(LiveChecks::origin(true)[0])->toContain('still a local address');
});

it('says when SESSION_SECRET is not the Node secret, without printing either', function () {
    expect(LiveChecks::secret($this->dir))->toBe([]);   // the file's trailing newline does not count
    config(['fitpal.session_secret' => str_repeat('ef', 32)]);
    $problems = LiveChecks::secret($this->dir);
    expect($problems)->toHaveCount(1)
        ->and($problems[0])->toContain('SESSION_SECRET is not the secret')
        ->and($problems[0])->not->toContain(str_repeat('cd', 32))->not->toContain(str_repeat('ef', 32));
});

it('says when a new VAPID pair would strand the browsers already subscribed', function () {
    unlink($this->dir.'/vapid.json');
    expect(LiveChecks::vapid())->toBe([]);   // nobody subscribed: a new pair loses nothing

    cutoverSubscriber();
    expect(LiveChecks::vapid()[0])->toContain('no VAPID pair');
    // A file Vapid could not read is no pair either: it would mint over it.
    file_put_contents($this->dir.'/vapid.json', '');
    expect(LiveChecks::vapid()[0])->toContain('no usable vapid.json');
    config(['fitpal.vapid.public' => 'envPublic', 'fitpal.vapid.private' => 'envPrivate']);
    expect(LiveChecks::vapid())->toBe([]);
});

it('says when a live instance lets anyone register, once', function () {
    cutoverLive();
    config(['fitpal.invite_only' => false]);
    $this->artisan('fitpal:check-config')->assertFailed()->expectsOutputToContain('INVITE_ONLY is off: anyone');
    // With a bootstrap code, its own warning says it.
    config(['fitpal.bootstrap_code' => str_repeat('b', 20)]);
    $this->artisan('fitpal:check-config')->assertFailed()->doesntExpectOutputToContain('INVITE_ONLY is off: anyone')
        ->expectsOutputToContain('BOOTSTRAP_CODE is set but INVITE_ONLY is off');
});
