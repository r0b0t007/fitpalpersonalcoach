<?php

// Pairing the Android app (api/server.js pair/create, pair/redeem): the browser asks for a code,
// the phone redeems it once for the Bearer token it keeps.

use App\Auth\SessionToken;
use App\Http\Controllers\PairController;
use App\Models\User;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'http://localhost:5173']);
    $this->user = User::query()->create(['id' => 'pairing000000000', 'name' => 'Karim', 'coach' => true]);
    $this->bearer = ['Authorization' => 'Bearer '.SessionToken::make($this->user)];
});

it('needs a session to create a code', function () {
    $this->postJson('/api/pair/create')->assertStatus(401)->assertExactJson(['error' => 'not signed in']);
});

it('pairs a phone: the code gives a token that signs it in, and the whole public user', function () {
    $code = $this->postJson('/api/pair/create', [], $this->bearer)->assertOk()->json('code');
    expect($code)->toMatch('/^['.PairController::ALPHABET.']{8}$/');

    // The phone: another origin, no session, CSRF-exempt.
    $r = $this->postJson('/api/pair/redeem', ['code' => strtolower($code)], ['Origin' => 'https://localhost', 'Sec-Fetch-Site' => 'cross-site']);
    $r->assertOk()->assertJsonPath('user', $this->user->toPublic());
    $this->getJson('/api/me', ['Authorization' => 'Bearer '.$r->json('token')])->assertOk()->assertJsonPath('user.id', $this->user->id);

    expect(DB::table('audit_events')->orderBy('id')->pluck('ev')->all())->toBe(['auth.pair.create', 'auth.pair.ok']);
});

it('works once, expires after five minutes, and refuses a disabled account', function () {
    $code = $this->postJson('/api/pair/create', [], $this->bearer)->json('code');
    $this->postJson('/api/pair/redeem', ['code' => $code])->assertOk();
    $this->postJson('/api/pair/redeem', ['code' => $code])->assertStatus(400)->assertExactJson(['error' => 'invalid or expired code']);

    $late = $this->postJson('/api/pair/create', [], $this->bearer)->json('code');
    $this->travel(PairController::TTL + 1)->seconds();
    $this->postJson('/api/pair/redeem', ['code' => $late])->assertStatus(400);
    $this->travelBack();

    $code = $this->postJson('/api/pair/create', [], $this->bearer)->json('code');
    $this->user->update(['disabled' => true]);
    $this->postJson('/api/pair/redeem', ['code' => $code])->assertStatus(400)->assertExactJson(['error' => 'invalid or expired code']);

    expect(DB::table('audit_events')->where('ev', 'auth.pair.fail')->pluck('msg')->all())->toBe(['code-invalid', 'code-invalid', 'user-unavailable']);
});

it('refuses a missing, empty or non-string code the same way', function ($body) {
    $this->postJson('/api/pair/redeem', $body)->assertStatus(400)->assertExactJson(['error' => 'invalid or expired code']);
})->with([[[]], [['code' => '']], [['code' => ['X']]]]);

it('draws codes evenly from the 32-letter alphabet', function () {
    expect(strlen(PairController::ALPHABET))->toBe(32)
        ->and(PairController::ALPHABET)->not->toMatch('/[01IO]/');
    $seen = count_chars(implode('', array_map(fn () => PairController::newCode(), range(1, 400))), 3);
    expect(strlen($seen))->toBe(32);   // every letter shows up in 3,200 draws
});

it('lets only one of two racing phones claim a code', function () {
    $code = $this->postJson('/api/pair/create', [], $this->bearer)->json('code');
    // The other phone is mid-claim: it holds the claim lock. This one is refused, the code survives.
    $claim = cache()->lock('pair:claim:'.$code, 10);
    expect($claim->get())->toBeTrue();
    $this->postJson('/api/pair/redeem', ['code' => $code])->assertStatus(400);
    $claim->release();
    // The winner completes its claim; after that the code is spent for everyone.
    $this->postJson('/api/pair/redeem', ['code' => $code])->assertOk();
    $this->postJson('/api/pair/redeem', ['code' => $code])->assertStatus(400);
});
