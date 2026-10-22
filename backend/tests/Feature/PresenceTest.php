<?php

// Live presence (CHW-262): POST /api/activity, `live` on the coach's roster and the admin's user
// list, the 70 s TTL, and an account disabled dropping off at once (api/server.js 957-968, 1449).

use App\Http\Controllers\ActivityController;
use App\Models\Presence;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
});

function heartbeat(User $who, array $body): void
{
    test()->postJson('/api/activity', $body, bearer($who))->assertExactJson(['ok' => true]);
}

function liveOnRoster(User $coach, User $member): mixed
{
    return collect(test()->getJson('/api/coach/members', bearer($coach))->assertOk()->json('members'))->firstWhere('id', $member->id)['live'];
}

it('shows a client as training while the heartbeat lasts, and not after', function () {
    $f = $this->f;
    $this->freezeTime();
    $started = now()->subMinutes(12)->getTimestampMs();
    heartbeat($f->a1, ['active' => true, 'name' => str_repeat('Push day ', 10), 'exIdx' => 2, 'exTotal' => 5, 'setsDone' => '7', 'setsTotal' => 15, 'startedAt' => $started]);
    expect(liveOnRoster($f->a, $f->a1))->toBe([
        'name' => mb_substr(str_repeat('Push day ', 10), 0, 60), 'exIdx' => 2, 'exTotal' => 5, 'setsDone' => 7, 'setsTotal' => 15,
        'startedAt' => $started, 'updatedAt' => now()->getTimestampMs(),
    ]);
    // The admin's list shows the same object.
    $users = collect($this->getJson('/api/admin/users', bearer($f->admin))->json('users'))->keyBy('id');
    expect($users[$f->a1->id]['live']['setsDone'])->toBe(7)->and($users[$f->a2->id]['live'])->toBeNull();
    // 70 s after the last ping it is over, even with no "left".
    $this->travel(Presence::TTL_MS + 1)->milliseconds();
    expect(liveOnRoster($f->a, $f->a1))->toBeNull();
});

it('reads the heartbeat as Node did: `+x || 0`, `+startedAt || now`, the name cut at 60', function () {
    $a1 = $this->f->a1;
    $this->freezeTime();
    heartbeat($a1, ['active' => 1, 'name' => 42, 'exIdx' => 'abc', 'exTotal' => null, 'setsDone' => 1.5, 'setsTotal' => ['3'], 'startedAt' => 0]);
    expect(liveOnRoster($this->f->a, $a1))->toBe([
        'name' => '42', 'exIdx' => 0, 'exTotal' => 0, 'setsDone' => 1.5, 'setsTotal' => 3,
        'startedAt' => now()->getTimestampMs(), 'updatedAt' => now()->getTimestampMs(),
    ]);
});

it('takes them off when they leave, by fetch or by beacon', function () {
    $a1 = $this->f->a1;
    heartbeat($a1, ['active' => true, 'name' => 'Legs']);
    heartbeat($a1, ['active' => false]);
    expect(liveOnRoster($this->f->a, $a1))->toBeNull();
    $this->travel(Presence::LEFT_HOLD_MS + 1)->milliseconds();
    heartbeat($a1, ['active' => true, 'name' => 'Legs']);
    expect(liveOnRoster($this->f->a, $a1))->not->toBeNull();
    // navigator.sendBeacon: the session cookie, a JSON blob, same-origin — and no Bearer header.
    $token = substr(bearer($a1)['Authorization'], strlen('Bearer '));
    $this->call('POST', '/api/activity', [], ['gymsid' => $token], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_SEC_FETCH_SITE' => 'same-origin'], '{"active":false}')
        ->assertOk();
    expect(Presence::current()->count())->toBe(0);
    $this->postJson('/api/activity', ['active' => true])->assertStatus(401);
});

it('drops an account the admin disables off "training now" at once', function () {
    $f = $this->f;
    heartbeat($f->a1, ['active' => true, 'name' => 'Legs']);
    $this->postJson('/api/admin/user/disable', ['id' => $f->a1->id, 'disabled' => true], bearer($f->admin))->assertOk();
    expect(Presence::query()->count())->toBe(0);
});

it('does not let a heartbeat already on its way undo a "left"', function () {
    $a1 = $this->f->a1;
    $this->freezeTime();
    heartbeat($a1, ['active' => true, 'name' => 'Legs']);
    heartbeat($a1, ['active' => false]);
    // The 20 s ping, sent before the "left" but served after it.
    heartbeat($a1, ['active' => true, 'name' => 'Legs']);
    expect(liveOnRoster($this->f->a, $a1))->toBeNull();
    // A new workout a little later shows again.
    $this->travel(Presence::LEFT_HOLD_MS + 1)->milliseconds();
    heartbeat($a1, ['active' => true, 'name' => 'Arms']);
    expect(liveOnRoster($this->f->a, $a1)['name'])->toBe('Arms');
});

it('lets no heartbeat put a disabled account back on "training now"', function () {
    $a1 = $this->f->a1;
    $a1->forceFill(['disabled' => true])->save();
    // As if it had passed the guard a moment before the disable committed.
    $this->actingAs($a1, 'api');
    app(ActivityController::class)->store(Request::create('/api/activity', 'POST', [], [], [], ['CONTENT_TYPE' => 'application/json'], '{"active":true,"name":"Legs"}')->setUserResolver(fn () => $a1));
    expect(Presence::query()->count())->toBe(0);
});

it('writes a whole number as JS does, up to what an int holds', function () {
    $a1 = $this->f->a1;
    heartbeat($a1, ['active' => true, 'startedAt' => 9.0e18, 'setsDone' => 2 ** 60]);
    $body = $this->getJson('/api/coach/members', bearer($this->f->a))->getContent();
    expect($body)->toContain('"startedAt":9000000000000000000')->toContain('"setsDone":1152921504606846976');
});

it('loads presence once for a whole list', function () {
    heartbeat($this->f->a1, ['active' => true]);
    heartbeat($this->f->a2, ['active' => true]);
    $queries = 0;
    DB::listen(function ($q) use (&$queries) {
        $queries += str_contains($q->sql, '"presence"') ? 1 : 0;
    });
    $this->getJson('/api/admin/users', bearer($this->f->admin))->assertOk();
    $this->getJson('/api/coach/members', bearer($this->f->a))->assertOk();
    expect($queries)->toBe(2);
});
