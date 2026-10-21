<?php

// The sign-in and pairing routes read their body as Node's readBody did (CHW-252): text that is
// not JSON is 400 `bad json` and a body over 5 MB is 413 — at the point Node read it, before any
// field is looked at — and what is read is the body as sent, not Laravel's trimmed input.

use App\Auth\SessionToken;
use App\Models\User;
use Illuminate\Testing\TestResponse;

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

it('takes a pairing code padded as a chat app pads it', function () {
    $user = User::query()->create(['id' => 'pairbody00000000', 'name' => 'Karim']);
    $code = $this->postJson('/api/pair/create', [], ['Authorization' => 'Bearer '.SessionToken::make($user)])->json('code');
    $this->postJson('/api/pair/redeem', ['code' => "\u{00A0}".strtolower($code)."\u{FEFF}"])->assertOk();
});
