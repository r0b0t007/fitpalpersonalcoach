<?php

// Read-only on lapse and the client cap (CHW-267, spec §6): RequireWriter on the coach's writes,
// and a seat (CoachSeat) judged everywhere a client joins by a coach's code — at register/options,
// again under the coach's lock at register/verify, and at invite/redeem.

use App\Models\Assignment;
use App\Models\CoachProgram;
use App\Models\ExerciseMedia;
use App\Models\Invite;
use App\Models\User;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\Billing;
use Tests\Support\Coaching;
use Tests\Support\MediaFixtures;
use Tests\Support\Passkey;

beforeEach(function () {
    config([
        'fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173',
        'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost',
        'fitpal.invite_only' => true, 'fitpal.bootstrap_code' => '',
        // A sign-up signs a session: CI has no .env, and some tests register before any bearer().
        'fitpal.session_secret' => str_repeat('ab', 32),
    ]);
    $this->dataDir = sys_get_temp_dir().'/fitpal-gate-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir]);
    $this->f = Coaching::twoCoaches();
    // A coach's code, minted while there was room (the fixture's INVA… is A's too).
    $this->code = Coaching::own(new Invite, $this->f->a, ['code' => 'SEATCODE00000000', 'created_by' => $this->f->a->id, 'created' => '2026-05-01T00:00:00.000Z'])->code;
    $this->readOnly = ['error' => 'your plan is read-only until billing is sorted out — see Account › Plan & billing'];
    Billing::on();
});

afterEach(function () {
    (new Filesystem)->deleteDirectory($this->dataDir);
});

/** $coach with exactly $active active clients (the fixture gives A two, and a disabled one). */
function seatsTaken(User $coach, int $active): void
{
    $ids = User::activeClientsOf($coach)->orderBy('id')->pluck('id');
    for ($i = $ids->count(); $i < $active; $i++) {
        tap((new User)->forceFill(['id' => sprintf('tSeat%011d', $i), 'name' => "Seat $i", 'coach_id' => $coach->id]))->save();
    }
    User::query()->whereKey($ids->slice($active)->all())->update(['disabled' => true]);
}

function fullRoster(int $cap): array
{
    $k = 'this coach\'s client list is full ({0}) — ask them to upgrade';

    return ['error' => str_replace('{0}', (string) $cap, $k), 'msg' => ['k' => $k, 'v' => [$cap]]];
}

function redeemAs(User $who, string $code): TestResponse
{
    return test()->postJson('/api/invite/redeem', ['code' => $code], bearer($who));
}

it('refuses a coach with no plan every write it gates, before reading a byte', function () {
    $f = $this->f;
    $before = [Invite::query()->count(), Assignment::acrossCoaches()->count(), CoachProgram::acrossCoaches()->count(), ExerciseMedia::acrossCoaches()->count()]; // across coaches: test counts every row
    $this->postJson('/api/coach/assign', ['memberIds' => [$f->a1->id], 'bundle' => ['week' => []]], bearer($f->a))->assertStatus(402)->assertExactJson($this->readOnly);
    $this->postJson('/api/coach/programs/save', ['program' => ['id' => 'p1', 'name' => 'P']], bearer($f->a))->assertStatus(402)->assertExactJson($this->readOnly);
    $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($f->a))->assertStatus(402)->assertExactJson($this->readOnly);
    // The uploads close the connection on it, as on every refusal (CloseOnRefusal).
    foreach ([
        MediaFixtures::post($f->a, '/api/media/exercise?ex=0001&label=front', MediaFixtures::mkfix('isom')),
        MediaFixtures::post($f->a, '/api/media/exercise/upload?ex=0001&label=front&size=4096', ''),
        $this->call('PUT', '/api/media/exercise/upload?id=x&offset=0', [], [], [], $this->transformHeadersToServerVars(bearer($f->a)) + ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_ACCEPT' => 'application/json'], 'bytes'),
        MediaFixtures::post($f->a, '/api/media/exercise/upload/finish?id=x', ''),
    ] as $r) {
        $r->assertStatus(402)->assertExactJson($this->readOnly)->assertHeader('Connection', 'close');
    }
    expect([Invite::query()->count(), Assignment::acrossCoaches()->count(), CoachProgram::acrossCoaches()->count(), ExerciseMedia::acrossCoaches()->count()])->toBe($before); // across coaches: test counts every row
});

it('leaves a read-only coach every read, and every way to tidy up', function () {
    $f = $this->f;
    foreach (['/api/coach/members', '/api/coach/invites', '/api/coach/programs', '/api/media/exercises'] as $path) {
        $this->getJson($path, bearer($f->a))->assertOk();
    }
    $this->postJson('/api/coach/invites/revoke', ['code' => 'INVA0000000000'], bearer($f->a))->assertOk();
    $this->postJson('/api/coach/programs/delete', ['id' => 'prog-a'], bearer($f->a))->assertOk();
    $this->postJson('/api/coach/assignments/withdraw', ['id' => 'assignA'], bearer($f->a))->assertOk();
    $this->postJson('/api/coach/member/release', ['id' => $f->a2->id], bearer($f->a))->assertOk();
    // Cancelling an upload only frees space: refused for being nobody's, not for the plan.
    expect($this->deleteJson('/api/media/exercise/upload?id=x', [], bearer($f->a))->status())->not->toBe(402);
});

it('writes while trialing, active, past due or granted, and canceled until the period ends', function (array $licence, bool $writes) {
    Billing::licence($this->f->a, $licence + ['plan' => 'pro']);
    $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($this->f->a))->assertStatus($writes ? 200 : 402);
})->with([
    'trialing' => [['status' => 'trialing'], true],
    'active' => [['status' => 'active'], true],
    'past_due (Creem retrying)' => [['status' => 'past_due'], true],
    'manual' => [['status' => 'manual', 'source' => 'manual'], true],
    'canceled, paid until tomorrow' => [['status' => 'canceled', 'period_end' => now()->addDay()], true],
    'canceled, period over' => [['status' => 'canceled', 'period_end' => now()->subDay()], false],
    'paused' => [['status' => 'paused'], false],
    'unpaid' => [['status' => 'unpaid'], false],
    'expired' => [['status' => 'expired'], false],
    'pending (checkout not finished)' => [['status' => 'pending'], false],
]);

it('never refuses an admin, nor anyone while billing is off; a client meets the role check first', function () {
    $f = $this->f;
    $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($f->admin))->assertOk();
    $this->postJson('/api/coach/assign', [], bearer($f->a1))->assertStatus(403)->assertExactJson(['error' => 'forbidden']);
    config(['fitpal.creem.api_key' => '']);
    $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($f->a))->assertOk();
});

it('tells the coach in their invite list whether they may invite, and why not', function () {
    $f = $this->f;
    $state = fn () => collect($this->getJson('/api/coach/invites', bearer($f->a))->assertOk()->json())->only(['cap', 'used', 'canInvite', 'reason'])->all();
    expect($state())->toBe(['cap' => 0, 'used' => 2, 'canInvite' => false, 'reason' => 'read_only']);
    Billing::licence($f->a, ['status' => 'active', 'plan' => 'solo']);
    expect($state())->toBe(['cap' => 10, 'used' => 2, 'canInvite' => true, 'reason' => null]);
    seatsTaken($f->a, 10);
    expect($state())->toBe(['cap' => 10, 'used' => 10, 'canInvite' => false, 'reason' => 'at_cap']);
    config(['fitpal.creem.products' => '']);
    expect($state())->toBe(['cap' => null, 'used' => 10, 'canInvite' => true, 'reason' => null]);
});

it('mints no code at the cap, nor over it after a downgrade', function (int $active) {
    $f = $this->f;
    Billing::licence($f->a, ['status' => 'active', 'plan' => 'solo']);
    seatsTaken($f->a, $active);
    $open = Invite::query()->count();
    $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($f->a))->assertStatus(402)->assertExactJson([
        'error' => 'your plan allows 10 clients — upgrade to invite more',
        'msg' => ['k' => 'your plan allows {0} clients — upgrade to invite more', 'v' => [10]],
    ]);
    expect(Invite::query()->count())->toBe($open);
    // A disabled client frees a seat.
    seatsTaken($f->a, 9);
    $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($f->a))->assertOk();
})->with(['at the cap' => 10, 'over it' => 12]);

it('refuses a sign-up by a full coach\'s code before the passkey prompt, and spends nothing', function () {
    $f = $this->f;
    Billing::licence($f->a, ['status' => 'active', 'plan' => 'solo']);
    seatsTaken($f->a, 10);
    $this->getJson('/api/invite?code='.$this->code)->assertOk()->assertExactJson(['coachName' => 'Coach A', 'full' => true]);
    $this->postJson('/api/register/options', ['name' => 'Late', 'code' => $this->code])->assertStatus(409)->assertExactJson(fullRoster(10));
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.denied', 'name' => 'Late', 'msg' => 'coach-full']);
    expect(Invite::query()->find($this->code)->used_by)->toBeNull();

    seatsTaken($f->a, 9);
    $this->getJson('/api/invite?code='.$this->code)->assertOk()->assertExactJson(['coachName' => 'Coach A', 'full' => false]);
    $res = (new Passkey)->register($this, 'Late', $this->code)->assertOk();
    expect(User::query()->find($res->json('user.id'))->coach_id)->toBe($f->a->id);
});

it('judges the seat again when the account is written: the last one went during the prompt', function () {
    $f = $this->f;
    Billing::licence($f->a, ['status' => 'active', 'plan' => 'solo']);
    seatsTaken($f->a, 9);
    $pk = new Passkey;
    $options = $this->postJson('/api/register/options', ['name' => 'Late', 'code' => $this->code])->assertOk();
    seatsTaken($f->a, 10);
    $credentials = DB::table('webauthn_credentials')->count();
    $this->postJson('/api/register/verify', ['cid' => $options->json('cid'), 'credential' => $pk->attest($options->json('options'))])
        ->assertStatus(409)->assertExactJson(fullRoster(10));
    expect(User::query()->where('name', 'Late')->exists())->toBeFalse()
        ->and(DB::table('webauthn_credentials')->count())->toBe($credentials)
        ->and(Invite::query()->find($this->code)->used_by)->toBeNull();
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.register.fail', 'name' => 'Late', 'msg' => 'coach-full']);
});

it('refuses a redemption at the cap; the second of two joins counts the first', function () {
    $f = $this->f;
    Billing::licence($f->a, ['status' => 'active', 'plan' => 'solo']);
    seatsTaken($f->a, 9);
    $other = tap((new User)->forceFill(['id' => 'tOther0000000000', 'name' => 'Other']))->save();
    redeemAs($f->u1, $this->code)->assertOk();
    redeemAs($other, 'INVA0000000000')->assertStatus(409)->assertExactJson(fullRoster(10));
    expect($other->fresh()->coach_id)->toBeNull()
        ->and(Invite::query()->find('INVA0000000000')->used_by)->toBeNull()
        ->and(User::activeClientsOf($f->a)->count())->toBe(10);
});

it('turns a read-only coach\'s clients away without calling the roster full', function () {
    $f = $this->f;
    Billing::licence($f->a, ['status' => 'paused', 'plan' => 'pro']);
    $closed = ['error' => 'this coach cannot take new clients right now — ask them to check their plan'];
    $this->getJson('/api/invite?code='.$this->code)->assertOk()->assertExactJson(['coachName' => 'Coach A', 'full' => true]);
    $this->postJson('/api/register/options', ['name' => 'Late', 'code' => $this->code])->assertStatus(409)->assertExactJson($closed);
    redeemAs($f->u1, $this->code)->assertStatus(409)->assertExactJson($closed);
    expect($f->u1->fresh()->coach_id)->toBeNull();
});

it('takes clients without limit for an admin\'s code, and for anyone while billing is off', function () {
    $f = $this->f;
    $res = (new Passkey)->register($this, 'Admin\'s', 'INVADMIN0000000000')->assertOk();
    expect(User::query()->find($res->json('user.id'))->coach_id)->toBe($f->admin->id);
    seatsTaken($f->a, 40);
    config(['fitpal.creem.api_key' => '']);
    $this->getJson('/api/invite?code='.$this->code)->assertOk()->assertExactJson(['coachName' => 'Coach A', 'full' => false]);
    redeemAs($f->u1, $this->code)->assertOk();
});

it('counts the seat with the coach\'s row locked, at redeem and at register', function () {
    $f = $this->f;
    Billing::licence($f->a, ['status' => 'active', 'plan' => 'pro']);
    $order = [];
    DB::listen(function ($q) use (&$order, $f) {
        if (DB::transactionLevel() < 2) {
            return;   // RefreshDatabase's own transaction is level 1
        }
        if (str_contains($q->sql, 'count(*)') && str_contains($q->sql, '"coach_id"')) {
            $order[] = 'count';
        } elseif (str_starts_with($q->sql, 'select * from "users"') && in_array($f->a->id, $q->bindings, true)) {
            $order[] = 'lock';
        }
    });
    redeemAs($f->u1, $this->code)->assertOk();
    expect($order)->toContain('count')
        ->and(array_search('lock', $order, true))->toBeLessThan(array_search('count', $order, true));

    $order = [];
    (new Passkey)->register($this, 'Late', 'INVA0000000000')->assertOk();
    expect($order)->toContain('count')
        ->and(array_search('lock', $order, true))->toBeLessThan(array_search('count', $order, true));
});
