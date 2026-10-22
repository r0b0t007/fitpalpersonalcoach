<?php

// Invite codes (CHW-247): the landing lookup, redeeming from an existing account, a coach's own
// codes, the admin's general ones, and registration with a coach's code putting the new client on
// that coach's roster. The api/coach-smoke.sh sections are named as there.

use App\Models\Invite;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Tests\Support\Coaching;
use Tests\Support\Passkey;

beforeEach(function () {
    config([
        'fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173',
        'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost',
        'fitpal.invite_only' => true, 'fitpal.bootstrap_code' => '',
    ]);
    $this->f = Coaching::twoCoaches();
});

function mintAs(User $who, string $note = 'x', string $route = '/api/coach/invites/new'): string
{
    return test()->postJson($route, ['note' => $note], bearer($who))->assertOk()->json('invite.code');
}

function adminInvite(string $code): ?array
{
    return collect(test()->getJson('/api/admin/invites', bearer(test()->f->admin))->json('invites'))->firstWhere('code', $code);
}

it('== taking a client on: minting ==', function () {
    $this->postJson('/api/coach/invites/new', [])->assertStatus(401);
    $this->postJson('/api/coach/invites/new', [], bearer($this->f->a1))->assertStatus(403)->assertExactJson(['error' => 'forbidden']);
    $res = $this->postJson('/api/coach/invites/new', ['note' => 'for Nadia'], bearer($this->f->a))->assertOk()->json('invite');
    expect($res['code'])->toMatch('/^[0-9A-F]{16}$/')
        ->and($res)->toMatchArray(['note' => 'for Nadia', 'createdBy' => $this->f->a->id, 'coachId' => $this->f->a->id])
        ->and($res['created'])->toMatch('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/')
        ->and(adminInvite($res['code'])['coachId'])->toBe($this->f->a->id);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.invite.create', 'uid' => $this->f->a->id, 'msg' => $res['code']]);
});

it('== an admin\'s own code must NOT bind anyone ==', function () {
    $code = mintAs($this->f->admin, 'general', '/api/admin/invites/new');
    expect(adminInvite($code))->not->toHaveKey('coachId');
    $this->getJson('/api/invite?code='.$code)->assertOk()->assertExactJson(['coachName' => null, 'full' => false]);
});

it('== listing is scoped to the coach, not the gym ==', function () {
    $mine = mintAs($this->f->a);
    $general = mintAs($this->f->admin, 'g', '/api/admin/invites/new');
    $codesOf = fn (User $c) => array_column($this->getJson('/api/coach/invites', bearer($c))->assertOk()->json('invites'), 'code');
    expect($codesOf($this->f->a))->toContain($mine)->toContain('INVA0000000000')->not->toContain($general)->not->toContain('INVB0000000000')
        ->and($codesOf($this->f->b))->not->toContain($mine);
    $this->getJson('/api/coach/invites', bearer($this->f->a))->assertJsonPath('max', 20);
});

it('== revoking is scoped too, and says nothing about what it will not touch ==', function () {
    $f = $this->f;
    $code = mintAs($f->a);
    $general = mintAs($f->admin, 'g', '/api/admin/invites/new');
    $rev = fn (User $who, string $c) => $this->postJson('/api/coach/invites/revoke', ['code' => $c], bearer($who));
    $rev($f->b, $code)->assertStatus(404)->assertExactJson(['error' => 'no such code']);
    $rev($f->b, 'AAAAAAAAAAAAAAAA')->assertStatus(404)->assertExactJson(['error' => 'no such code']);
    $rev($f->a, $general)->assertStatus(404);
    $rev($f->a, strtolower($code))->assertOk()->assertExactJson(['ok' => true]);   // upper-cased, as Node
    $row = collect($this->getJson('/api/coach/invites', bearer($f->a))->json('invites'))->firstWhere('code', $code);
    expect($row['revoked'])->toBeTrue()
        ->and(adminInvite($code))->toMatchArray(['revoked' => true])->toHaveKey('revokedAt');
});

it('== a used code names the redeemer only while they are still yours ==', function () {
    $f = $this->f;
    Invite::query()->whereKey('INVA0000000000')->update(['used_by' => $f->a1->id, 'used_at' => '2026-05-02T00:00:00.000Z']);
    (new Invite)->forceFill(['code' => 'REDEEMEDTHEIRS00', 'note' => '', 'created_by' => $f->a->id, 'coach_id' => $f->a->id,
        'created' => '2026-05-01T00:00:00.000Z', 'used_by' => $f->b1->id, 'used_at' => '2026-05-03T00:00:00.000Z'])->save();
    $list = collect($this->getJson('/api/coach/invites', bearer($f->a))->json('invites'))->keyBy('code');
    expect($list['INVA0000000000'])->toMatchArray(['usedByName' => 'Client A1', 'usedAt' => '2026-05-02T00:00:00.000Z'])
        ->and($list['REDEEMEDTHEIRS00'])->toMatchArray(['usedByName' => null, 'usedAt' => '2026-05-03T00:00:00.000Z']);
});

it('== an invite link, before you have an account ==', function () {
    $code = mintAs($this->f->a);
    $this->getJson('/api/invite?code='.$code)->assertOk()->assertExactJson(['coachName' => 'Coach A', 'full' => false]);
    $this->getJson('/api/invite?code='.strtolower($code).'%20')->assertOk();   // lower-cased, trailing space
    Invite::query()->whereKey('INVB0000000000')->update(['used_by' => $this->f->b1->id]);
    foreach (['INVB0000000000', 'NOSUCHCODE000000', ''] as $c) {
        $this->getJson('/api/invite?code='.$c)->assertStatus(404)->assertExactJson(['error' => 'this invite link is not valid any more']);
    }
    $this->getJson('/api/invite')->assertStatus(404);
    // A coach demoted since minting: the screen does not promise them.
    $this->f->a->forceFill(['coach' => false])->save();
    $this->getJson('/api/invite?code='.$code)->assertOk()->assertExactJson(['coachName' => null, 'full' => false]);
});

it('== redeeming one from an account you already have ==', function () {
    $f = $this->f;
    $code = mintAs($f->a);
    $general = mintAs($f->admin, 'g', '/api/admin/invites/new');
    $redeem = fn (?User $who, string $c) => $this->postJson('/api/invite/redeem', ['code' => $c], $who ? bearer($who) : []);
    $redeem(null, $code)->assertStatus(401);
    $redeem($f->b1, $code)->assertStatus(409)->assertExactJson(['error' => 'you already have a coach — they can release you first']);
    $redeem($f->u1, $general)->assertStatus(400)->assertExactJson(['error' => 'this code does not belong to a coach']);
    $this->getJson('/api/invite?code='.$general)->assertOk();   // still live
    $redeem($f->u1, $code)->assertOk()->assertJsonPath('user.coachName', 'Coach A');
    expect($f->u1->fresh()->coach_id)->toBe($f->a->id)
        ->and(Invite::query()->find($code)->used_by)->toBe($f->u1->id);
    $this->getJson('/api/invite?code='.$code)->assertStatus(404);
    $this->assertDatabaseHas('audit_events', ['ev' => 'invite.redeem', 'uid' => $f->u1->id, 'msg' => $code]);
    // A second person cannot reuse it.
    $other = tap((new User)->forceFill(['id' => 'tOther0000000000', 'name' => 'Other']))->save();
    $redeem($other, $code)->assertStatus(404);
});

it('refuses a coach their own link, and leaves it unspent', function () {
    $code = mintAs($this->f->a);
    $this->postJson('/api/invite/redeem', ['code' => $code], bearer($this->f->a))->assertStatus(400)->assertExactJson(['error' => 'that is your own invite link']);
    $this->getJson('/api/invite?code='.$code)->assertOk();
});

it('== revoking an invite keeps the record ==', function () {
    $code = mintAs($this->f->admin, 'for Sara', '/api/admin/invites/new');
    expect(adminInvite($code)['note'])->toBe('for Sara');
    $this->postJson('/api/admin/invites/revoke', ['code' => $code], bearer($this->f->admin))->assertOk();
    expect(adminInvite($code)['revoked'])->toBeTrue();
    // A used code is history, not a key.
    Invite::query()->whereKey('INVB0000000000')->update(['used_by' => $this->f->b1->id]);
    $this->postJson('/api/admin/invites/revoke', ['code' => 'INVB0000000000'], bearer($this->f->admin))
        ->assertStatus(400)->assertExactJson(['error' => 'already used — cannot revoke']);
    $this->postJson('/api/admin/invites/revoke', ['code' => 'NOPE'], bearer($this->f->admin))->assertStatus(404);
    $this->getJson('/api/admin/invites', bearer($this->f->a))->assertStatus(403);
});

it('sends the admin each invite as Node stored it: absent fields absent', function () {
    $code = mintAs($this->f->admin, 'general', '/api/admin/invites/new');
    $row = adminInvite($code);
    expect(array_keys($row))->toEqualCanonicalizing(['code', 'note', 'createdBy', 'created', 'usedByName'])
        ->and($row['usedByName'])->toBeNull();
    $this->getJson('/api/admin/invites', bearer($this->f->admin))->assertJsonPath('invite_only', true);
});

it('caps a coach at 20 open codes', function () {
    $f = $this->f;
    foreach (range(1, 19) as $i) {   // the fixture already gave A one
        mintAs($f->a, "n$i");
    }
    $this->postJson('/api/coach/invites/new', [], bearer($f->a))->assertStatus(429)
        ->assertJsonPath('error', 'you already have 20 unused codes — revoke one before making another')
        ->assertJsonPath('msg', ['k' => 'you already have {0} unused codes — revoke one before making another', 'v' => [20]]);
});

it('puts a client who registers with a coach\'s code on that coach\'s roster', function () {
    $code = mintAs($this->f->a);
    $res = (new Passkey)->register($this, 'Nadia', strtolower($code))->assertOk();
    $user = User::query()->find($res->json('user.id'));
    expect($user->coach_id)->toBe($this->f->a->id)
        ->and($user->invited_by)->toBe($code)
        ->and($res->json('user.coachName'))->toBe('Coach A');
    $invite = Invite::query()->find($code);
    expect($invite->used_by)->toBe($user->id)->and($invite->used_at)->toBe($user->createdIso());
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.ok', 'uid' => $user->id, 'msg' => $code]);
    // Spent: the next person is refused on an invite-only instance.
    (new Passkey)->register($this, 'Second', $code)->assertStatus(403);
});

it('registers someone with a general code, or a demoted coach\'s, unassigned', function () {
    $general = mintAs($this->f->admin, 'g', '/api/admin/invites/new');
    $res = (new Passkey)->register($this, 'General', $general)->assertOk();
    expect(User::query()->find($res->json('user.id'))->coach_id)->toBeNull();

    $code = mintAs($this->f->a);
    $this->f->a->forceFill(['disabled' => true])->save();
    $res = (new Passkey)->register($this, 'Late', $code)->assertOk();
    expect(User::query()->find($res->json('user.id'))->coach_id)->toBeNull()
        ->and(Invite::query()->find($code)->used_by)->toBe($res->json('user.id'));   // still spent
});

it('applies a coach\'s code on an open instance too', function () {
    config(['fitpal.invite_only' => false]);
    $code = mintAs($this->f->b);
    $res = (new Passkey)->register($this, 'Open', $code)->assertOk();
    expect(User::query()->find($res->json('user.id'))->coach_id)->toBe($this->f->b->id);
    // A spent code on an open instance does not fail the signup.
    (new Passkey)->register($this, 'Late', $code)->assertOk()->assertJsonPath('user.coachName', null);
    expect(DB::table('users')->where('name', 'Late')->value('coach_id'))->toBeNull();
});

it('reads the note and the revoked code as Node did: untrimmed, coerced like String(x || \'\')', function () {
    $f = $this->f;
    // TrimStrings has trimmed the request by the time a controller runs; Node never trimmed these.
    expect($this->postJson('/api/coach/invites/new', ['note' => '  for Nadia'], bearer($f->a))->json('invite.note'))->toBe('  for Nadia')
        ->and($this->postJson('/api/coach/invites/new', ['note' => 42], bearer($f->a))->json('invite.note'))->toBe('42')
        ->and($this->postJson('/api/coach/invites/new', ['note' => 0], bearer($f->a))->json('invite.note'))->toBe('');
    $code = mintAs($f->a);
    $this->postJson('/api/coach/invites/revoke', ['code' => " $code "], bearer($f->a))->assertStatus(404);   // padded: no such code
    $this->postJson('/api/coach/invites/revoke', ['code' => $code], bearer($f->a))->assertOk();
});

it('lists codes in mint order, even two minted in the same millisecond', function () {
    $f = $this->f;
    foreach (['ZZZZ000000000000', 'AAAA000000000000'] as $code) {
        Coaching::own(new Invite, $f->a, ['code' => $code, 'created_by' => $f->a->id, 'created' => '2026-06-01T00:00:00.000Z']);
    }
    $codes = array_column($this->getJson('/api/coach/invites', bearer($f->a))->json('invites'), 'code');
    expect($codes)->toBe(['INVA0000000000', 'ZZZZ000000000000', 'AAAA000000000000']);
});

it('refuses a mint that waited behind a detach: the coach is judged on the locked row', function (array $change, int $status) {
    $f = $this->f;
    // The request is past RequireCoach; then, while it waits for the coach's row, an admin's
    // detach commits. Simulated by changing the row just before the mint's first locked read.
    $done = false;
    DB::connection()->beforeExecuting(function (string $sql) use (&$done, $f, $change) {
        if (! $done && DB::transactionLevel() >= 2 && str_contains($sql, 'from "users"')) {
            $done = true;
            DB::table('users')->where('id', $f->a->id)->update($change);
        }
    });
    $this->postJson('/api/coach/invites/new', ['note' => 'late'], bearer($f->a))->assertStatus($status);
    expect($done)->toBeTrue()
        ->and(Invite::acrossCoaches()->where('note', 'late')->exists())->toBeFalse(); // across coaches: the test reads every row
})->with([
    'role revoked' => [['coach' => false], 403],
    'disabled' => [['disabled' => true], 401],
]);

it('locks the binding coach before the invite, the order a detach takes them in', function () {
    $f = $this->f;
    $code = $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($f->a))->json('invite.code');
    $reads = [];
    DB::listen(function ($q) use (&$reads, $f, $code) {
        if (str_starts_with($q->sql, 'select') && in_array($f->a->id, $q->bindings, true)) {
            $reads[] = 'coach';
        } elseif (str_starts_with($q->sql, 'select *') && in_array($code, $q->bindings, true)) {
            $reads[] = 'invite';
        }
    });
    $this->postJson('/api/invite/redeem', ['code' => $code], bearer($f->u1))->assertOk();
    expect(array_slice($reads, 0, 2))->toBe(['coach', 'invite']);
});

it('trims a code as JS did: a pasted NBSP or BOM is whitespace too', function () {
    $code = $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($this->f->a))->json('invite.code');
    $this->getJson('/api/invite?code=%C2%A0'.strtolower($code).'%EF%BB%BF')->assertOk()->assertJsonPath('coachName', 'Coach A');
    $this->postJson('/api/invite/redeem', ['code' => "\u{00A0}$code\u{2028}"], bearer($this->f->u1))->assertOk();
});

it('names a redeemer with no name as nobody on the admin list, as Node\'s `|| null` did', function () {
    $f = $this->f;
    $f->a1->forceFill(['name' => ''])->save();
    Invite::acrossCoaches()->whereKey('INVA0000000000')->update(['used_by' => $f->a1->id, 'used_at' => '2026-05-02T00:00:00.000Z']); // across coaches: the test writes a fixture row
    $row = collect($this->getJson('/api/admin/invites', bearer($f->admin))->json('invites'))->firstWhere('code', 'INVA0000000000');
    expect($row['usedByName'])->toBeNull();
});
