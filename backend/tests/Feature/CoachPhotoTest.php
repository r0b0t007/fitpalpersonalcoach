<?php

// A coach's page photo (CHW-356): uploaded from "Ma page", kept only as a JPEG with nothing in it
// but the picture, public while the page is open, and in the link preview.

use App\Media\Jpeg;
use App\Media\Paths;
use App\Media\Upload;
use App\Models\CoachPage;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Http\Request;
use Tests\Support\Billing;
use Tests\Support\Coaching;
use Tests\Support\MediaFixtures;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'https://coach.example', 'fitpal.free_cap' => 0]);
    $this->f = Coaching::twoCoaches();
    $this->dataDir = sys_get_temp_dir().'/fitpal-coachphoto-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir]);
});

afterEach(function () {
    (new Filesystem)->deleteDirectory($this->dataDir);
});

function photoPage(object $coach, array $fields = []): CoachPage
{
    return Coaching::own(new CoachPage, $coach, $fields + ['handle' => 'sara.fit', 'bio' => '', 'whatsapp' => '', 'open' => true, 'theme' => 'dark', 'created' => 1, 'updated' => 1]);
}

function putPhoto(object $coach, string $body)
{
    return MediaFixtures::post($coach, '/api/coach/page/photo', $body);
}

/** The stored files of a coach's photo directory. */
function photoFiles(object $coach): array
{
    return glob(Paths::coachDir($coach->id).DIRECTORY_SEPARATOR.'*') ?: [];
}

it('keeps the picture of a JPEG and nothing else: no EXIF, comment or what follows the end', function () {
    $in = MediaFixtures::cameraJpeg(1200, 900);
    $out = Jpeg::clean($in);
    expect($out)->toMatchArray(['w' => 1200, 'h' => 900])
        ->and($out['bytes'])->not->toContain('GPS')->not->toContain('shot at home')->not->toContain('ftyp')
        ->toStartWith("\xFF\xD8\xFF\xE0")->toEndWith("\x9A\xBC\xFF\xD9")
        // Both scans, their coded data byte for byte, stuffed FF and restart included.
        ->toContain("\x12\x34\xFF\x00\x56\xFF\xD0\x78")->toContain(MediaFixtures::seg(0xC4, "\x10".str_repeat("\x00", 16)));
});

it('says what is not a whole JPEG', function (string $bytes) {
    expect(Jpeg::clean($bytes))->toBeNull();
})->with([
    'not a JPEG' => ["\x89PNG\r\n\x1a\n"],
    'cut off mid-segment' => [substr(MediaFixtures::cameraJpeg(), 0, 60)],
    'cut off mid-scan' => [explode("\xFF\xD9", MediaFixtures::cameraJpeg())[0]],
    'no frame' => ["\xFF\xD8".MediaFixtures::seg(0xDA, "\x01\x01\x00\x00\x3F\x00")."\x00\xFF\xD9"],
    'no scan' => ["\xFF\xD8".MediaFixtures::seg(0xC0, "\x08\x01\x00\x01\x00\x01\x01\x11\x00")."\xFF\xD9"],
]);

it('stores the cleaned photo and shows it on the page, in the preview, to anyone', function () {
    photoPage($this->f->a);
    $res = putPhoto($this->f->a, MediaFixtures::cameraJpeg())->assertOk();
    $own = $res->json('page.photo');
    expect($own)->toStartWith('/api/coach/page/photo?v=');

    $files = photoFiles($this->f->a);
    expect($files)->toHaveCount(1)
        ->and(file_get_contents($files[0]))->toBe(Jpeg::clean(MediaFixtures::cameraJpeg())['bytes']);

    $public = $this->getJson('/api/public/coach?h=sara.fit')->assertOk()->json('coach.photo');
    expect($public)->toStartWith('/api/public/coach/photo?h=sara.fit&v=');
    $got = $this->get($public)->assertOk()->assertHeader('Content-Type', 'image/jpeg');
    expect($got->headers->get('Cache-Control'))->toContain('public')->toContain('max-age=3600')
        ->and($got->streamedContent())->not->toContain('GPS');
    expect($this->get('/api/c/sara.fit')->getContent())->toContain('<meta property="og:image" content="https://coach.example'.e($public).'">');
    $this->get($own, bearer($this->f->a))->assertOk();
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.page.photo', 'msg' => 'sara.fit']);
});

it('falls back to the app icon in the preview without a photo', function () {
    photoPage($this->f->a);
    expect($this->getJson('/api/public/coach?h=sara.fit')->json('coach.photo'))->toBeNull()
        ->and($this->get('/api/c/sara.fit')->getContent())->toContain('content="https://coach.example/icon-512.png"');
});

it('hides it with a closed page or a coach who no longer coaches, and shows the coach theirs', function () {
    $page = photoPage($this->f->a);
    $public = putPhoto($this->f->a, MediaFixtures::cameraJpeg())->assertOk();
    $url = $this->getJson('/api/public/coach?h=sara.fit')->json('coach.photo');
    $page->refresh()->forceFill(['open' => false])->save();
    $this->get($url)->assertNotFound();
    $this->get($public->json('page.photo'), bearer($this->f->a))->assertOk();   // still theirs to see
    $page->forceFill(['open' => true])->save();
    $this->get($url)->assertOk();
    $this->f->a->forceFill(['coach' => false])->save();
    $this->get($url)->assertNotFound();
});

it('replaces the old photo, and removes it — on a read-only plan too', function () {
    photoPage($this->f->a);
    putPhoto($this->f->a, MediaFixtures::cameraJpeg())->assertOk();
    $first = photoFiles($this->f->a);
    putPhoto($this->f->a, MediaFixtures::cameraJpeg(800, 800))->assertOk();
    $second = photoFiles($this->f->a);
    expect($second)->toHaveCount(1)->and($second)->not->toBe($first);

    Billing::on();   // billing on, no licence, no Free plan: read-only
    putPhoto($this->f->a, MediaFixtures::cameraJpeg())->assertStatus(402);
    $this->postJson('/api/coach/page/photo/remove', [], bearer($this->f->a))->assertOk()->assertJsonPath('page.photo', null);
    expect(photoFiles($this->f->a))->toBe([]);
    $this->get('/api/coach/page/photo', bearer($this->f->a))->assertNotFound();
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.page.photo.remove', 'msg' => 'sara.fit']);
});

it('refuses a photo it cannot use, and one with no page to go on', function () {
    putPhoto($this->f->a, MediaFixtures::cameraJpeg())->assertStatus(409)->assertExactJson(['error' => 'save your page first']);
    photoPage($this->f->a);
    $unusable = ['error' => 'that photo could not be used — try another'];
    putPhoto($this->f->a, MediaFixtures::cameraJpeg(120, 120))->assertStatus(415)->assertExactJson($unusable);
    putPhoto($this->f->a, MediaFixtures::cameraJpeg(6000, 1000))->assertStatus(415)->assertExactJson($unusable);
    putPhoto($this->f->a, MediaFixtures::jpeg())->assertStatus(415)->assertExactJson($unusable);   // the signature, not a JPEG
    putPhoto($this->f->a, str_pad("\x89PNG\r\n\x1a\n", 2048, "\0"))->assertStatus(415);
    putPhoto($this->f->a, MediaFixtures::cameraJpeg().str_repeat("\0", 4 * 1048576))->assertStatus(413);
    putPhoto($this->f->a1, MediaFixtures::cameraJpeg())->assertStatus(403);   // a client is not a coach
    expect(photoFiles($this->f->a))->toBe([]);
});

it("never shows one coach another's photo", function () {
    photoPage($this->f->a);
    putPhoto($this->f->a, MediaFixtures::cameraJpeg())->assertOk();
    $this->get('/api/coach/page/photo', bearer($this->f->b))->assertNotFound();
    $this->postJson('/api/coach/page/photo/remove', [], bearer($this->f->b))->assertNotFound();
    expect(photoFiles($this->f->a))->toHaveCount(1);
});

it('keeps of the other segments only what a decoder needs: no thumbnail, no extension, no stranger', function () {
    $seg = fn (int $m, string $d) => MediaFixtures::seg($m, $d);
    $frame = $seg(0xC0, "\x08".pack('n', 300).pack('n', 400)."\x01\x01\x11\x00").$seg(0xDA, "\x01\x01\x00\x00\x3F\x00")."\x12\xFF\xD9";
    $thumb = str_repeat("\xAB", 2 * 2 * 3);   // a 2×2 RGB thumbnail of the uncropped photo
    $in = "\xFF\xD8"
        .$seg(0xE0, "JFIF\0\x01\x02\x01\x00\x48\x00\x48\x02\x02".$thumb)
        .$seg(0xE0, "JFXX\0\x13".str_repeat("\xCD", 32))
        .$seg(0xEE, "Adobe\x00\x64\x00\x00\x00\x00\x01".'hidden after the flags')
        .$seg(0xF0, 'an extension a decoder skips')
        .$frame;
    $out = Jpeg::clean($in)['bytes'];
    expect($out)->toBe("\xFF\xD8"
        .$seg(0xE0, "JFIF\0\x01\x02\x01\x00\x48\x00\x48\x00\x00")
        .$seg(0xEE, "Adobe\x00\x64\x00\x00\x00\x00\x01")
        .$frame);
});

it('tells a body over post_max_size the page photo cap, in its words', function () {
    config(['fitpal.media_max_photo_mb' => 12]);
    $res = Upload::tooLargeFor(Request::create('/api/coach/page/photo', 'POST'));
    expect($res->getStatusCode())->toBe(413)
        ->and($res->getData(true))->toBe(['error' => 'file is larger than the 4 MB limit', 'msg' => ['k' => 'file is larger than the {0} MB limit', 'v' => [4]]]);
});
