<?php

// The audit log and the owner's two routes over it, against the Node API's contract
// (api/server.js: audit, auditKeep, GET /api/admin/audit, POST /api/admin/audit/clear).

use App\Audit\Audit;
use App\Auth\SessionToken;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Support\Passkey;

beforeEach(function () {
    config([
        'fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173', 'fitpal.session_secret' => str_repeat('ab', 32),
        'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost',
        'fitpal.audit' => ['enabled' => true, 'max' => 5000, 'days' => 90, 'ip' => 'off'],
    ]);
    $this->admin = User::query()->create(['id' => 'admin00000000000', 'name' => 'Owner', 'admin' => true]);
    $this->coach = User::query()->create(['id' => 'coach00000000000', 'name' => 'Coach', 'coach' => true]);
});

function bearerFor(User $u): array
{
    return ['Authorization' => 'Bearer '.SessionToken::make($u)];
}

function events(): array
{
    return DB::table('audit_events')->orderBy('id')->pluck('ev')->all();
}

it('refuses the routes to anyone but an admin, and records only the 403', function () {
    $this->getJson('/api/admin/audit')->assertStatus(401)->assertExactJson(['error' => 'not signed in']);
    $this->postJson('/api/admin/audit/clear')->assertStatus(401);
    expect(events())->toBe([]);

    $this->getJson('/api/admin/audit', bearerFor($this->coach))->assertStatus(403)->assertExactJson(['error' => 'forbidden']);
    $row = DB::table('audit_events')->first();
    expect($row->ev)->toBe('admin.denied')->and((bool) $row->ok)->toBeFalse()->and($row->uid)->toBe('coach00000000000');
});

it('pages newest first by id, filters by category and by failures, in Node\'s shape', function () {
    $req = Request::create('/');
    foreach (range(1, 5) as $i) {
        Audit::record($req, 'auth.login.ok', ['user' => $this->coach]);
    }
    Audit::record($req, 'auth.login.fail', ['ok' => false, 'msg' => 'unknown-credential']);
    Audit::record($req, 'admin.invite.create', ['user' => $this->admin, 'target' => $this->coach]);

    $r = $this->getJson('/api/admin/audit?limit=3', bearerFor($this->admin))->assertOk();
    expect($r->json('total'))->toBe(7)
        ->and(array_column($r->json('events'), 'ev'))->toBe(['admin.invite.create', 'auth.login.fail', 'auth.login.ok'])
        ->and($r->json('nextBefore'))->toBe($r->json('events.2.id'))
        ->and($r->json('enabled'))->toBeTrue()->and($r->json('ip_mode'))->toBe('off')
        ->and($r->json('retention'))->toBe(['max' => 5000, 'days' => 90])
        ->and($r->json('now'))->toBeInt();
    // Optional fields are absent, not null; the failure carries its reason code.
    expect($r->json('events.0'))->toHaveKeys(['id', 'ts', 'ev', 'ok', 'uid', 'name', 'tgt', 'tname'])->not->toHaveKey('msg')
        ->and($r->json('events.1'))->toBe(['id' => $r->json('events.1.id'), 'ts' => $r->json('events.1.ts'), 'ev' => 'auth.login.fail', 'ok' => false, 'msg' => 'unknown-credential']);

    $next = $this->getJson('/api/admin/audit?limit=3&before='.$r->json('nextBefore'), bearerFor($this->admin))->json('events');
    expect(count($next))->toBe(3)->and($next[0]['id'])->toBeLessThan($r->json('nextBefore'));

    expect($this->getJson('/api/admin/audit?cat=auth', bearerFor($this->admin))->json('total'))->toBe(6)
        ->and($this->getJson('/api/admin/audit?cat=admin', bearerFor($this->admin))->json('total'))->toBe(1)
        ->and($this->getJson('/api/admin/audit?cat=fail', bearerFor($this->admin))->json('total'))->toBe(1)
        ->and($this->getJson('/api/admin/audit?cat=au', bearerFor($this->admin))->json('total'))->toBe(0)      // a prefix of a word is not a category
        ->and($this->getJson('/api/admin/audit?cat=%25', bearerFor($this->admin))->json('total'))->toBe(0)
        ->and($this->getJson('/api/admin/audit?limit=999', bearerFor($this->admin))->json('events'))->toHaveCount(7);
});

it('clears the log, records the clear, and never reuses an id', function () {
    $req = Request::create('/');
    Audit::record($req, 'auth.login.ok', ['user' => $this->coach]);
    $last = (int) DB::table('audit_events')->max('id');

    $this->postJson('/api/admin/audit/clear', [], bearerFor($this->admin))->assertOk()->assertExactJson(['ok' => true]);
    $rows = DB::table('audit_events')->get();
    expect($rows)->toHaveCount(1)->and($rows[0]->ev)->toBe('admin.audit.clear')->and($rows[0]->id)->toBeGreaterThan($last);
});

it('keeps only what retention allows, on read and when pruned', function () {
    config(['fitpal.audit.max' => 3, 'fitpal.audit.days' => 1]);
    $old = (int) floor(microtime(true) * 1000) - 2 * 86_400_000;
    DB::table('audit_events')->insert(['ts' => $old, 'ev' => 'auth.login.ok', 'ok' => true]);
    foreach (range(1, 5) as $i) {
        Audit::record(Request::create('/'), 'auth.login.ok', ['user' => $this->coach]);
    }

    expect($this->getJson('/api/admin/audit', bearerFor($this->admin))->json('total'))->toBe(3);   // the 3 newest, none of the old
    Audit::prune();
    expect(DB::table('audit_events')->count())->toBe(3);
});

it('treats 0 as no cap, writes nothing when off, and never lets a failed write break the caller', function () {
    config(['fitpal.audit.max' => 0, 'fitpal.audit.days' => 0]);
    expect(Audit::floorId())->toBeNull();

    config(['fitpal.audit.enabled' => false]);
    Audit::record(Request::create('/'), 'auth.login.ok');
    expect(events())->toBe([]);

    config(['fitpal.audit.enabled' => true]);
    Schema::drop('audit_events');
    Audit::record(Request::create('/'), 'auth.login.ok');   // no exception: logged, not thrown
    expect(true)->toBeTrue();
});

it('keeps the caller\'s address per AUDIT_IP', function () {
    config(['fitpal.audit.ip' => 'net']);
    Audit::record(Request::create('/', server: ['HTTP_CF_CONNECTING_IP' => '203.0.113.7']), 'auth.login.ok');
    expect(DB::table('audit_events')->value('ip'))->toBe('203.0.113.0/24');
});

it('records the sign-in story with Node\'s event names and reason codes', function () {
    $pk = new Passkey;
    $pk->register($this, 'Nadia')->assertOk();
    $pk->login($this)->assertOk();
    (new Passkey)->login($this)->assertStatus(404);                                      // unknown passkey
    $this->postJson('/api/login/verify', ['cid' => 'nope', 'credential' => []])->assertStatus(400);
    $this->postJson('/api/register/verify', ['cid' => 'nope', 'credential' => []])->assertStatus(400);
    $nadia = User::query()->where('name', 'Nadia')->first();
    $this->postJson('/api/logout', [], bearerFor($nadia))->assertOk();
    $this->postJson('/api/logout/all', [], bearerFor($nadia))->assertOk();
    $nadia->update(['disabled' => true]);
    $pk->login($this)->assertStatus(403);

    $rows = DB::table('audit_events')->orderBy('id')->get(['ev', 'ok', 'msg', 'name'])->map(fn ($r) => [$r->ev, (bool) $r->ok, $r->msg])->all();
    expect($rows)->toBe([
        ['auth.register.ok', true, null],
        ['auth.login.ok', true, null],
        ['auth.login.fail', false, 'unknown-credential'],
        ['auth.login.fail', false, 'challenge-expired'],
        ['auth.register.fail', false, 'challenge-expired'],
        ['auth.logout', true, null],
        ['auth.logout.all', true, null],
        ['auth.login.fail', false, 'account-disabled'],
    ]);
    expect(DB::table('audit_events')->where('ev', 'auth.register.ok')->value('name'))->toBe('Nadia');
});

it('imports audit.log with its ids, skips torn lines, and carries the sequence on', function () {
    $dir = sys_get_temp_dir().'/fitpal-audit-'.bin2hex(random_bytes(4));
    mkdir($dir);
    file_put_contents($dir.'/db.json', json_encode(['users' => [], 'creds' => []]));
    file_put_contents($dir.'/audit.log', implode("\n", [
        json_encode(['id' => 41, 'ts' => 1790000000000, 'ev' => 'auth.login.ok', 'ok' => true, 'uid' => 'u1', 'name' => 'A']),
        json_encode(['id' => 42, 'ts' => 1790000001000, 'ev' => 'auth.login.fail', 'ok' => false, 'msg' => 'unknown-credential', 'ip' => '203.0.113.0/24']),
        '{"id":43,"ts":17900000020',   // torn by a crash mid-write
    ])."\n");

    $this->artisan('fitpal:import-legacy', ['dataDir' => $dir])->assertSuccessful()->expectsOutputToContain('audit 2');
    $this->artisan('fitpal:import-legacy', ['dataDir' => $dir])->assertSuccessful();   // idempotent
    expect(DB::table('audit_events')->count())->toBe(2)
        ->and(DB::table('audit_events')->find(42)->msg)->toBe('unknown-credential');

    Audit::record(Request::create('/'), 'auth.login.ok');
    expect((int) DB::table('audit_events')->max('id'))->toBeGreaterThan(42);

    array_map('unlink', glob($dir.'/*'));
    rmdir($dir);
});

it('counts the AUDIT_MAX window among rows inside AUDIT_DAYS, as Node did (age first)', function () {
    config(['fitpal.audit.max' => 2, 'fitpal.audit.days' => 1]);
    $old = Audit::now() - 2 * 86_400_000;
    DB::table('audit_events')->insert([['ts' => $old, 'ev' => 'auth.login.ok', 'ok' => true], ['ts' => $old, 'ev' => 'auth.login.ok', 'ok' => true]]);
    Audit::record(Request::create('/'), 'auth.login.ok');
    Audit::record(Request::create('/'), 'auth.logout');
    Audit::record(Request::create('/'), 'auth.logout.all');

    // 3 recent rows, cap 2: the two newest; the two expired ones never count towards the cap.
    expect(array_column($this->getJson('/api/admin/audit', bearerFor($this->admin))->json('events'), 'ev'))->toBe(['auth.logout.all', 'auth.logout'])
        ->and(Audit::prune())->toBe(3)
        ->and(DB::table('audit_events')->pluck('ev')->all())->toBe(['auth.logout', 'auth.logout.all']);
});

it('prunes from the scheduler every hour, not on the request path', function () {
    $this->artisan('schedule:list')->expectsOutputToContain('audit:prune');
    config(['fitpal.audit.max' => 1]);
    foreach (range(1, 250) as $i) {
        Audit::record(Request::create('/'), 'auth.login.ok');
    }
    expect(DB::table('audit_events')->count())->toBe(250);   // writing never deletes
});

it('ignores an array where a string belongs, as Node did, instead of a 500', function () {
    // For Node `?cat[]=auth` is another key: searchParams.get('cat') is null, so no filter at all.
    Audit::record(Request::create('/'), 'auth.login.ok');
    $this->getJson('/api/admin/audit?cat[]=fail&limit[]=1&before[]=9', bearerFor($this->admin))
        ->assertOk()->assertJsonPath('total', 1)->assertJsonCount(1, 'events');
});

it('refuses to import an audit log into a table that holds other events', function () {
    $dir = sys_get_temp_dir().'/fitpal-audit-'.bin2hex(random_bytes(4));
    mkdir($dir);
    file_put_contents($dir.'/db.json', json_encode(['users' => [], 'creds' => []]));
    file_put_contents($dir.'/audit.log', json_encode(['id' => 1, 'ts' => 1790000000000, 'ev' => 'auth.login.ok', 'ok' => true])."\n");
    Audit::record(Request::create('/'), 'auth.logout');   // Laravel's own event, id 1, different from the log's id 1

    $this->artisan('fitpal:import-legacy', ['dataDir' => $dir])->assertSuccessful()
        ->expectsOutputToContain('audit 0')
        ->expectsOutputToContain('not from this log');
    expect(DB::table('audit_events')->pluck('ev')->all())->toBe(['auth.logout']);   // untouched

    array_map('unlink', glob($dir.'/*'));
    rmdir($dir);
});
