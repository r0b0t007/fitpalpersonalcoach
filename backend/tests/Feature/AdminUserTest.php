<?php

// The owner's account controls (CHW-250): GET /api/admin/users, GET /api/admin/user, POST
// /api/admin/user/disable, /coach, /assign-coach, and detachCoach behind the last three. Test
// names starting with "==" are the api/coach-smoke.sh sections of the same name.

use App\Models\Assignment;
use App\Models\Invite;
use App\Models\User;
use App\Models\UserState;
use Illuminate\Testing\TestResponse;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
});

function admin(string $path, array $body): TestResponse
{
    return test()->postJson('/api/admin/user/'.$path, $body, bearer(test()->f->admin));
}

/** Where the fixture's tenant rows stand: [offer => status], [code => revoked reason or false]. */
function standing(): array
{
    return [
        Assignment::acrossCoaches()->orderBy('id')->pluck('status', 'id')->all(), // across coaches: the test reads every row
        Invite::acrossCoaches()->orderBy('code')->get()->mapWithKeys(fn (Invite $i) => [$i->code => $i->revoked ? $i->revoked_reason : false])->all(), // across coaches: the test reads every row
    ];
}

it('== admin role controls ==', function () {
    $f = $this->f;
    admin('coach', ['id' => $f->u1->id, 'coach' => true])->assertOk()->assertExactJson(['ok' => true, 'id' => $f->u1->id, 'coach' => true]);
    $this->postJson('/api/admin/user/coach', ['id' => $f->a1->id, 'coach' => true], bearer($f->a))->assertStatus(403);
    admin('assign-coach', ['id' => $f->u1->id, 'coachId' => $f->a->id])->assertOk()->assertExactJson(['ok' => true, 'id' => $f->u1->id, 'coachId' => $f->a->id]);
    admin('assign-coach', ['id' => $f->a1->id, 'coachId' => $f->a2->id])->assertStatus(400)->assertExactJson(['error' => 'that user is not a coach']);
    admin('assign-coach', ['id' => $f->u1->id, 'coachId' => $f->u1->id])->assertStatus(400)->assertExactJson(['error' => 'a member cannot be their own coach']);
    admin('assign-coach', ['id' => $f->a1->id, 'coachId' => 'nobody'])->assertStatus(400)->assertExactJson(['error' => 'that user is not a coach']);
    expect($f->u1->fresh()->coach_id)->toBe($f->a->id);
});

it('== revoking coach clears their roster ==', function () {
    $f = $this->f;
    admin('coach', ['id' => $f->a->id, 'coach' => false])->assertOk()->assertJsonPath('coach', false);
    expect(User::clientsOf($f->a)->count())->toBe(0);
    $this->getJson('/api/coach/members', bearer($f->a))->assertStatus(403);
    [$offers, $codes] = standing();
    expect($offers)->toBe(['assignA' => 'expired', 'assignB' => 'pending', 'assignBtoA1' => 'pending'])
        ->and($codes)->toBe(['INVA0000000000' => 'coach detached', 'INVADMIN0000000000' => false, 'INVB0000000000' => false]);
    // Re-granting does not hand the roster back.
    admin('coach', ['id' => $f->a->id, 'coach' => 1])->assertOk()->assertJsonPath('coach', true);
    expect(User::clientsOf($f->a)->count())->toBe(0);
});

it('keeps a code that was already used, and expires each offer once', function () {
    $f = $this->f;
    Invite::acrossCoaches()->whereKey('INVA0000000000')->update(['used_by' => $f->a1->id, 'used_at' => '2026-05-02T00:00:00.000Z']); // across coaches: the test writes a fixture row
    Assignment::acrossCoaches()->whereKey('assignA')->update(['status' => 'declined', 'decided_at' => '2026-05-02T00:00:00.000Z']); // across coaches: the test writes a fixture row
    admin('coach', ['id' => $f->a->id, 'coach' => false])->assertOk();
    [$offers, $codes] = standing();
    expect($offers['assignA'])->toBe('declined')->and($codes['INVA0000000000'])->toBeFalse();
});

it('detaches nothing from an admin whose coach flag goes off: they still coach', function () {
    $f = $this->f;
    $f->a1->forceFill(['coach_id' => $f->admin->id])->save();
    admin('coach', ['id' => $f->admin->id, 'coach' => false])->assertOk()->assertExactJson(['ok' => true, 'id' => $f->admin->id, 'coach' => false]);
    expect($f->a1->fresh()->coach_id)->toBe($f->admin->id)
        ->and(standing()[1]['INVADMIN0000000000'])->toBeFalse();
});

it('== a stale offer must not outlive the relationship ==', function () {
    $f = $this->f;
    admin('assign-coach', ['id' => $f->a1->id, 'coachId' => $f->b->id])->assertOk();
    // A's offer is retired; B's, now from a1's own coach, stands.
    expect(standing()[0])->toBe(['assignA' => 'expired', 'assignB' => 'pending', 'assignBtoA1' => 'pending'])
        ->and(Assignment::query()->find('assignA')->decided_at)->toMatch('/Z$/');
    $this->postJson('/api/assignments/decide', ['id' => 'assignBtoA1', 'accept' => true], bearer($f->a1))->assertOk();
    // Moving someone to the coach they already have expires nothing.
    admin('assign-coach', ['id' => $f->b1->id, 'coachId' => $f->b->id])->assertOk();
    expect(standing()[0]['assignB'])->toBe('pending');
});

it('unassigns a member when the coach is left blank, retiring only that coach\'s offers', function () {
    $f = $this->f;
    admin('assign-coach', ['id' => $f->a1->id, 'coachId' => '   '])->assertOk()->assertExactJson(['ok' => true, 'id' => $f->a1->id, 'coachId' => null]);
    expect($f->a1->fresh()->coach_id)->toBeNull()
        ->and(standing()[0])->toBe(['assignA' => 'expired', 'assignB' => 'pending', 'assignBtoA1' => 'pending']);
    admin('assign-coach', ['id' => $f->u1->id])->assertOk()->assertJsonPath('coachId', null);   // already had none
});

it('== disabling a coach must do what revoking the role does ==', function () {
    $f = $this->f;
    admin('disable', ['id' => $f->b->id, 'disabled' => true])->assertOk()->assertExactJson(['ok' => true, 'id' => $f->b->id, 'disabled' => true]);
    expect(User::clientsOf($f->b)->count())->toBe(0)
        ->and(standing())->toBe([
            ['assignA' => 'pending', 'assignB' => 'expired', 'assignBtoA1' => 'expired'],
            ['INVA0000000000' => false, 'INVADMIN0000000000' => false, 'INVB0000000000' => 'coach detached'],
        ]);
    $this->getJson('/api/coach/members', bearer($f->b))->assertStatus(401);
    admin('disable', ['id' => $f->b->id, 'disabled' => false])->assertOk()->assertJsonPath('disabled', false);
    expect(User::clientsOf($f->b)->count())->toBe(0);   // re-enabling does not resurrect the roster
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.disable', 'uid' => $f->admin->id, 'tgt' => $f->b->id, 'tname' => 'Coach B']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.enable', 'tgt' => $f->b->id]);
});

it('== a disabled coach cannot be attached to anything ==', function () {
    $f = $this->f;
    admin('disable', ['id' => $f->b->id, 'disabled' => true])->assertOk();
    admin('assign-coach', ['id' => $f->u1->id, 'coachId' => $f->b->id])->assertStatus(400)->assertExactJson(['error' => 'that coach is disabled']);
});

it('disables a member without touching anyone else, and never an admin', function () {
    $f = $this->f;
    admin('disable', ['id' => $f->a1->id, 'disabled' => 'yes'])->assertOk()->assertJsonPath('disabled', true);
    expect(standing()[0]['assignA'])->toBe('pending');
    admin('disable', ['id' => $f->admin->id, 'disabled' => true])->assertStatus(400)->assertExactJson(['error' => 'cannot disable an admin']);
});

it('answers an unknown account with no such user on every route', function () {
    foreach (['disable', 'coach', 'assign-coach'] as $path) {
        admin($path, ['id' => 'nobody', 'coachId' => $this->f->a->id])->assertStatus(404)->assertExactJson(['error' => 'no such user']);
        admin($path, ['id' => [$this->f->a1->id]])->assertStatus(404);
    }
    $this->getJson('/api/admin/user?id=nobody', bearer($this->f->admin))->assertStatus(404)->assertExactJson(['error' => 'no such user']);
    $this->getJson('/api/admin/user', bearer($this->f->admin))->assertStatus(404);
});

it('keeps every admin route from coaches, members and strangers', function () {
    $f = $this->f;
    foreach ([['GET', '/api/admin/users'], ['GET', '/api/admin/user?id='.$f->a1->id], ['POST', '/api/admin/user/disable'], ['POST', '/api/admin/user/coach'], ['POST', '/api/admin/user/assign-coach']] as [$m, $path]) {
        $this->json($m, $path, ['id' => $f->a1->id], bearer($f->a))->assertStatus(403);
        $this->json($m, $path, ['id' => $f->a1->id], bearer($f->a1))->assertStatus(403);
        $this->json($m, $path, ['id' => $f->a1->id])->assertStatus(401);
    }
    expect($f->a1->fresh()->disabled)->toBeFalse();
});

it('lists every account in Node\'s order and shape', function () {
    $f = $this->f;
    UserState::query()->create(['user_id' => $f->a1->id, 'ts' => 1, 'state' => json_encode(['_ts' => 1790000000000, 'workouts' => [['d' => '2026-05-01'], ['d' => '2026-05-03']]])]);
    $res = $this->getJson('/api/admin/users', bearer($f->admin))->assertOk();
    // Every account, disabled ones and the admin included, in signup order (the fixture made them
    // in one millisecond, so the id breaks the tie).
    expect(array_column($res->json('users'), 'id'))->toBe(User::query()->signupOrder()->pluck('id')->all())
        ->and($res->json('users'))->toHaveCount(8)
        ->and($res->json('now'))->toBeInt()
        ->and($res->json('invite_only'))->toBeBool();
    $a1 = collect($res->json('users'))->firstWhere('id', $f->a1->id);
    expect($a1)->toBe([
        'id' => $f->a1->id, 'name' => 'Client A1', 'created' => $f->a1->createdIso(), 'disabled' => false, 'admin' => false,
        'invitedBy' => null, 'coach' => false, 'coachId' => $f->a->id, 'workouts' => 2, 'lastWorkout' => '2026-05-03',
        'lastSync' => 1790000000000, 'hasPush' => false, 'live' => null,
    ]);
    expect(collect($res->json('users'))->firstWhere('id', $f->admin->id))->toMatchArray(['admin' => true, 'coach' => true, 'lastWorkout' => null, 'lastSync' => null])
        ->and(collect($res->json('users'))->firstWhere('id', $f->d1->id)['disabled'])->toBeTrue();
});

it('drills into one account: workouts newest first, routines summarised', function () {
    $f = $this->f;
    UserState::query()->create(['user_id' => $f->a1->id, 'ts' => 1, 'state' => json_encode([
        'unit' => 'lb', 'workouts' => [['d' => '2026-05-01'], ['d' => '2026-05-03']], 'bodyweight' => [[1, 80]],
        'routines' => [['id' => 'r1', 'name' => 'Push', 'emoji' => null, 'ex' => [['id' => 'x'], ['id' => 'y']]], ['id' => 'r2']],
    ])]);
    $this->getJson('/api/admin/user?id='.$f->a1->id, bearer($f->admin))->assertOk()->assertExactJson([
        'user' => ['id' => $f->a1->id, 'name' => 'Client A1', 'created' => $f->a1->createdIso(), 'disabled' => false, 'admin' => false,
            'invitedBy' => null, 'coach' => false, 'ownCoachFlag' => false, 'coachId' => $f->a->id],
        'unit' => 'lb', 'lastSync' => null,
        'routines' => [['id' => 'r1', 'name' => 'Push', 'emoji' => null, 'count' => 2], ['id' => 'r2', 'count' => 0]],
        'bodyweight' => [[1, 80]],
        'workouts' => [['d' => '2026-05-03'], ['d' => '2026-05-01']],
    ]);
    $this->getJson('/api/admin/user?id='.$f->admin->id, bearer($f->admin))->assertOk()
        ->assertJsonPath('user.coach', true)->assertJsonPath('user.ownCoachFlag', false)
        ->assertJsonPath('unit', 'kg')->assertJsonPath('workouts', []);
});

it('reads the body as Node\'s readBody did on every admin write', function () {
    foreach (['disable', 'coach', 'assign-coach'] as $path) {
        $this->call('POST', '/api/admin/user/'.$path, [], [], [], $this->transformHeadersToServerVars(bearer($this->f->admin) + ['Content-Type' => 'application/json']), '{nope')
            ->assertStatus(400)->assertExactJson(['error' => 'bad json']);
    }
});

it('reads ?id= as Node\'s searchParams.get did: untrimmed, the first of repeated names', function () {
    $f = $this->f;
    $id = $f->a1->id;
    foreach (['/api/admin/user' => $f->admin, '/api/coach/member' => $f->a] as $path => $who) {
        $miss = $path === '/api/admin/user' ? 404 : 403;
        $this->getJson("$path?id=%20$id%20", bearer($who))->assertStatus($miss);
        $this->getJson("$path?id=nope&id=$id", bearer($who))->assertStatus($miss);
        $this->getJson("$path?id=$id&id=nope", bearer($who))->assertOk();
        $this->getJson("$path?id[]=$id", bearer($who))->assertStatus($miss);
    }
});
