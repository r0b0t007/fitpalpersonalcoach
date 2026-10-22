<?php

// A client's progress photos (CHW-258): POST /api/media/photo, GET /api/media/photos, GET|HEAD
// /api/media/photo, and the photos on GET /api/coach/member. Test names starting with "==" are the
// api/coach-smoke.sh sections of the same name.

use App\Models\ProgressPhoto;
use App\Models\User;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\Coaching;
use Tests\Support\MediaFixtures;

const PD = '2026-05-04';

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    $this->dataDir = sys_get_temp_dir().'/fitpal-photos-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir, 'fitpal.media_max_photo_mb' => 1]);
});

afterEach(function () {
    (new Filesystem)->deleteDirectory($this->dataDir);
});

function photo(?User $who, string $body, string $d = PD, string $pose = 'front'): TestResponse
{
    return MediaFixtures::post($who, '/api/media/photo?d='.rawurlencode($d).'&pose='.rawurlencode($pose), $body);
}

function myPhotos(User $who): array
{
    return test()->getJson('/api/media/photos', bearer($who))->assertOk()->json('photos');
}

function readPhoto(?User $viewer, string $query): TestResponse
{
    return test()->get('/api/media/photo?'.$query, $viewer ? bearer($viewer) : []);
}

function photoDir(string $root, User $u): string
{
    return $root.'/media/photo/'.$u->id;
}

it('== progress photos: uploading ==', function () {
    $f = $this->f;
    $r = photo(null, MediaFixtures::jpeg())->assertStatus(401);
    expect($r->headers->get('Connection'))->toBe('close');
    $r = photo($f->a1, MediaFixtures::jpeg())->assertOk();
    expect($r->json())->toMatchArray(['ok' => true])
        ->and($r->json('photo'))->toMatchArray(['d' => PD, 'pose' => 'front', 'bytes' => 2048, 'mime' => 'image/jpeg'])
        ->and($r->json('photo'))->not->toHaveKey('file')
        ->and($r->json('photo.id'))->toMatch('/^[A-Za-z0-9_-]{16}$/');
    photo($f->a2, MediaFixtures::jpeg())->assertOk();
    photo($f->a1, MediaFixtures::mkfix('isom', 'avc1'), PD, 'side')->assertStatus(415)->assertJsonPath('error', 'expected an image, got video/mp4');
    photo($f->a1, MediaFixtures::mkfix('heic', 'mif1'), PD, 'side')->assertStatus(415)
        ->assertExactJson(['error' => 'HEIC photos do not display in most browsers — set the camera to “Most Compatible”, or export as JPEG']);
    foreach (['not-a-date', '../../etc', '2026-02-30', '0050-01-01'] as $bad) {
        $r = photo($f->a1, MediaFixtures::jpeg(), $bad)->assertStatus(400)->assertExactJson(['error' => 'bad date']);
        expect($r->headers->get('Connection'))->toBe('close');
    }
    photo($f->a1, MediaFixtures::jpeg(), PD, 'moon')->assertStatus(400)->assertExactJson(['error' => 'bad pose']);
    photo($f->a1, MediaFixtures::jpeg('big', 1024 * 1024 + 1), PD, 'side')->assertStatus(413)->assertJsonPath('error', 'file is larger than the 1 MB limit');
    expect(glob($this->dataDir.'/media/photo/*/.up-*'))->toBe([]);
});

it('== progress photos: the slot is (week, pose), and a retake replaces ==', function () {
    $a1 = $this->f->a1;
    $first = photo($a1, MediaFixtures::jpeg('one'))->json('photo.id');
    expect(myPhotos($a1))->toHaveCount(1)->and(myPhotos($a1)[0])->not->toHaveKey('file');
    $second = photo($a1, MediaFixtures::jpeg('two'))->assertOk()->json('photo.id');
    expect(myPhotos($a1))->toHaveCount(1)
        ->and(myPhotos($a1)[0]['id'])->toBe($second)
        ->and(glob(photoDir($this->dataDir, $a1).'/*'))->toHaveCount(1);
    readPhoto($a1, 'id='.$first)->assertStatus(403);
    photo($a1, MediaFixtures::jpeg('back'), PD, 'back')->assertOk();
    expect(array_column(myPhotos($a1), 'pose'))->toBe(['front', 'back']);
    // An earlier period sorts first, as Node's sidecar kept them.
    photo($a1, MediaFixtures::jpeg('older'), '2026-04-27')->assertOk();
    expect(array_column(myPhotos($a1), 'd'))->toBe(['2026-04-27', PD, PD]);
    foreach (glob(photoDir($this->dataDir, $a1).'/*') as $name) {
        expect(basename($name))->toMatch('/^[A-Za-z0-9_-]{22}\.jpg$/');
    }
    expect(DB::table('user_states')->where('user_id', $a1->id)->exists())->toBeFalse();
});

it('serves a stored name that begins with "-" or "_"', function () {
    $a1 = $this->f->a1;
    $id = photo($a1, MediaFixtures::jpeg())->json('photo.id');
    $row = ProgressPhoto::query()->where('id', $id)->first();
    rename(photoDir($this->dataDir, $a1).'/'.$row->file, photoDir($this->dataDir, $a1).'/-lead.jpg');
    $row->forceFill(['file' => '-lead.jpg'])->save();
    readPhoto($a1, 'id='.$id)->assertOk();
});

it('== progress photos: who may read the bytes ==', function () {
    $f = $this->f;
    $bytes = MediaFixtures::jpeg('mine', 3000);
    $id = photo($f->a1, $bytes)->json('photo.id');
    readPhoto(null, "u={$f->a1->id}&id=$id")->assertStatus(401);
    expect(readPhoto($f->a1, "u={$f->a1->id}&id=$id")->assertOk()->streamedContent())->toBe($bytes);
    readPhoto($f->a1, "id=$id")->assertOk();                       // without naming themselves
    readPhoto($f->a1, "u=&id=$id")->assertOk();                    // `u || user.id`
    expect(readPhoto($f->a, "u={$f->a1->id}&id=$id")->assertOk()->streamedContent())->toBe($bytes);   // their coach
    readPhoto($f->admin, "u={$f->a1->id}&id=$id")->assertOk();
    $refusals = [
        readPhoto($f->b, "u={$f->a1->id}&id=$id"),                  // another coach
        readPhoto($f->a2, "u={$f->a1->id}&id=$id"),                 // another client
        readPhoto($f->a2, "u={$f->a1->id}&id=nope"),                // a missing id
        readPhoto($f->a2, "u=ghost&id=$id"),                        // an unknown member
        readPhoto($f->a, "u={$f->d1->id}&id=$id"),                  // a disabled member
    ];
    foreach ($refusals as $r) {
        $r->assertStatus(403)->assertExactJson(['error' => 'forbidden']);
    }
    // A coach files a check-in photo of their own, and reads it — naming themselves too, which
    // self-coaching (canCoachMember) would refuse.
    $cid = photo($f->a, MediaFixtures::jpeg('coach'))->assertOk()->json('photo.id');
    readPhoto($f->a, "id=$cid")->assertOk();
    readPhoto($f->a, "u={$f->a->id}&id=$cid")->assertOk();
    $this->call('HEAD', "/api/media/photo?u={$f->a1->id}&id=$id", [], [], [], $this->transformHeadersToServerVars(bearer($f->a)))
        ->assertOk()->assertHeader('Content-Length', '3000');
    // A range, as an <img> never asks but a viewer might.
    $this->get("/api/media/photo?id=$id", bearer($f->a1) + ['Range' => 'bytes=0-9'])->assertStatus(206)->assertHeader('Content-Range', 'bytes 0-9/3000');
});

it('== progress photos: reaching the coach ==', function () {
    $f = $this->f;
    photo($f->a1, MediaFixtures::jpeg('f'))->assertOk();
    photo($f->a1, MediaFixtures::jpeg('s'), PD, 'side')->assertOk();
    $photos = $this->getJson('/api/coach/member?id='.$f->a1->id, bearer($f->a))->assertOk()->json('photos');
    expect($photos)->toHaveCount(2)
        ->and(array_keys($photos[0]))->toBe(['id', 'd', 'pose', 'bytes', 'mime', 'created']);
});

it('caps a client at 500 photos and 300 MB, but never a retake', function () {
    $a1 = $this->f->a1;
    $rows = [];
    foreach (range(0, 499) as $i) {
        $rows[] = ['id' => sprintf('cap%013d', $i), 'user_id' => $a1->id, 'd' => sprintf('2025-%02d-%02d', intdiv($i, 28) % 12 + 1, $i % 28 + 1), 'pose' => ['front', 'side', 'back'][intdiv($i, 336)], 'file' => "cap$i.jpg", 'bytes' => 1, 'mime' => 'image/jpeg', 'created' => '2025-01-01T00:00:00.000Z'];
    }
    ProgressPhoto::query()->insert($rows);
    $r = photo($a1, MediaFixtures::jpeg())->assertStatus(429)->assertExactJson([
        'error' => 'that is 500 photos already stored', 'msg' => ['k' => 'that is {0} photos already stored', 'v' => [500]],
    ]);
    expect($r->headers->get('Connection'))->toBe('close');
    // A retake of an existing slot is measured without that slot: it replaces, it does not add.
    $existing = ProgressPhoto::query()->where('user_id', $a1->id)->first();
    photo($a1, MediaFixtures::jpeg('retake'), $existing->d, $existing->pose)->assertOk();

    ProgressPhoto::query()->where('user_id', $a1->id)->delete();
    ProgressPhoto::query()->insert(['id' => 'heavy00000000000', 'user_id' => $a1->id, 'd' => '2025-01-01', 'pose' => 'front', 'file' => 'heavy.jpg', 'bytes' => 300 * 1024 * 1024, 'mime' => 'image/jpeg', 'created' => '2025-01-01T00:00:00.000Z']);
    photo($a1, MediaFixtures::jpeg())->assertStatus(429)->assertJsonPath('msg.k', 'that is {0} MB of photos already stored')->assertJsonPath('msg.v', [300]);
});

it('records nothing and keeps nothing when the row cannot be written', function () {
    ProgressPhoto::creating(fn () => throw new RuntimeException('disk full'));
    photo($this->f->a1, MediaFixtures::jpeg())->assertStatus(507)->assertExactJson(['error' => 'could not record the upload — is the disk full?']);
    expect(glob(photoDir($this->dataDir, $this->f->a1).'/*'))->toBe([]);
});

it('files nothing for an account disabled while its photo streamed', function () {
    $a1 = $this->f->a1;
    $done = false;
    DB::connection()->beforeExecuting(function (string $sql) use (&$done, $a1) {
        if (! $done && DB::transactionLevel() >= 2 && str_contains($sql, 'from "users"')) {
            $done = true;
            DB::table('users')->where('id', $a1->id)->update(['disabled' => true]);
        }
    });
    photo($a1, MediaFixtures::jpeg('late'))->assertStatus(401)->assertExactJson(['error' => 'not signed in']);
    expect($done)->toBeTrue()
        ->and(ProgressPhoto::query()->where('user_id', $a1->id)->exists())->toBeFalse()
        ->and(glob(photoDir($this->dataDir, $a1).'/*'))->toBe([]);
});
