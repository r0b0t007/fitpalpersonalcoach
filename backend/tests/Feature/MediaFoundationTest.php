<?php

// The media machinery under the routes of CHW-257/258: App\Media\Serve (api/server.js serveMedia)
// against every range case of the coach-smoke section "serving the bytes back", and App\Media\Upload
// (streamToFile) against "media upload: what it accepts and refuses" and "…the size cap". Served
// through test routes in the API's own middleware group, so NoStore and the error envelope apply.

use App\Media\Paths;
use App\Media\Serve;
use App\Media\Upload;
use App\Support\Json;
use App\Support\Uid;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use Illuminate\Testing\TestResponse;

beforeEach(function () {
    $this->dataDir = sys_get_temp_dir().'/fitpal-media-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir, 'fitpal.media_max_video_mb' => 1]);
    $this->file = Paths::dir('ex').'/clip.mp4';
    $this->bytes = implode('', array_map(fn ($i) => chr($i % 251), range(0, 999)));   // 1000 known bytes
    file_put_contents($this->file, $this->bytes);
    Route::middleware('api')->match(['GET', 'HEAD'], '/api/__serve', fn (Request $r) => Serve::file($r, $r->query('f') ? Paths::root().'/'.$r->query('f') : $this->file, 'video/mp4'));
    Route::middleware('api')->post('/api/__upload', function (Request $r) {
        $u = Upload::stream($r, Paths::dir('ex'), Upload::maxVideo(), $r->query('want', 'video'));
        unlink($u['tmp']);

        return Json::ok(['bytes' => $u['bytes'], 'sha' => $u['sha'], 'meta' => $u['meta']]);
    });
});

afterEach(function () {
    (new Filesystem)->deleteDirectory($this->dataDir);
});

function ranged(?string $range, string $method = 'GET'): TestResponse
{
    return test()->call($method, '/api/__serve', [], [], [], $range === null ? [] : ['HTTP_RANGE' => $range]);
}

it('== serving the bytes back ==: the whole file, then each range', function () {
    $r = ranged(null)->assertOk();
    expect($r->streamedContent())->toBe($this->bytes)
        ->and($r->headers->get('Content-Length'))->toBe('1000')
        ->and($r->headers->get('Accept-Ranges'))->toBe('bytes')
        ->and($r->headers->get('Content-Type'))->toBe('video/mp4')
        ->and($r->headers->get('Cache-Control'))->toContain('immutable')->toContain('private')->toContain('max-age=31536000')
        ->and($r->headers->get('Cache-Control'))->not->toContain('no-store');

    $r = ranged('bytes=10-19')->assertStatus(206);
    expect($r->streamedContent())->toBe(substr($this->bytes, 10, 10))
        ->and($r->headers->get('Content-Range'))->toBe('bytes 10-19/1000')
        ->and($r->headers->get('Content-Length'))->toBe('10');

    expect(ranged('bytes=990-')->assertStatus(206)->streamedContent())->toBe(substr($this->bytes, 990));       // open end
    expect(ranged('bytes=-5')->assertStatus(206)->streamedContent())->toBe(substr($this->bytes, -5));          // suffix
    expect(ranged('bytes=-5000')->assertStatus(206)->headers->get('Content-Range'))->toBe('bytes 0-999/1000'); // suffix past the size
    expect(ranged('bytes=995-5000')->assertStatus(206)->headers->get('Content-Range'))->toBe('bytes 995-999/1000'); // clamped end
    expect(ranged(' bytes=0-0 ')->assertStatus(206)->streamedContent())->toBe($this->bytes[0]);              // trimmed
});

it('answers a range that cannot be met with a 416 that is never cached', function (string $range) {
    $r = ranged($range)->assertStatus(416)->assertExactJson(['error' => 'range not satisfiable']);
    expect($r->headers->get('Content-Range'))->toBe('bytes */1000')
        ->and($r->headers->get('Cache-Control'))->toContain('no-store')
        ->and($r->headers->get('Cache-Control'))->not->toContain('immutable')
        ->and($r->headers->get('Accept-Ranges'))->toBe('bytes');
})->with(['bytes=1000-', 'bytes=5000-6000', 'bytes=20-10', 'bytes=-0', 'bytes=99999999999999999999999-']);

it('ignores a range it cannot act on and sends the whole file', function (string $range) {
    expect(ranged($range)->assertOk()->streamedContent())->toBe($this->bytes);
})->with(['bytes=0-9,20-29', 'items=0-9', 'bytes=abc', 'bytes=-', 'bytes']);

it('answers HEAD with the headers and no body', function () {
    $r = ranged(null, 'HEAD')->assertOk();
    expect($r->streamedContent())->toBe('')->and($r->headers->get('Content-Length'))->toBe('1000');
    expect(ranged('bytes=0-9', 'HEAD')->assertStatus(206)->streamedContent())->toBe('');
});

it('treats an empty file as unreadable in any range, and serves it whole without one', function () {
    file_put_contents($this->file, '');
    ranged('bytes=0-')->assertStatus(416);
    expect(ranged(null)->assertOk()->headers->get('Content-Length'))->toBe('0');
});

it('answers a missing file with not found', function () {
    $this->getJson('/api/__serve?f=ex/nope.mp4')->assertStatus(404)->assertExactJson(['error' => 'not found']);
});

/** A minimal MP4 header, padded to $size bytes. */
function mp4(int $size = 200, string $brand = 'isom'): string
{
    return str_pad(pack('N', 24).'ftyp'.$brand.pack('N', 0x200).'isomavc1', $size, 'x');
}

function upload(string $body, string $want = 'video', array $server = []): TestResponse
{
    return test()->call('POST', '/api/__upload?want='.$want, [], [], [], $server + ['CONTENT_TYPE' => 'application/octet-stream'], $body);
}

function leftovers(string $root): array
{
    return glob($root.'/media/ex/.up-*') ?: [];
}

it('streams an upload to a temp file, hashed and sniffed', function () {
    $body = mp4(300_000);
    upload($body)->assertOk()->assertJson(['bytes' => 300_000, 'sha' => hash('sha256', $body),
        'meta' => ['kind' => 'video', 'ext' => 'mp4', 'mime' => 'video/mp4', 'needsTranscode' => false]]);
    upload(mp4(200, 'qt  '))->assertOk()->assertJsonPath('meta.needsTranscode', true);
});

it('== media upload: what it accepts and refuses ==, leaving nothing behind', function () {
    upload(str_repeat('junk', 100))->assertStatus(415)->assertExactJson(['error' => 'not a recognised image or video file']);
    upload("\xFF\xD8\xFF\xE0".str_repeat("\0", 100))->assertStatus(415)->assertExactJson([
        'error' => 'expected a video, got image/jpeg', 'msg' => ['k' => 'expected a video, got {0}', 'v' => ['image/jpeg']],
    ]);
    upload('')->assertStatus(400)->assertExactJson(['error' => 'empty upload']);
    upload('tiny')->assertStatus(415);   // shorter than the window, still judged
    upload(mp4(), 'video', ['CONTENT_LENGTH' => '500'])->assertStatus(400)->assertExactJson(['error' => 'upload interrupted']);
    expect(leftovers($this->dataDir))->toBe([]);
});

it('== media upload: the size cap ==', function () {
    upload(mp4(1024 * 1024 + 1))->assertStatus(413)->assertExactJson([
        'error' => 'file is larger than the 1 MB limit', 'msg' => ['k' => 'file is larger than the {0} MB limit', 'v' => [1]],
    ]);
    upload(mp4(1024 * 1024))->assertOk();   // exactly the cap is allowed
    expect(leftovers($this->dataDir))->toBe([]);
});

it('judges each chunk as it arrives, as Node did: a junk file over the cap is refused as junk', function () {
    // The first chunk is under the cap and is sniffed before the rest arrives.
    upload(str_repeat('j', 70_000).str_repeat('x', 1024 * 1024))->assertStatus(415);
    expect(leftovers($this->dataDir))->toBe([]);
});

it('refuses a media directory it cannot create before reading anything, closing the connection', function () {
    config(['fitpal.data_dir' => $this->file]);   // a file where the directory should be
    Route::middleware('api')->post('/api/__dir', fn () => Json::ok(['dir' => Paths::dir('photo/x')]));
    $r = $this->postJson('/api/__dir')->assertStatus(500)->assertExactJson(['error' => 'media directory is not writable']);
    expect($r->headers->get('Connection'))->toBe('close');
});

it('names a user\'s files as Node did', function () {
    expect(Uid::safe('ab/c..d_e-F9'))->toBe('abcd_e-F9');
});

it('closes the connection on every refusal of a body still arriving, as Node\'s routes did', function () {
    foreach ([[str_repeat('junk', 100), 415], ['', 400], [mp4(1024 * 1024 + 1), 413]] as [$body, $status]) {
        expect(upload($body)->assertStatus($status)->headers->get('Connection'))->toBe('close');
    }
});

it('refuses a multipart body as Node did — its bytes were never a picture — leaving nothing behind', function () {
    upload('', 'video', ['CONTENT_TYPE' => 'multipart/form-data; boundary=x', 'CONTENT_LENGTH' => '3000000'])
        ->assertStatus(415)->assertExactJson(['error' => 'not a recognised image or video file']);
    expect(leftovers($this->dataDir))->toBe([]);
});

it('builds the media disk from the same root the routes write to', function () {
    expect(Paths::disk()->exists('ex/clip.mp4'))->toBeTrue();
    config(['fitpal.data_dir' => $this->dataDir.'/elsewhere']);
    expect(Paths::disk()->exists('ex/clip.mp4'))->toBeFalse();
});

it('answers a body PHP refused for post_max_size in the upload\'s own words', function () {
    $r = Upload::tooLargeFor(Request::create('/api/media/exercise?ex=x', 'POST'));
    expect($r->getStatusCode())->toBe(413)
        ->and(json_decode($r->getContent(), true)['msg']['k'])->toBe('file is larger than the {0} MB limit')
        ->and($r->headers->get('Connection'))->toBe('close')
        ->and(Upload::tooLargeFor(Request::create('/media/photo', 'POST')))->not->toBeNull()
        ->and(Upload::tooLargeFor(Request::create('/api/data', 'PUT')))->toBeNull();
});

it('caps uploads at PHP\'s post_max_size, and says so at check-config', function () {
    $post = Upload::postMax();
    if ($post === null) {
        $this->markTestSkipped('post_max_size is unlimited here');
    }
    config(['fitpal.media_max_video_mb' => intdiv($post, 1048576) + 10, 'fitpal.session_secret' => str_repeat('ab', 32)]);
    expect(Upload::maxVideo())->toBe($post);
    $this->artisan('fitpal:check-config')->assertFailed()->expectsOutputToContain('is above PHP\'s post_max_size');
});
