<?php

// The api/coach-smoke.sh sections R1 covers, by their names there, so the port's coverage can be
// read against the Node suite it replaces. Sections that need coaching routes (assigning,
// rosters, invites…) are ported with those routes in R2.

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Support\Passkey;

beforeEach(function () {
    config([
        'fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173', 'fitpal.session_secret' => str_repeat('ab', 32),
        'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost',
    ]);
    $this->coachB = User::query()->create(['id' => 'coachB0000000000', 'name' => 'Coach B', 'coach' => true]);
    $this->mem1 = User::query()->create(['id' => 'mem1000000000000', 'name' => 'Member 1']);
    $this->mem2 = User::query()->create(['id' => 'mem2000000000000', 'name' => 'Member 2', 'coach_id' => 'coachB0000000000']);
});

it('/api/me exposes the role', function () {
    // chk "coachB reports coach:true" / "mem2 reports coach:false" / "mem2 is told who their coach is"
    $this->getJson('/api/me', bearer($this->coachB))->assertOk()->assertJsonPath('user.coach', true);
    $this->getJson('/api/me', bearer($this->mem2))->assertOk()
        ->assertJsonPath('user.coach', false)
        ->assertJsonPath('user.coachName', 'Coach B');
    $this->getJson('/api/me', bearer($this->mem1))->assertJsonPath('user.coachName', null);
});

it('the state sync cap answers in JSON, not by hanging up', function () {
    // chk "a state push past the cap is a 413" / "...and the client can read why"
    $fat = json_encode(['state' => ['pad' => str_repeat('x', 17 * 1024 * 1024)]]);
    $r = $this->call('PUT', '/api/data', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => bearer($this->mem1)['Authorization']], $fat);
    $r->assertStatus(413);
    expect($r->json('error'))->toBeString()->toContain('MB');

    // chk "a state push above the general limit still saves": 8 MB is a food log, not a ceiling.
    $big = json_encode(['state' => ['_ts' => 1, 'pad' => str_repeat('x', 8 * 1024 * 1024)]]);
    $this->call('PUT', '/api/data', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_AUTHORIZATION' => bearer($this->mem2)['Authorization']], $big)
        ->assertOk();
});

it('the server must NOT have touched member state', function () {
    // In Node: no state file written for a member by anything but their own PUT /api/data. In R1
    // terms: signing up, signing in, reading /me, pairing a phone and signing out write no state.
    $pk = new Passkey;
    $uid = $pk->register($this, 'Fresh member')->json('user.id');
    $pk->login($this)->assertOk();
    $member = User::query()->find($uid);
    $this->getJson('/api/me', bearer($member))->assertOk();
    $code = $this->postJson('/api/pair/create', [], bearer($member))->json('code');
    $this->postJson('/api/pair/redeem', ['code' => $code])->assertOk();
    $this->getJson('/api/data', bearer($member))->assertOk()->assertExactJson(['state' => null]);
    $this->postJson('/api/logout', [], bearer($member))->assertOk();

    expect(DB::table('user_states')->where('user_id', $uid)->exists())->toBeFalse();
});
