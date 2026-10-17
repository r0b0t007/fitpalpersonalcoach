<?php

// Registration, login and the session, with a software authenticator that posts what the React
// app posts. The messages asserted verbatim are translation keys in the app.

use App\Auth\SessionToken;
use App\Models\User;
use App\WebAuthn\LegacyCredential;
use Laragear\WebAuthn\Models\WebAuthnCredential;
use Tests\Support\Passkey;

beforeEach(function () {
    config(['fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173', 'fitpal.session_secret' => str_repeat('ab', 32)]);
    // The package reads its own keys; AppServiceProvider copied them at boot, before this config().
    config(['webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'http://localhost:5173']);
});

it('issues base64url options the app can decode, with a resident key required', function () {
    $r = $this->postJson('/api/register/options', ['name' => 'Nadia']);
    $r->assertOk()->assertJsonStructure(['cid', 'options' => ['rp' => ['id', 'name'], 'user' => ['id', 'name', 'displayName'], 'challenge', 'pubKeyCredParams', 'authenticatorSelection']]);
    $o = $r->json('options');
    expect($o['rp']['id'])->toBe('localhost')
        ->and($o['authenticatorSelection']['residentKey'])->toBe('required')
        ->and($o['authenticatorSelection']['userVerification'])->toBe('preferred')
        ->and($o['attestation'])->toBe('none')
        ->and($o['user']['id'])->toMatch('/^[A-Za-z0-9_-]+$/')
        ->and(base64_decode(strtr($o['user']['id'], '-_', '+/')))->toHaveLength(16)   // the account id's ASCII bytes
        ->and($o['challenge'])->toMatch('/^[A-Za-z0-9_-]+$/');
});

it('refuses an empty name', function () {
    $this->postJson('/api/register/options', ['name' => '  '])->assertStatus(400)->assertExactJson(['error' => 'name required']);
});

it('creates the account and the credential together and signs the browser in', function () {
    $pk = new Passkey;
    $r = $pk->register($this, 'Nadia El Amrani');
    $r->assertOk()->assertJson(['user' => ['name' => 'Nadia El Amrani', 'admin' => false, 'coach' => false, 'coachName' => null]]);
    $uid = $r->json('user.id');
    expect($uid)->toHaveLength(16)
        ->and(User::query()->find($uid)?->name)->toBe('Nadia El Amrani')
        ->and(WebAuthnCredential::query()->find($pk->credentialId)?->authenticatable_id)->toBe($uid)
        ->and(WebAuthnCredential::query()->find($pk->credentialId)?->user_id)->toBe($pk->userHandle);

    $cookie = $r->getCookie('gymsid', false);
    expect($cookie)->not->toBeNull()
        ->and($cookie->isHttpOnly())->toBeTrue()
        ->and($cookie->getSameSite())->toBe('lax')
        ->and(SessionToken::user($cookie->getValue())?->id)->toBe($uid);
});

it('logs in with a discoverable credential, updates the counter, and the session reaches /me', function () {
    // First, with nothing: the test client keeps cookies and headers once set, so this goes first.
    $this->getJson('/api/me')->assertStatus(401)->assertExactJson(['error' => 'not signed in']);

    $pk = new Passkey;
    $pk->register($this, 'Karim')->assertOk();
    $r = $pk->login($this);
    $r->assertOk()->assertJsonPath('user.name', 'Karim');
    expect(WebAuthnCredential::query()->find($pk->credentialId)->counter)->toBe(1);

    $token = $r->getCookie('gymsid', false)->getValue();
    // JSON test requests carry cookies only with withCredentials(); the cookie itself is raw.
    $this->withCredentials()->withUnencryptedCookie('gymsid', $token)->getJson('/api/me')->assertOk()->assertJsonPath('user.name', 'Karim');
    $this->withHeader('Authorization', 'Bearer '.$token)->getJson('/api/me')->assertOk();
});

it('refuses an unknown passkey, a spent challenge and a replayed counter', function () {
    $pk = new Passkey;
    $pk->register($this, 'Sara')->assertOk();

    $stranger = new Passkey;
    $stranger->login($this)->assertStatus(404)->assertExactJson(['error' => 'unknown passkey — create a profile first']);

    $options = $this->postJson('/api/login/options', [])->json();
    $this->postJson('/api/login/verify', ['cid' => $options['cid'], 'credential' => $pk->assert($options['options'])])->assertOk();
    $this->postJson('/api/login/verify', ['cid' => $options['cid'], 'credential' => $pk->assert($options['options'])])
        ->assertStatus(400)->assertExactJson(['error' => 'challenge expired — try again']);

    // A cloned authenticator replays an old counter: refused, and the reason is the library's.
    $pk->counter = 0;
    $pk->login($this)->assertStatus(400)->assertJsonPath('msg.k', 'verification failed: {0}');
});

it('rejects a credential whose handle names another account', function () {
    $pk = new Passkey;
    $pk->register($this, 'Lina')->assertOk();
    $pk->login($this, withUserHandle: Passkey::b64u('someone-else-123'))->assertStatus(400)->assertJsonPath('msg.k', 'verification failed: {0}');
    // No handle at all (an old non-resident key) is fine, as the Node API never checked it.
    $pk->login($this, withUserHandle: '')->assertOk();
});

it('names the deployment mistake when the origin does not match', function () {
    $pk = new Passkey(origin: 'https://evil.example');
    $r = $pk->register($this, 'Omar');
    $r->assertStatus(400);
    expect($r->json('msg.k'))->toBe('{0} — this server is configured with RP_ID={1} and ORIGIN={2}, and both must match the address you opened. See docs/SELF_HOSTING.md.')
        ->and($r->json('msg.v.1'))->toBe('localhost')
        ->and($r->json('msg.v.2'))->toBe('http://localhost:5173');
});

it('keeps a disabled account out, and signs out everywhere by bumping the session version', function () {
    $pk = new Passkey;
    $uid = $pk->register($this, 'Youssef')->json('user.id');
    $token = SessionToken::make(User::query()->find($uid));

    $this->withHeader('Authorization', 'Bearer '.$token)->postJson('/api/logout/all')->assertOk();
    $this->withHeader('Authorization', 'Bearer '.$token)->getJson('/api/me')->assertStatus(401);
    $pk->login($this)->assertOk();   // the passkey still works; only the old tokens died

    User::query()->whereKey($uid)->update(['disabled' => true]);
    $pk->login($this)->assertStatus(403)->assertExactJson(['error' => 'this account has been disabled']);
});

it('logs in with a credential imported from the Node API (COSE key, legacy handle)', function () {
    // What db.json held: the COSE public key base64url, the counter, the user handle = ASCII uid.
    $pk = new Passkey;
    $uid = 'q1w2e3r4t5y6u7i8';
    $pk->userHandle = Passkey::b64u($uid);
    $user = User::query()->create(['id' => $uid, 'name' => 'Imported']);
    LegacyCredential::import($user, ['id' => $pk->credentialId, 'publicKey' => $pk->coseKey(), 'counter' => 4, 'transports' => ['internal']]);

    $pk->counter = 4;
    $pk->login($this)->assertOk()->assertJsonPath('user.name', 'Imported');
    expect(WebAuthnCredential::query()->find($pk->credentialId)->counter)->toBe(5);
});
