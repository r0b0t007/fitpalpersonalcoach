<?php

// Every coach route, walked across the tenant boundary (spec §5). Coach A asks for coach B's
// things; the answer must be the Node API's for "not yours" — a 403 for a member (the same as for
// nobody, so accounts cannot be enumerated), a 404 for a scoped row, and absence from a list — and
// nothing of B's may change. Then the admin, who on a coach route is scoped to their OWN rows but
// may read and act on any member.
//
// Each R2/R3 coach route adds its rows here. A route missing from this file has not been checked
// across tenants.

use App\Models\Assignment;
use App\Models\CoachProgram;
use App\Models\Invite;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
});

/** [method, path, body] — `{b1}` is coach B's client. */
dataset('coach routes on B\'s client', [
    'GET coach/member' => ['GET', '/api/coach/member?id={b1}', null],
    'POST coach/member/release' => ['POST', '/api/coach/member/release', ['id' => '{b1}']],
]);

it('refuses coach A on coach B\'s client, as it refuses on nobody', function (string $method, string $path, ?array $body) {
    $b1 = $this->f->b1->id;
    $fill = fn ($v) => is_string($v) ? str_replace('{b1}', $b1, $v) : $v;
    $this->json($method, $fill($path), array_map($fill, $body ?? []), bearer($this->f->a))
        ->assertStatus(403)->assertExactJson(['error' => 'forbidden']);
    expect($this->f->b1->fresh()->coach_id)->toBe($this->f->b->id)
        ->and(Assignment::query()->find('assignB')->status)->toBe('pending');
})->with('coach routes on B\'s client');

it('leaves coach B\'s clients out of coach A\'s lists', function () {
    $roster = collect($this->getJson('/api/coach/members', bearer($this->f->a))->json('members'));
    expect($roster->pluck('id'))->not->toContain($this->f->b1->id)
        // A's own client, offered a program by B: the card shows A's offers only.
        ->and($roster->firstWhere('id', $this->f->a1->id)['pending'])->toHaveCount(1)
        ->and($roster->firstWhere('id', $this->f->a1->id)['pending'][0]['coachId'])->toBe($this->f->a->id);
});

it('lets an admin reach any member on a coach route', function (string $method, string $path, ?array $body) {
    $b1 = $this->f->b1->id;
    $fill = fn ($v) => is_string($v) ? str_replace('{b1}', $b1, $v) : $v;
    $this->json($method, $fill($path), array_map($fill, $body ?? []), bearer($this->f->admin))->assertOk();
})->with('coach routes on B\'s client');

// Scoped rows: another coach's row is not found — the same 404 a made-up id gets — and unchanged.
it('answers coach A on coach B\'s invite code as on a made-up one, and changes nothing', function () {
    $this->postJson('/api/coach/invites/revoke', ['code' => 'INVB0000000000'], bearer($this->f->a))
        ->assertStatus(404)->assertExactJson(['error' => 'no such code']);
    expect(Invite::query()->find('INVB0000000000')->revoked)->toBeFalse();
});

it('leaves coach B\'s and the admin\'s codes out of coach A\'s list', function () {
    $codes = array_column($this->getJson('/api/coach/invites', bearer($this->f->a))->json('invites'), 'code');
    expect($codes)->toBe(['INVA0000000000']);
});

it('scopes an admin on the coach invite routes to their own codes, as Node did', function () {
    $codes = array_column($this->getJson('/api/coach/invites', bearer($this->f->admin))->json('invites'), 'code');
    expect($codes)->toBe(['INVADMIN0000000000']);
    $this->postJson('/api/coach/invites/revoke', ['code' => 'INVB0000000000'], bearer($this->f->admin))->assertStatus(404);
});

it('answers coach A on coach B\'s program as on a made-up one, and changes nothing', function () {
    $this->postJson('/api/coach/programs/delete', ['id' => 'prog-b'], bearer($this->f->a))
        ->assertStatus(404)->assertExactJson(['error' => 'no such program']);
    // Saving under B's program id gives A a program of their own (ids are unique per coach).
    $this->postJson('/api/coach/programs/save', ['id' => 'prog-b', 'name' => 'Mine', 'bundle' => ['opengym_plan' => 1, 'routines' => [['id' => 'r', 'ex' => []]]]], bearer($this->f->a))->assertOk();
    expect(CoachProgram::query()->where('program_id', 'prog-b')->pluck('name')->sort()->values()->all())->toBe(['Mine', 'Program b'])
        ->and(array_column($this->getJson('/api/coach/programs', bearer($this->f->a))->json('programs'), 'id'))->toBe(['prog-a', 'prog-b'])
        ->and(array_column($this->getJson('/api/coach/programs', bearer($this->f->b))->json('programs'), 'name'))->toBe(['Program b']);
});
