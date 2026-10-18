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
