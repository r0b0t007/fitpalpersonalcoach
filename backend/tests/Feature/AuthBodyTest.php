<?php

// The sign-in and pairing routes read their body as Node's readBody did (CHW-252): text that is
// not JSON is 400 `bad json` and a body over 5 MB is 413 — at the point Node read it, before any
// field is looked at — and what is read is the body as sent, not Laravel's trimmed input.

use App\Models\User;
use App\Support\Js;
use Illuminate\Testing\TestResponse;
use Tests\Support\Passkey;

beforeEach(function () {
    config(['fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173', 'fitpal.session_secret' => str_repeat('ab', 32)]);
    config(['webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost', 'fitpal.invite_only' => false]);
});

function rawPost(string $path, string $body): TestResponse
{
    return test()->call('POST', $path, [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'], $body);
}

it('answers a malformed or oversized body as Node did on every route that read one', function (string $path) {
    rawPost($path, '{"name":')->assertStatus(400)->assertExactJson(['error' => 'bad json']);
    rawPost($path, str_repeat(' ', 5 * 1024 * 1024 + 1))->assertStatus(413)->assertExactJson([
        'error' => 'request body is larger than the 5 MB limit',
        'msg' => ['k' => 'request body is larger than the {0} MB limit', 'v' => [5]],
    ]);
})->with(['/api/register/options', '/api/register/verify', '/api/login/verify', '/api/pair/redeem']);

it('ignores the body where Node never read one: login options', function () {
    rawPost('/api/login/options', '{nope')->assertOk()->assertJsonStructure(['cid', 'options']);
});

it('reads the name as String(name).trim().slice(0, 40): JS whitespace, UTF-16 units', function () {
    $name = fn (string $raw) => test()->postJson('/api/register/options', ['name' => $raw])->assertOk()->json('options.user.name');
    expect($name("\u{00A0}Nadia\u{2028}"))->toBe('Nadia')
        // 21 emoji are 42 UTF-16 units: JS keeps 20 of them whole.
        ->and($name(str_repeat('💪', 21)))->toBe(str_repeat('💪', 20));
    $this->postJson('/api/register/options', ['name' => "\u{00A0}\u{FEFF}"])->assertStatus(400)->assertExactJson(['error' => 'name required']);
    $this->postJson('/api/register/options', ['name' => ['x']])->assertOk();   // String(['x']) is "x"
});

it('keeps what JS\'s trim keeps: U+0085 is not whitespace to JS', function () {
    $this->postJson('/api/register/options', ['name' => "Bob\u{0085}"])->assertOk()->assertJsonPath('options.user.name', "Bob\u{0085}");
    expect(Js::trim("\u{0085}\u{180E}\u{200B}x"))->toBe("\u{0085}\u{180E}\u{200B}x")
        ->and(Js::trim("\t\v\f\r\n \u{00A0}\u{1680}\u{2000}\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}x\u{FEFF}"))->toBe('x');
});

it('refuses a body with a key starting with NUL: a PHP object cannot hold one (documented)', function () {
    rawPost('/api/register/options', '{"name":"Bob","\u0000x":1}')->assertStatus(400)->assertExactJson(['error' => 'bad json']);
});

it('does not re-encode a credential nested past 64 levels: it is not a credential', function () {
    $cid = $this->postJson('/api/login/options')->json('cid');
    $deep = str_repeat('[', 1000).str_repeat(']', 1000);   // parses (PHP's limit is ~5,000), past the 64 cap
    rawPost('/api/login/verify', '{"cid":"'.$cid.'","credential":{"id":"x","response":'.$deep.'}}')
        ->assertStatus(404)->assertExactJson(['error' => 'unknown passkey — create a profile first']);
});

it('fails a malformed credential for a passkey it knows as a verification of that account, as Node did', function () {
    $pk = new Passkey;
    $pk->register($this, 'Nadia')->assertOk();
    $cid = $this->postJson('/api/login/options')->json('cid');
    // Too deep for the package (or an Infinity in it), but it names a real passkey.
    rawPost('/api/login/verify', '{"cid":"'.$cid.'","credential":{"id":"'.$pk->credentialId.'","response":{"x":1e400}}}')
        // A 400 verification failure with the library's reason (as Node's carried @simplewebauthn's),
        // not 404 "unknown passkey".
        ->assertStatus(400)->assertJsonPath('msg.k', 'verification failed: {0}');
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.login.fail', 'msg' => 'verify-error', 'name' => 'Nadia']);
});

it('refuses a multipart body as bad json: PHP keeps it from php://input, Node parsed its bytes', function () {
    $this->call('POST', '/api/register/options', ['name' => 'Bob'], [], [], ['CONTENT_TYPE' => 'multipart/form-data; boundary=x', 'CONTENT_LENGTH' => '40', 'HTTP_ACCEPT' => 'application/json'], '')
        ->assertStatus(400)->assertExactJson(['error' => 'bad json']);
    $this->call('POST', '/api/register/options', [], [], [], ['CONTENT_TYPE' => 'multipart/form-data; boundary=x', 'CONTENT_LENGTH' => (string) (6 * 1024 * 1024), 'HTTP_ACCEPT' => 'application/json'], '')
        ->assertStatus(413);
});

it('takes a pairing code padded as a chat app pads it', function () {
    $user = User::query()->create(['id' => 'pairbody00000000', 'name' => 'Karim']);
    $code = $this->postJson('/api/pair/create', [], bearer($user))->json('code');
    $this->postJson('/api/pair/redeem', ['code' => "\u{00A0}".strtolower($code)."\u{FEFF}"])->assertOk();
});
