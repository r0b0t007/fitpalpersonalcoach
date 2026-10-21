<?php

// fitpal:import-legacy, the coaching half (CHW-251): db.invites, coach-<uid>.json program
// libraries and db.assignments — imported verbatim, mirrored on a rerun, and verified by
// replaying the coach and client routes against what Node answered from the same files.

use App\Models\Assignment;
use App\Models\CoachProgram;
use App\Models\Invite;
use Illuminate\Support\Facades\DB;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.admin_uids' => []]);
    $this->dir = sys_get_temp_dir().'/fitpal-coaching-'.bin2hex(random_bytes(4));
    mkdir($this->dir);
    // Written as Node wrote db.json: JSON.stringify, so {} stays {} and integer keys come first.
    $this->db = [
        'users' => [
            ['id' => 'adm0000000000000', 'name' => 'Owner', 'admin' => true, 'created' => '2026-01-01T00:00:00.000Z'],
            ['id' => 'cch0000000000000', 'name' => 'Coach', 'coach' => true, 'created' => '2026-01-02T00:00:00.000Z'],
            ['id' => 'mem0000000000000', 'name' => 'Member', 'coachId' => 'cch0000000000000', 'created' => '2026-01-03T00:00:00.000Z'],
            ['id' => 'oth0000000000000', 'name' => 'Other', 'created' => '2026-01-04T00:00:00.000Z'],
        ],
        'creds' => [], 'subs' => [],
        'invites' => [
            ['code' => 'OPEN000000000000', 'note' => '  spaced  ', 'createdBy' => 'cch0000000000000', 'created' => '2026-02-01T00:00:00.000Z', 'coachId' => 'cch0000000000000'],
            ['code' => 'USED000000000000', 'note' => 'used', 'createdBy' => 'cch0000000000000', 'created' => '2026-02-02T00:00:00.000Z', 'coachId' => 'cch0000000000000', 'usedBy' => 'mem0000000000000', 'usedAt' => '2026-02-03T00:00:00.000Z'],
            ['code' => 'GONE000000000000', 'note' => 'revoked', 'createdBy' => 'adm0000000000000', 'created' => '2026-02-04T00:00:00.000Z', 'revoked' => true, 'revokedAt' => '2026-02-05T00:00:00.000Z', 'revokedReason' => 'coach detached'],
            ['code' => 'GENERAL000000000', 'note' => 'general', 'createdBy' => 'adm0000000000000', 'created' => '2026-02-06T00:00:00.000Z'],
        ],
        'assignments' => [
            ['id' => 'pend000000000000', 'coachId' => 'cch0000000000000', 'coachName' => 'Coach', 'memberId' => 'mem0000000000000', 'bundle' => ['opengym_plan' => 1, 'name' => 'Block', 'week' => new stdClass, 'routines' => [['id' => 'r', 'ex' => []]]], 'note' => 'go', 'schedule' => true, 'created' => '2026-03-01T00:00:00.000Z', 'status' => 'pending'],
            ['id' => 'acc0000000000000', 'coachId' => 'cch0000000000000', 'coachName' => 'Coach', 'memberId' => 'mem0000000000000', 'bundle' => ['opengym_plan' => 1, 'name' => 'Old block', 'routines' => [['id' => 'a'], ['id' => 'b']]], 'note' => '', 'schedule' => false, 'created' => '2026-02-01T00:00:00.000Z', 'status' => 'accepted', 'decidedAt' => '2026-02-02T00:00:00.000Z'],
            ['id' => 'wdr0000000000000', 'coachId' => 'cch0000000000000', 'coachName' => 'Coach', 'memberId' => 'mem0000000000000', 'bundle' => ['opengym_plan' => 1], 'note' => '', 'schedule' => false, 'created' => '2026-02-03T00:00:00.000Z', 'status' => 'withdrawn', 'decidedAt' => '2026-02-04T00:00:00.000Z'],
        ],
    ];
    $this->write = function () {
        file_put_contents($this->dir.'/db.json', json_encode($this->db, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    };
    ($this->write)();
    file_put_contents($this->dir.'/coach-cch0000000000000.json', json_encode(['programs' => [
        ['id' => 'p1', 'name' => 'First', 'created' => 1770000000000, 'updated' => 1770000001000, 'bundle' => ['opengym_plan' => 1, 'week' => ['1' => ['r'], 'b' => 1], 'routines' => []]],
        ['id' => 'p2', 'name' => 'Second', 'created' => 1770000002000, 'updated' => 1770000002000, 'bundle' => ['opengym_plan' => 1, 'week' => new stdClass]],
    ], 'notes' => ['mem0000000000000' => 'never read by any route']]));
});

afterEach(function () {
    array_map('unlink', glob($this->dir.'/*') ?: []);
    rmdir($this->dir);
});

it('imports invites, programs and assignments verbatim, and verifies them through the routes', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])->assertSuccessful()
        ->expectsOutputToContain('invites 4 · programs 2 · assignments 3')
        ->expectsOutputToContain('/me, /data and the coaching routes match the files');

    expect(Invite::acrossCoaches()->orderBy('seq')->pluck('code')->all())->toBe(['OPEN000000000000', 'USED000000000000', 'GONE000000000000', 'GENERAL000000000']) // across coaches: the test reads every row
        ->and(Invite::acrossCoaches()->find('OPEN000000000000')->note)->toBe('  spaced  ') // across coaches: the test reads every row
        ->and(Invite::acrossCoaches()->find('GENERAL000000000')->coach_id)->toBeNull() // across coaches: the test reads every row
        ->and(Invite::acrossCoaches()->find('GONE000000000000')->toNode())->toBe(['code' => 'GONE000000000000', 'note' => 'revoked', 'createdBy' => 'adm0000000000000', 'created' => '2026-02-04T00:00:00.000Z', 'revoked' => true, 'revokedAt' => '2026-02-05T00:00:00.000Z', 'revokedReason' => 'coach detached']); // across coaches: the test reads every row
    expect(DB::table('coach_programs')->orderBy('id')->pluck('bundle', 'program_id')->all())->toBe([
        'p1' => '{"opengym_plan":1,"week":{"1":["r"],"b":1},"routines":[]}',
        'p2' => '{"opengym_plan":1,"week":{}}',
    ]);
    $a = Assignment::acrossCoaches()->find('pend000000000000'); // across coaches: the test reads every row
    expect($a->coach_id)->toBe('cch0000000000000')->and($a->schedule)->toBeTrue()->and($a->decided_at)->toBeNull()
        ->and($a->bundle)->toBe('{"opengym_plan":1,"name":"Block","week":{},"routines":[{"id":"r","ex":[]}]}');
});

it('mirrors the files on a rerun: changed rows updated in place, vanished ones removed', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    $p1 = CoachProgram::acrossCoaches()->where('program_id', 'p1')->value('id'); // across coaches: the test reads every row
    $seq = Invite::acrossCoaches()->find('USED000000000000')->seq; // across coaches: the test reads every row

    // Node, since: the open code was redeemed, the pending offer accepted, the withdrawn one
    // pruned, program p2 deleted, and a new invite minted.
    $this->db['invites'][0] += ['usedBy' => 'oth0000000000000', 'usedAt' => '2026-04-01T00:00:00.000Z'];
    $this->db['invites'][] = ['code' => 'NEW0000000000000', 'note' => '', 'createdBy' => 'cch0000000000000', 'created' => '2026-04-02T00:00:00.000Z', 'coachId' => 'cch0000000000000'];
    $this->db['assignments'][0]['status'] = 'accepted';
    $this->db['assignments'][0]['decidedAt'] = '2026-04-03T00:00:00.000Z';
    unset($this->db['assignments'][2]);
    ($this->write)();
    $lib = json_decode(file_get_contents($this->dir.'/coach-cch0000000000000.json'));
    array_pop($lib->programs);
    file_put_contents($this->dir.'/coach-cch0000000000000.json', json_encode($lib));

    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])->assertSuccessful()
        ->expectsOutputToContain('removed 2 invite/program/assignment row(s)');
    expect(Invite::acrossCoaches()->find('OPEN000000000000')->used_by)->toBe('oth0000000000000') // across coaches: the test reads every row
        ->and(Invite::acrossCoaches()->find('USED000000000000')->seq)->toBe($seq) // across coaches: the test reads every row
        ->and(Invite::acrossCoaches()->orderBy('seq')->pluck('code')->last())->toBe('NEW0000000000000') // across coaches: the test reads every row
        ->and(Assignment::acrossCoaches()->orderBy('id')->pluck('status', 'id')->all())->toBe(['acc0000000000000' => 'accepted', 'pend000000000000' => 'accepted']) // across coaches: the test reads every row
        ->and(CoachProgram::acrossCoaches()->pluck('id', 'program_id')->all())->toBe(['p1' => $p1]); // across coaches: the test reads every row
    // And once more, unchanged: nothing moves.
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()->doesntExpectOutputToContain('removed');
});

it('fails verification when the database no longer says what the files say', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    Assignment::acrossCoaches()->whereKey('pend000000000000')->update(['note' => 'edited']); // across coaches: the test writes a fixture row
    CoachProgram::acrossCoaches()->where('program_id', 'p2')->update(['bundle' => '{"opengym_plan":1,"week":[]}']); // across coaches: the test writes a fixture row
    Invite::acrossCoaches()->whereKey('GENERAL000000000')->update(['note' => 'x']); // across coaches: the test writes a fixture row
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify-only' => true])->assertFailed()
        ->expectsOutputToContain('mem0000000000000: GET /api/assignments differs from the files')
        ->expectsOutputToContain('cch0000000000000: GET /api/coach/programs differs from the files')
        ->expectsOutputToContain('adm0000000000000: GET /api/admin/invites differs from the files');
});

it('reports what it cannot import instead of stopping', function () {
    $this->db['invites'][] = $this->db['invites'][0];   // a repeated code
    $this->db['invites'][] = ['code' => 'ORPHAN0000000000', 'note' => '', 'createdBy' => 'x', 'created' => '2026-02-07T00:00:00.000Z', 'coachId' => 'nobody', 'requestId' => 'r1'];
    $this->db['assignments'][] = ['id' => 'ghost00000000000', 'coachId' => 'nobody', 'memberId' => 'mem0000000000000', 'status' => 'pending', 'created' => '2026-03-02T00:00:00.000Z'];
    ($this->write)();
    file_put_contents($this->dir.'/coach-nobody0000000000.json', '{"programs":[]}');
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()
        ->expectsOutputToContain('invites 5 · programs 2 · assignments 3')
        ->expectsOutputToContain('skipped invite OPEN000000000000 (a second row with the same code)')
        ->expectsOutputToContain('skipped coach of invite ORPHAN0000000000 (nobody: no such account; kept as a general code)')
        ->expectsOutputToContain('skipped requestId of invite ORPHAN0000000000')
        ->expectsOutputToContain('skipped assignment ghost00000000000 (its coach or member is not an account)')
        ->expectsOutputToContain('skipped coach-nobody0000000000.json (no such account)');
});

it('verifies against what it imported: a reported, deliberate change is not a failure for ever', function () {
    $this->db['invites'][] = ['code' => 'ORPHAN0000000000', 'note' => '', 'createdBy' => 'x', 'created' => '2026-02-07T00:00:00.000Z', 'coachId' => 'nobody', 'requestId' => 'r1'];
    $this->db['invites'][] = $this->db['invites'][0];
    $this->db['assignments'][] = ['id' => 'ghost00000000000', 'coachId' => 'nobody', 'memberId' => 'mem0000000000000', 'status' => 'pending', 'created' => '2026-03-02T00:00:00.000Z'];
    ($this->write)();
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])->assertSuccessful()
        ->expectsOutputToContain('the coaching routes match the files');
});

it('refuses an empty db.json, or one with no users list, before writing anything', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    foreach (['', "  \n", '{}', '{"users":{}}', '[]'] as $broken) {
        file_put_contents($this->dir.'/db.json', $broken);
        $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertFailed()
            ->expectsOutputToContain('db.json is not a Node API database');
    }
    expect(Invite::acrossCoaches()->count())->toBe(4)->and(Assignment::acrossCoaches()->count())->toBe(3); // across coaches: the test reads every row
});

it('leaves a library alone when its file cannot be read, and says so', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    file_put_contents($this->dir.'/coach-cch0000000000000.json', '{"programs":[{"id":"p1"');   // a torn write
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()
        ->expectsOutputToContain('skipped coach-cch0000000000000.json (cannot be read; this library is left as it was)')
        ->doesntExpectOutputToContain('removed');
    expect(CoachProgram::acrossCoaches()->orderBy('id')->pluck('program_id')->all())->toBe(['p1', 'p2']); // across coaches: the test reads every row
});

it('skips a row whose text is not text, or would not fit its column, instead of dying on it', function () {
    $this->db['invites'][1]['note'] = str_repeat('é', 61);
    $this->db['assignments'][1]['note'] = ['an' => 'object'];
    ($this->write)();
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()
        ->expectsOutputToContain('invites 3 · programs 2 · assignments 2')
        ->expectsOutputToContain('skipped invite USED000000000000 (note is longer than 60 characters)')
        ->expectsOutputToContain('skipped assignment acc0000000000000 (note is not text)');
});

it('writes the coaching data in one transaction: a failure halfway removes nothing', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    array_pop($this->db['invites']);   // the mirror would remove GENERAL…
    ($this->write)();
    DB::connection()->beforeExecuting(function (string $sql) {
        if (str_contains($sql, '"assignments"') && str_starts_with(strtolower($sql), 'insert')) {
            throw new RuntimeException('disk full');   // …but the offers fail to write
        }
    });
    expect(fn () => $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->run())->toThrow(RuntimeException::class);
    expect(Invite::acrossCoaches()->find('GENERAL000000000'))->not->toBeNull(); // across coaches: the test reads every row
});

it('verifies programs against what it imported too, skipping what it cannot serve back as Node did', function () {
    file_put_contents($this->dir.'/coach-cch0000000000000.json', json_encode(['programs' => [
        ['id' => 'p1', 'name' => 'First', 'created' => 1770000000000, 'updated' => 1770000001000, 'bundle' => ['opengym_plan' => 1]],
        ['id' => 'p1', 'name' => 'Again', 'created' => 1, 'updated' => 1, 'bundle' => ['opengym_plan' => 1]],
        ['id' => 'p2', 'name' => 'Stringly', 'created' => '1770000000000', 'updated' => 1, 'bundle' => ['opengym_plan' => 1]],
        ['id' => 'p3', 'name' => 'Negative', 'created' => -1, 'updated' => 1, 'bundle' => ['opengym_plan' => 1]],
        ['id' => 'p4', 'name' => 'No plan', 'created' => 1, 'updated' => 1],
        ['id' => 'p5', 'name' => str_repeat('x', 61), 'created' => 1, 'updated' => 1, 'bundle' => ['opengym_plan' => 1]],
    ]]));
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])->assertSuccessful()
        ->expectsOutputToContain('programs 1')
        ->expectsOutputToContain('program p1 (a second row with the same id)')
        ->expectsOutputToContain('program p2 (created is not a timestamp in milliseconds)')
        ->expectsOutputToContain('program p3 (created is not a timestamp in milliseconds)')
        ->expectsOutputToContain('program p4 (bundle is not a plan)')
        ->expectsOutputToContain('program p5 (name is longer than 60 characters)')
        ->expectsOutputToContain('the coaching routes match the files');
});

it('skips a later row with a repeated id even when the first one was refused, as Node served the first', function () {
    $ghost = ['id' => 'pend000000000000', 'coachId' => 'nobody', 'memberId' => 'mem0000000000000', 'bundle' => ['opengym_plan' => 1], 'note' => '', 'coachName' => 'X', 'status' => 'pending', 'created' => '2026-01-01T00:00:00.000Z'];
    array_unshift($this->db['assignments'], $ghost);
    unset($this->db['invites'][0]['created']);
    $this->db['invites'][] = ['code' => 'OPEN000000000000', 'note' => 'later', 'createdBy' => 'cch0000000000000', 'created' => '2026-05-01T00:00:00.000Z'];
    ($this->write)();
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])->assertSuccessful()
        ->expectsOutputToContain('skipped assignment pend000000000000 (its coach or member is not an account)')
        ->expectsOutputToContain('skipped assignment pend000000000000 (a second row with the same id)')
        ->expectsOutputToContain('skipped invite OPEN000000000000 (created is missing)')
        ->expectsOutputToContain('skipped invite OPEN000000000000 (a second row with the same code)');
    expect(Assignment::acrossCoaches()->find('pend000000000000'))->toBeNull() // across coaches: the test reads every row
        ->and(Invite::acrossCoaches()->find('OPEN000000000000'))->toBeNull(); // across coaches: the test reads every row
});

it('empties a library whose file holds valid JSON without a list, as readCoachData served it', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    file_put_contents($this->dir.'/coach-cch0000000000000.json', 'null');
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])->assertSuccessful()
        ->expectsOutputToContain('removed 2 invite/program/assignment row(s)');
    expect(CoachProgram::acrossCoaches()->count())->toBe(0); // across coaches: the test reads every row
});

it('finds the files in a data directory whose path holds glob characters', function () {
    $odd = sys_get_temp_dir().'/fitpal-[coaching]-'.bin2hex(random_bytes(4));
    mkdir($odd);
    foreach (glob($this->dir.'/*') as $f) {
        copy($f, $odd.'/'.basename($f));
    }
    try {
        $this->artisan('fitpal:import-legacy', ['dataDir' => $odd])->assertSuccessful()
            ->expectsOutputToContain('invites 4 · programs 2 · assignments 3');
    } finally {
        array_map('unlink', array_map(fn ($n) => $odd.'/'.$n, array_diff(scandir($odd), ['.', '..'])));
        rmdir($odd);
    }
});

it('reads db.json as JSON.parse did: a lone surrogate does not refuse the file', function () {
    $json = json_encode($this->db, JSON_UNESCAPED_SLASHES);
    file_put_contents($this->dir.'/db.json', str_replace('"note":"go"', '"note":"go \\ud83d"', $json));
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    expect(Assignment::acrossCoaches()->find('pend000000000000')->note)->toBe("go \u{FFFD}"); // across coaches: the test reads every row
});
