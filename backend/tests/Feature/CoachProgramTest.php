<?php

// A coach's program library (CHW-248): GET /api/coach/programs, POST …/save, POST …/delete. The
// api/coach-smoke.sh section is "the program library" (its comment block, not an == header).

use App\Models\CoachProgram;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
});

const PROG = '{"id":"p-smoke","name":"Block A","bundle":{"opengym_plan":1,"name":"x","week":{"1":["r1"]},"routines":[{"id":"r1","name":"Push","ex":[{"id":"0025","sets":3}]}],"customEx":[]}}';

function saveRaw(User $who, string $json): TestResponse
{
    return test()->call('POST', '/api/coach/programs/save', [], [], [], test()->transformHeadersToServerVars(bearer($who) + ['Content-Type' => 'application/json', 'Accept' => 'application/json']), $json);
}

function libraryOf(User $who): array
{
    return test()->getJson('/api/coach/programs', bearer($who))->assertOk()->json('programs');
}

it('== the program library ==', function () {
    $f = $this->f;
    $res = saveRaw($f->a, PROG)->assertOk();
    expect($res->json('program'))->toMatchArray(['id' => 'p-smoke', 'name' => 'Block A'])
        ->and($res->json('program.bundle.name'))->toBe('Block A')   // the row's name wins
        ->and($res->json('program.created'))->toBeInt()
        ->and(array_column($res->json('programs'), 'id'))->toBe(['prog-a', 'p-smoke']);
    expect(array_column(libraryOf($f->a), 'name'))->toBe(['Program a', 'Block A'])
        ->and(array_column(libraryOf($f->b), 'id'))->toBe(['prog-b']);                      // separate
    $this->getJson('/api/coach/programs', bearer($f->a1))->assertStatus(403);                // a member
    saveRaw($f->a, '{"id":"x","name":"","bundle":{"opengym_plan":1,"routines":[{"id":"r","ex":[]}]}}')
        ->assertStatus(400)->assertExactJson(['error' => 'program needs a name']);
    saveRaw($f->a, '{"id":"x","name":"Empty","bundle":{"opengym_plan":1,"routines":[]}}')
        ->assertStatus(400)->assertExactJson(['error' => 'plan has no routines']);
    // Re-saving the same id updates in place: same position, created kept, updated moved.
    $created = $res->json('program.created');
    $this->travel(2)->seconds();
    $again = saveRaw($f->a, str_replace('"Block A"', '"Block A v2"', PROG))->assertOk();
    expect(array_column($again->json('programs'), 'name'))->toBe(['Program a', 'Block A v2'])
        ->and($again->json('program.created'))->toBe($created)
        ->and($again->json('program.updated'))->toBeGreaterThan($created);
    saveRaw($f->a, '{"id":{"a":1},"name":"Odd","bundle":{"opengym_plan":1,"routines":[{"id":"r","ex":[{"id":"0025"}]}]}}')
        ->assertStatus(400)->assertExactJson(['error' => 'program id required']);
    $this->postJson('/api/coach/programs/delete', ['id' => 'nope'], bearer($f->a))->assertStatus(404)->assertExactJson(['error' => 'no such program']);
    $this->postJson('/api/coach/programs/delete', ['id' => 'p-smoke'], bearer($f->a))->assertOk()
        ->assertJsonPath('programs.0.id', 'prog-a')->assertJsonCount(1, 'programs');
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.program.save', 'uid' => $f->a->id, 'msg' => 'Block A']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.program.delete', 'msg' => 'Block A v2']);
});

it('makes up an id only when none was sent', function () {
    $res = saveRaw($this->f->a, '{"name":"No id","bundle":{"opengym_plan":1,"routines":[{"id":"r","ex":[]}]}}')->assertOk();
    expect($res->json('program.id'))->toMatch('/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/');
    saveRaw($this->f->a, '{"id":"","name":"Empty id","bundle":{"opengym_plan":1,"routines":[{"id":"r","ex":[]}]}}')->assertOk();
    foreach (['42', '"has spaces"', '"'.str_repeat('x', 65).'"', '[]'] as $bad) {
        saveRaw($this->f->a, '{"id":'.$bad.',"name":"Bad","bundle":{"opengym_plan":1,"routines":[{"id":"r","ex":[]}]}}')
            ->assertStatus(400)->assertExactJson(['error' => 'program id required']);
    }
});

it('stores the bundle as sent: {} stays {}, strings untrimmed, unknown keys dropped', function () {
    saveRaw($this->f->a, '{"id":"raw","name":"Raw","bundle":{"opengym_plan":1,"week":{},"evil":"x","routines":[{"id":"r","name":"  Push  ","ex":[]}]}}')->assertOk();
    $stored = DB::table('coach_programs')->where('program_id', 'raw')->value('bundle');
    expect($stored)->toContain('"week":{}')->toContain('"name":"  Push  "')->not->toContain('evil');
    $raw = $this->getJson('/api/coach/programs', bearer($this->f->a))->getContent();
    expect($raw)->toContain('"week":{}');
});

it('caps the library at 50, but never a re-save of a program already in it', function () {
    $f = $this->f;
    foreach (range(1, 49) as $i) {   // the fixture gave A one
        Coaching::own(new CoachProgram, $f->a, ['program_id' => "p$i", 'name' => "P$i", 'bundle' => '{}', 'created' => 1, 'updated' => 1]);
    }
    saveRaw($f->a, PROG)->assertStatus(429)->assertExactJson([
        'error' => 'you have 50 programs — delete one before saving another',
        'msg' => ['k' => 'you have {0} programs — delete one before saving another', 'v' => [50]],
    ]);
    saveRaw($f->a, str_replace('p-smoke', 'p1', PROG))->assertOk();
});

it('reads the body as Node\'s readBody did: bad JSON is 400, over 5 MB is 413, after the sign-in check', function () {
    $f = $this->f;
    saveRaw($f->a, '{"id":')->assertStatus(400)->assertExactJson(['error' => 'bad json']);
    saveRaw($f->a, str_repeat(' ', 5 * 1024 * 1024 + 1))->assertStatus(413)->assertExactJson([
        'error' => 'request body is larger than the 5 MB limit',
        'msg' => ['k' => 'request body is larger than the {0} MB limit', 'v' => [5]],
    ]);
    // Anonymous: the sign-in check answers first, as in Node.
    $this->call('POST', '/api/coach/programs/save', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'], '{"id":')
        ->assertStatus(401);
    // The other routes that read a body answer the same.
    $bad = fn (string $path) => $this->call('POST', $path, [], [], [], $this->transformHeadersToServerVars(bearer($f->a) + ['Content-Type' => 'application/json']), '{nope')
        ->assertStatus(400)->assertExactJson(['error' => 'bad json']);
    foreach (['/api/coach/programs/delete', '/api/coach/member/release', '/api/coach/invites/new', '/api/coach/invites/revoke'] as $path) {
        $bad($path);
    }
});

it('refuses an id with a trailing newline, as JS\'s $ does', function () {
    saveRaw($this->f->a, '{"id":"abc\n","name":"N","bundle":{"opengym_plan":1,"routines":[{"id":"r","ex":[]}]}}')
        ->assertStatus(400)->assertExactJson(['error' => 'program id required']);
});

it('stores a bundle as Node wrote it: integer keys first and ascending, line separators raw', function () {
    saveRaw($this->f->a, '{"id":"ord","name":"N","bundle":{"opengym_plan":1,"week":{"3":["r"],"b":1,"1":["r"],"a":2},"routines":[{"id":"r","note":"x\u2028y","ex":[]}]}}')->assertOk();
    $stored = DB::table('coach_programs')->where('program_id', 'ord')->value('bundle');
    expect($stored)->toContain('"week":{"1":["r"],"3":["r"],"b":1,"a":2}')
        ->toContain("\"note\":\"x\u{2028}y\"");
});

it('compares ids and codes byte for byte on MySQL and MariaDB, as JS === did', function () {
    expect(config('database.connections.mysql.collation'))->toBe('utf8mb4_bin')
        ->and(config('database.connections.mariadb.collation'))->toBe('utf8mb4_bin');
});
