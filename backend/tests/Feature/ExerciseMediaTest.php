<?php

// A coach's exercise demos (CHW-257): POST /api/media/exercise, GET /api/media/exercises,
// GET|HEAD /api/media/ex. Test names starting with "==" are the api/coach-smoke.sh sections of the
// same name. The fixture's coaches each own a row ('0001') whose file is not on disk.

use App\Models\ExerciseMedia;
use App\Models\User;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\Coaching;
use Tests\Support\MediaFixtures;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    $this->dataDir = sys_get_temp_dir().'/fitpal-exmedia-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir, 'fitpal.media_max_video_mb' => 1]);
});

afterEach(function () {
    (new Filesystem)->deleteDirectory($this->dataDir);
});

function mkfix(string $brand, string $compat = '', string $marker = 'pad', int $size = 4096): string
{
    return MediaFixtures::mkfix($brand, $compat, $marker, $size);
}

function up(?User $who, string $ex, string $body, string $label = 'front'): TestResponse
{
    return MediaFixtures::post($who, '/api/media/exercise?ex='.rawurlencode($ex).'&label='.rawurlencode($label), $body);
}

function listed(User $who): array
{
    return test()->getJson('/api/media/exercises', bearer($who))->assertOk()->json('media');
}

it('== media upload: role gating ==, every refusal closing the connection', function () {
    $f = $this->f;
    $demo = mkfix('isom', 'avc1');
    expect(up(null, '0025', $demo)->assertStatus(401)->assertExactJson(['error' => 'not signed in'])->headers->get('Connection'))->toBe('close');
    expect(up($f->a1, '0025', $demo)->assertStatus(403)->assertExactJson(['error' => 'forbidden'])->headers->get('Connection'))->toBe('close');
    $r = up($f->a, '0025', $demo, '  Front view  ')->assertOk();
    expect($r->headers->get('Connection'))->not->toBe('close')
        ->and($r->json('media'))->toMatchArray(['exId' => '0025', 'coachId' => $f->a->id, 'label' => 'Front view', 'bytes' => 4096, 'mime' => 'video/mp4', 'status' => 'ready'])
        ->and($r->json('media.file'))->toBe('0025-'.$f->a->id.'-'.substr(hash('sha256', $demo), 0, 16).'.mp4')
        ->and($r->json('media.id'))->toMatch('/^[A-Za-z0-9_-]{16}$/')
        ->and($r->json('media.created'))->toMatch('/Z$/');
    expect(is_file($this->dataDir.'/media/ex/'.$r->json('media.file')))->toBeTrue();
});

it('== media upload: what it accepts and refuses ==', function () {
    $a = $this->f->a;
    up($a, '0026', mkfix('qt  '))->assertOk()->assertJsonPath('media.status', 'raw')->assertJsonPath('media.mime', 'video/quicktime');
    up($a, '0025', mkfix('isom', 'iso2'))->assertOk()->assertJsonPath('media.status', 'ready');
    up($a, '0027', mkfix('heic', 'mif1'))->assertStatus(415)->assertJsonPath('error', 'expected a video, got image/heic');
    up($a, '0028', str_repeat("\0", 300000))->assertStatus(415)->assertExactJson(['error' => 'not a recognised image or video file']);
    up($a, '../../etc', mkfix('isom'))->assertStatus(400)->assertExactJson(['error' => 'bad exercise id']);
    up($a, str_repeat('x', 41), mkfix('isom'))->assertStatus(400);
    up($a, '0029', '')->assertStatus(400)->assertExactJson(['error' => 'empty upload']);
    expect(glob($this->dataDir.'/media/ex/.up-*'))->toBe([])
        ->and(glob($this->dataDir.'/media/ex/002[789]-*'))->toBe([]);
});

it('== media upload: the size cap ==', function () {
    up($this->f->a, '0033', mkfix('isom', 'avc1', 'big', 1024 * 1024 + 1))->assertStatus(413)->assertJsonPath('error', 'file is larger than the 1 MB limit');
    expect(glob($this->dataDir.'/media/ex/.up-*'))->toBe([])->and(glob($this->dataDir.'/media/ex/0033-*'))->toBe([]);
});

it('== media upload: the per-exercise cap holds ==, per coach', function () {
    $f = $this->f;
    foreach (range(1, 6) as $i) {
        up($f->a, '0040', mkfix('isom', 'avc1', "v$i"))->assertOk();
    }
    $r = up($f->a, '0040', mkfix('isom', 'avc1', 'v7'))->assertStatus(429)->assertExactJson([
        'error' => 'that exercise already has 6 videos', 'msg' => ['k' => 'that exercise already has {0} videos', 'v' => [6]],
    ]);
    expect($r->headers->get('Connection'))->toBe('close')
        ->and(glob($this->dataDir.'/media/ex/0040-*'))->toHaveCount(6);
    // Another coach's library is theirs: B is not capped by A's six (spec §5).
    up($f->b, '0040', mkfix('isom', 'avc1', 'b1'))->assertOk();
});

it('== media list ==: dedupes identical bytes, one row and one file', function () {
    $f = $this->f;
    $this->getJson('/api/media/exercises')->assertStatus(401);
    $demo = mkfix('isom', 'avc1');
    $first = up($f->a, '0025', $demo)->json('media.id');
    $second = up($f->a, '0025', $demo)->assertOk()->json('media.id');
    expect($second)->not->toBe($first)
        ->and(collect(listed($f->a))->where('exId', '0025')->pluck('id')->all())->toBe([$second])
        ->and(glob($this->dataDir.'/media/ex/0025-*'))->toHaveCount(1);
});

it('lists each viewer the demos they may see: their own, their coach\'s, or all for an admin', function () {
    $f = $this->f;
    $own = up($f->a, '0025', mkfix('isom', 'avc1'))->json('media');
    $byId = fn (User $u) => collect(listed($u))->pluck('id')->sort()->values()->all();
    expect($byId($f->a))->toBe(collect(['mediaa', $own['id']])->sort()->values()->all())
        ->and($byId($f->a1))->toBe($byId($f->a))                  // A's client sees A's
        ->and($byId($f->b1))->toBe(['mediab'])                    // B's client sees only B's
        ->and($byId($f->u1))->toBe([])                            // no coach, no demos
        ->and($byId($f->admin))->toHaveCount(4);                  // every coach's
    expect(collect(listed($f->a1))->firstWhere('id', $own['id']))->toEqual(collect($own)->except('coachId')->all());   // the upload's row, less who uploaded it
});

it('== serving the bytes back ==: through the route, to those who may see it', function () {
    $f = $this->f;
    $demo = mkfix('isom', 'avc1');
    $id = up($f->a, '0025', $demo)->json('media.id');
    $this->get('/api/media/ex?id='.$id)->assertStatus(401);
    $r = $this->get('/api/media/ex?id='.$id, bearer($f->a1))->assertOk();
    expect($r->streamedContent())->toBe($demo)
        ->and($r->headers->get('Accept-Ranges'))->toBe('bytes');
    $r = $this->get('/api/media/ex?id='.$id, bearer($f->a1) + ['Range' => 'bytes=0-99'])->assertStatus(206);
    expect($r->headers->get('Content-Range'))->toBe('bytes 0-99/4096')->and(strlen($r->streamedContent()))->toBe(100);
    $this->call('HEAD', '/api/media/ex?id='.$id, [], [], [], $this->transformHeadersToServerVars(bearer($f->a1)))->assertOk()->assertHeader('Content-Length', '4096');
    // Not theirs to see: the same 404 as an id that does not exist.
    $this->getJson('/api/media/ex?id='.$id, bearer($f->b1))->assertStatus(404)->assertExactJson(['error' => 'not found']);
    $this->getJson('/api/media/ex?id=nope', bearer($f->a1))->assertStatus(404);
    $this->getJson('/api/media/ex', bearer($f->a1))->assertStatus(404);
    // A row whose file is gone, and one whose stored name was hand-edited into a path: 404, never 500.
    $this->getJson('/api/media/ex?id=mediaa', bearer($f->a1))->assertStatus(404);
    ExerciseMedia::acrossCoaches()->whereKey('mediaa')->update(['file' => '../../db.json']); // across coaches: the test writes a fixture row
    $this->getJson('/api/media/ex?id=mediaa', bearer($f->a1))->assertStatus(404)->assertExactJson(['error' => 'not found']);
});

it('records nothing and keeps nothing when the row cannot be written', function () {
    // The row's id column is 16 wide; a forced failure stands in for a full disk.
    ExerciseMedia::creating(fn () => throw new RuntimeException('disk full'));
    up($this->f->a, '0050', mkfix('isom', 'avc1'))->assertStatus(507)->assertExactJson(['error' => 'could not record the upload — is the disk full?']);
    expect(glob($this->dataDir.'/media/ex/0050-*'))->toBe([])->and(glob($this->dataDir.'/media/ex/.up-*'))->toBe([]);
});

it('refuses an upload whose coach lost the role, or the account, while it streamed', function (array $change, int $status) {
    $f = $this->f;
    // Past RequireCoach; then, while the file streams, an admin's detach commits. Simulated by
    // changing the row just before the upload's locked read of it.
    $done = false;
    DB::connection()->beforeExecuting(function (string $sql) use (&$done, $f, $change) {
        if (! $done && DB::transactionLevel() >= 2 && str_contains($sql, 'from "users"')) {
            $done = true;
            DB::table('users')->where('id', $f->a->id)->update($change);
        }
    });
    up($f->a, '0060', mkfix('isom', 'avc1', 'late'))->assertStatus($status);
    expect($done)->toBeTrue()
        ->and(ExerciseMedia::acrossCoaches()->where('ex_id', '0060')->exists())->toBeFalse() // across coaches: the test reads every row
        ->and(glob($this->dataDir.'/media/ex/*0060*'))->toBe([]);
})->with([
    'role revoked' => [['coach' => false], 403],
    'disabled' => [['disabled' => true], 401],
]);

it('replaces a demo uploaded to the Node API, named without its coach, when the same bytes come again', function () {
    $f = $this->f;
    $demo = mkfix('isom', 'avc1', 'node-era');
    $legacy = '0070-'.substr(hash('sha256', $demo), 0, 16).'.mp4';
    @mkdir($this->dataDir.'/media/ex', 0700, true);
    file_put_contents($this->dataDir.'/media/ex/'.$legacy, $demo);
    Coaching::own(new ExerciseMedia, $f->a, ['id' => 'nodeEraRow000000', 'ex_id' => '0070', 'file' => $legacy, 'label' => '', 'bytes' => 4096, 'mime' => 'video/mp4', 'status' => 'ready', 'created' => '2026-01-01T00:00:00.000Z']);
    up($f->a, '0070', $demo)->assertOk();
    expect(collect(listed($f->a))->where('exId', '0070')->pluck('file')->all())->toBe(['0070-'.$f->a->id.'-'.substr(hash('sha256', $demo), 0, 16).'.mp4'])
        ->and(is_file($this->dataDir.'/media/ex/'.$legacy))->toBeFalse();
});

it('leaves a file of the old name alone when no row of this coach named it', function () {
    $demo = mkfix('isom', 'avc1', 'not-ours');
    $legacy = '0071-'.substr(hash('sha256', $demo), 0, 16).'.mp4';
    @mkdir($this->dataDir.'/media/ex', 0700, true);
    file_put_contents($this->dataDir.'/media/ex/'.$legacy, $demo);
    up($this->f->a, '0071', $demo)->assertOk();
    expect(is_file($this->dataDir.'/media/ex/'.$legacy))->toBeTrue();
});

it('answers 507 only for the row write itself; a failed lock is an ordinary 500', function () {
    DB::connection()->beforeExecuting(function (string $sql) {
        if (DB::transactionLevel() >= 2 && str_contains($sql, 'from "users"')) {
            throw new RuntimeException('lock wait timeout');
        }
    });
    up($this->f->a, '0080', mkfix('isom', 'avc1', 'lock'))->assertStatus(500);
    expect(glob($this->dataDir.'/media/ex/.up-*'))->toBe([]);
});
