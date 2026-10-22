<?php

// A demo sent in chunks (CHW-259): POST /api/media/exercise/upload, PUT …?id=&offset=, POST
// …/finish. Laravel's alone, advertised in /api/config; what it stores must be exactly what the
// one-shot POST /api/media/exercise stores.

use App\Http\Controllers\ChunkUploadController;
use App\Models\ExerciseMedia;
use App\Models\MediaUpload;
use App\Models\User;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Testing\TestResponse;
use Tests\Support\Coaching;
use Tests\Support\MediaFixtures;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    $this->dataDir = sys_get_temp_dir().'/fitpal-chunks-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir, 'fitpal.media_max_video_mb' => 1]);
});

afterEach(function () {
    (new Filesystem)->deleteDirectory($this->dataDir);
});

function startUpload(?User $who, string $ex, int $size, string $label = 'front'): TestResponse
{
    return MediaFixtures::post($who, "/api/media/exercise/upload?ex=$ex&label=".rawurlencode($label)."&size=$size", '');
}

function sendChunk(User $who, string $id, int $offset, string $bytes): TestResponse
{
    return test()->call('PUT', "/api/media/exercise/upload?id=$id&offset=$offset", [], [], [],
        test()->transformHeadersToServerVars(bearer($who)) + ['CONTENT_TYPE' => 'application/octet-stream', 'HTTP_ACCEPT' => 'application/json'], $bytes);
}

function finishUpload(User $who, string $id): TestResponse
{
    return MediaFixtures::post($who, "/api/media/exercise/upload/finish?id=$id", '');
}

/** The whole protocol for $body in chunks of $chunk bytes; the finish's response. */
function chunked(User $who, string $ex, string $body, int $chunk = 1000, string $label = 'front'): TestResponse
{
    $id = startUpload($who, $ex, strlen($body), $label)->assertOk()->json('upload');
    for ($at = 0; $at < strlen($body); $at += $chunk) {
        sendChunk($who, $id, $at, substr($body, $at, $chunk))->assertOk()->assertJsonPath('received', min(strlen($body), $at + $chunk));
    }

    return finishUpload($who, $id);
}

it('advertises chunks in /api/config, which the Node API never did', function () {
    $this->getJson('/api/config')->assertOk()->assertJsonPath('upload', ['chunked' => true, 'chunk_mb' => ChunkUploadController::CHUNK_MB]);
});

it('stores a chunked demo exactly as the one-shot upload stores it', function () {
    $f = $this->f;
    $demo = MediaFixtures::mkfix('isom', 'avc1', 'chunked');
    $r = chunked($f->a, '0025', $demo, 1000, '  Front view  ')->assertOk();
    expect($r->json('media'))->toMatchArray(['exId' => '0025', 'coachId' => $f->a->id, 'label' => 'Front view', 'bytes' => 4096, 'mime' => 'video/mp4', 'status' => 'ready'])
        ->and($r->json('media.file'))->toBe('0025-'.$f->a->id.'-'.substr(hash('sha256', $demo), 0, 16).'.mp4')
        ->and(file_get_contents($this->dataDir.'/media/ex/'.$r->json('media.file')))->toBe($demo)
        ->and(MediaUpload::acrossCoaches()->count())->toBe(0) // across coaches: the test reads every row
        ->and(glob($this->dataDir.'/media/ex/.up-*'))->toBe([]);
    // The same bytes one-shot: one row, one file — the two paths are one store.
    MediaFixtures::post($f->a, '/api/media/exercise?ex=0025', $demo)->assertOk();
    expect(ExerciseMedia::query()->where('ex_id', '0025')->count())->toBe(1);
    // An iPhone .mov, in chunks, is flagged raw.
    chunked($f->a, '0026', MediaFixtures::mkfix('qt  ', '', 'mov'))->assertOk()->assertJsonPath('media.status', 'raw');
});

it('refuses at the start what it would refuse at the end: the id, the cap, the size', function () {
    $f = $this->f;
    startUpload(null, '0025', 100)->assertStatus(401);
    startUpload($f->a1, '0025', 100)->assertStatus(403);
    startUpload($f->a, '../../etc', 100)->assertStatus(400)->assertExactJson(['error' => 'bad exercise id']);
    startUpload($f->a, '0025', 0)->assertStatus(400)->assertExactJson(['error' => 'empty upload']);
    MediaFixtures::post($f->a, '/api/media/exercise/upload?ex=0025&size=abc', '')->assertStatus(400);
    startUpload($f->a, '0025', 1024 * 1024 + 1)->assertStatus(413)->assertJsonPath('error', 'file is larger than the 1 MB limit');
    foreach (range(1, 6) as $i) {
        MediaFixtures::post($f->a, '/api/media/exercise?ex=0040', MediaFixtures::mkfix('isom', 'avc1', "v$i"))->assertOk();
    }
    startUpload($f->a, '0040', 100)->assertStatus(429)->assertJsonPath('msg.k', 'that exercise already has {0} videos');
});

it('refuses a photo or junk on the first chunk, not after the whole file', function () {
    $a = $this->f->a;
    $id = startUpload($a, '0027', 4096)->json('upload');
    sendChunk($a, $id, 0, substr(MediaFixtures::mkfix('heic', 'mif1'), 0, 1000))->assertStatus(415)->assertJsonPath('error', 'expected a video, got image/heic');
    expect(MediaUpload::acrossCoaches()->find($id))->toBeNull() // across coaches: the test reads every row
        ->and(glob($this->dataDir.'/media/ex/.up-*'))->toBe([]);
});

it('resumes where the server is: a chunk at the wrong offset is told the right one', function () {
    $a = $this->f->a;
    $demo = MediaFixtures::mkfix('isom', 'avc1', 'resume');
    $id = startUpload($a, '0030', 4096)->json('upload');
    sendChunk($a, $id, 0, substr($demo, 0, 1000))->assertOk();
    // A retry of the same chunk after a lost answer: out of step, with where to go on.
    $r = sendChunk($a, $id, 0, substr($demo, 0, 1000))->assertStatus(409)
        ->assertExactJson(['error' => 'the upload is out of step', 'received' => 1000]);
    expect($r->headers->get('Connection'))->toBe('close');
    sendChunk($a, $id, 2000, substr($demo, 2000, 1000))->assertStatus(409);
    sendChunk($a, $id, 1000, substr($demo, 1000))->assertOk()->assertJsonPath('received', 4096);
    expect(file_get_contents($this->dataDir.'/media/ex/'.finishUpload($a, $id)->assertOk()->json('media.file')))->toBe($demo);
});

it('refuses a chunk past the declared size, and a finish before every byte arrived', function () {
    $a = $this->f->a;
    $id = startUpload($a, '0031', 2000)->json('upload');
    sendChunk($a, $id, 0, MediaFixtures::mkfix('isom', 'avc1', 'x', 2500))->assertStatus(413);
    sendChunk($a, $id, 0, substr(MediaFixtures::mkfix('isom', 'avc1', 'x', 2000), 0, 1500))->assertOk();
    finishUpload($a, $id)->assertStatus(400)->assertExactJson(['error' => 'upload interrupted']);
    sendChunk($a, $id, 1500, '')->assertStatus(400)->assertExactJson(['error' => 'empty upload']);
});

it('keeps a coach\'s sessions to themselves, and to a few', function () {
    $f = $this->f;
    $id = startUpload($f->a, '0032', 4096)->json('upload');
    sendChunk($f->b, $id, 0, 'x')->assertStatus(404)->assertExactJson(['error' => 'not found']);
    finishUpload($f->b, $id)->assertStatus(404);
    foreach (range(1, MediaUpload::MAX_OPEN) as $i) {
        startUpload($f->a, "005$i", 4096)->assertOk();
    }
    expect(MediaUpload::acrossCoaches()->where('coach_id', $f->a->id)->count())->toBe(MediaUpload::MAX_OPEN) // across coaches: the test reads every row
        ->and(MediaUpload::acrossCoaches()->find($id))->toBeNull() // across coaches: the oldest went
        ->and(glob($this->dataDir.'/media/ex/.up-*'))->toHaveCount(MediaUpload::MAX_OPEN);
});

it('stores nothing for a coach who lost the role before the finish', function () {
    $a = $this->f->a;
    $demo = MediaFixtures::mkfix('isom', 'avc1', 'demoted');
    $id = startUpload($a, '0033', 4096)->json('upload');
    sendChunk($a, $id, 0, $demo)->assertOk();
    $a->forceFill(['coach' => false])->save();
    finishUpload($a, $id)->assertStatus(403);
    expect(ExerciseMedia::acrossCoaches()->where('ex_id', '0033')->exists())->toBeFalse(); // across coaches: the test reads every row
});

it('finishes once: a second finish of the same upload is not found', function () {
    $a = $this->f->a;
    $id = startUpload($a, '0034', 4096)->json('upload');
    sendChunk($a, $id, 0, MediaFixtures::mkfix('isom', 'avc1', 'once'))->assertOk();
    finishUpload($a, $id)->assertOk();
    finishUpload($a, $id)->assertStatus(404);
    expect(ExerciseMedia::query()->where('ex_id', '0034')->count())->toBe(1);
});
