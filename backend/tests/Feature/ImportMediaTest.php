<?php

// fitpal:import-legacy, the media and push half (CHW-264): db.subs, db.media and media-<uid>.json
// photo sidecars imported with the files left where Node wrote them, mirrored on a rerun, verified
// through the routes (with HEAD of every byte stream), and the VAPID pair reported on.

use App\Models\ExerciseMedia;
use App\Models\ProgressPhoto;
use App\Models\PushSubscription;
use App\Models\User;
use App\Push\Vapid;
use Illuminate\Filesystem\Filesystem;
use Tests\Support\MediaFixtures;

beforeEach(function () {
    $this->dir = sys_get_temp_dir().'/fitpal-import-media-'.bin2hex(random_bytes(4));
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.admin_uids' => [], 'fitpal.data_dir' => $this->dir,
        'fitpal.vapid.public' => '', 'fitpal.vapid.private' => '']);
    Vapid::forget();
    mkdir($this->dir.'/media/ex', 0777, true);
    mkdir($this->dir.'/media/photo/mem0000000000000', 0777, true);
    $this->demo = MediaFixtures::mkfix('isom', 'avc1', 'node demo');
    file_put_contents($this->dir.'/media/ex/0025-a1b2c3d4e5f60718.mp4', $this->demo);
    file_put_contents($this->dir.'/media/photo/mem0000000000000/abcdefghijklmnopqrstuv.jpg', MediaFixtures::jpeg('front', 2000));
    file_put_contents($this->dir.'/vapid.json', json_encode(['publicKey' => 'nodePublicKey', 'privateKey' => 'nodePrivateKey']));
    $this->db = [
        'users' => [
            ['id' => 'adm0000000000000', 'name' => 'Owner', 'admin' => true, 'created' => '2026-01-01T00:00:00.000Z'],
            ['id' => 'cch0000000000000', 'name' => 'Coach', 'coach' => true, 'created' => '2026-01-02T00:00:00.000Z'],
            ['id' => 'mem0000000000000', 'name' => 'Member', 'coachId' => 'cch0000000000000', 'created' => '2026-01-03T00:00:00.000Z'],
            ['id' => 'oth0000000000000', 'name' => 'Other', 'created' => '2026-01-04T00:00:00.000Z'],
        ],
        'creds' => [],
        'subs' => [
            ['userId' => 'mem0000000000000', 'endpoint' => 'https://push.example.com/m1', 'keys' => ['p256dh' => 'BKey', 'auth' => 'auth1'], 'created' => '2026-04-01T00:00:00.000Z'],
            ['userId' => 'ghost00000000000', 'endpoint' => 'https://push.example.com/g', 'keys' => ['p256dh' => 'k', 'auth' => 'a'], 'created' => 'x'],
            ['userId' => 'oth0000000000000', 'endpoint' => 'https://push.example.com/m1', 'keys' => ['p256dh' => 'k', 'auth' => 'a'], 'created' => 'x'],
            ['userId' => 'oth0000000000000', 'endpoint' => 'https://push.example.com/o', 'keys' => ['p256dh' => 'k']],
        ],
        'media' => [
            ['id' => 'nodeMedia0000001', 'exId' => '0025', 'coachId' => 'cch0000000000000', 'file' => '0025-a1b2c3d4e5f60718.mp4', 'label' => 'Front', 'bytes' => strlen($this->demo), 'mime' => 'video/mp4', 'status' => 'ready', 'created' => '2026-04-02T00:00:00.000Z'],
            ['id' => 'nodeMedia0000002', 'exId' => '0026', 'coachId' => 'cch0000000000000', 'file' => '0026-gone.mov', 'label' => '', 'bytes' => 10, 'mime' => 'video/quicktime', 'status' => 'raw', 'created' => '2026-04-03T00:00:00.000Z'],
            ['id' => 'nodeMedia0000003', 'exId' => '0027', 'coachId' => 'cch0000000000000', 'file' => '../../etc/passwd', 'label' => '', 'bytes' => 10, 'mime' => 'video/mp4', 'status' => 'ready', 'created' => 'x'],
        ],
    ];
    file_put_contents($this->dir.'/db.json', json_encode($this->db, JSON_UNESCAPED_SLASHES));
    file_put_contents($this->dir.'/media-mem0000000000000.json', json_encode(['photos' => [
        ['id' => 'nodePhoto0000001', 'd' => '2026-04-05', 'pose' => 'front', 'file' => 'abcdefghijklmnopqrstuv.jpg', 'bytes' => 2000, 'mime' => 'image/jpeg', 'created' => '2026-04-05T10:00:00.000Z'],
        ['id' => 'nodePhoto0000002', 'd' => '2026-04-05', 'pose' => 'front', 'file' => 'other.jpg', 'bytes' => 1, 'mime' => 'image/jpeg', 'created' => 'x'],
        ['id' => 'nodePhoto0000003', 'd' => '2026-02-30', 'pose' => 'side', 'file' => 'x.jpg', 'bytes' => 1, 'mime' => 'image/jpeg', 'created' => 'x'],
    ]]));
});

afterEach(function () {
    Vapid::forget();
    (new Filesystem)->deleteDirectory($this->dir);
});

it('imports subscriptions, demos and photos as Node kept them, and verifies them through the routes', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify' => true])->assertSuccessful()
        ->expectsOutputToContain('push 1 · demos 2 · photos 1')
        ->expectsOutputToContain('skipped subscription 1 (its account does not exist)')
        ->expectsOutputToContain('skipped subscription 2 (a second row for the same endpoint)')
        ->expectsOutputToContain('skipped subscription 3 (no usable endpoint or keys)')
        ->expectsOutputToContain('skipped media nodeMedia0000003 (not a file name the server would open)')
        ->expectsOutputToContain('0026-gone.mov is not in media/ex; the row is kept')
        ->expectsOutputToContain('photo nodePhoto0000002 (a second photo for 2026-04-05 front)')
        ->expectsOutputToContain('photo nodePhoto0000003 (not a date and a pose)')
        ->expectsOutputToContain('and so do the demos, photos and push');

    expect(PushSubscription::query()->sole()->only(['user_id', 'endpoint', 'p256dh', 'auth']))->toBe(['user_id' => 'mem0000000000000', 'endpoint' => 'https://push.example.com/m1', 'p256dh' => 'BKey', 'auth' => 'auth1'])
        ->and(ExerciseMedia::acrossCoaches()->find('nodeMedia0000001')->toNode())->toBe($this->db['media'][0]) // across coaches: the test reads every row
        ->and(ProgressPhoto::query()->sole()->only(['id', 'user_id', 'd', 'pose', 'file']))->toBe(['id' => 'nodePhoto0000001', 'user_id' => 'mem0000000000000', 'd' => '2026-04-05', 'pose' => 'front', 'file' => 'abcdefghijklmnopqrstuv.jpg']);
    // The bytes Node wrote, served by Laravel from where Node wrote them.
    expect($this->getJson('/api/media/ex?id=nodeMedia0000001', bearer(User::find('mem0000000000000')))->streamedContent())->toBe($this->demo);
});

it('mirrors the files on a rerun, and leaves a client whose sidecar cannot be read alone', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    $this->db['subs'] = [];
    $this->db['media'] = [$this->db['media'][0]];
    file_put_contents($this->dir.'/db.json', json_encode($this->db, JSON_UNESCAPED_SLASHES));
    file_put_contents($this->dir.'/media-mem0000000000000.json', '{"photos": [');   // torn
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()
        ->expectsOutputToContain('removed 2 subscription/demo/photo row(s)')
        ->expectsOutputToContain('media-mem0000000000000.json (cannot be read; these photos are left as they were)');
    expect(PushSubscription::query()->count())->toBe(0)
        ->and(ExerciseMedia::acrossCoaches()->pluck('id')->all())->toBe(['nodeMedia0000001']) // across coaches: the test reads every row
        ->and(ProgressPhoto::query()->count())->toBe(1);
});

it('reports a VAPID pair that is not the one Node signed with, and never writes one', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()
        ->doesntExpectOutputToContain('VAPID');
    config(['fitpal.vapid.public' => 'envPublic', 'fitpal.vapid.private' => 'envPrivate']);
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()
        ->expectsOutputToContain('VAPID_PUBLIC_KEY is not the pair in vapid.json');
    config(['fitpal.vapid.public' => '', 'fitpal.vapid.private' => '', 'fitpal.data_dir' => $this->dir.'/elsewhere']);
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful()
        ->expectsOutputToContain('DATA_DIR/vapid.json is not the pair in');
    expect(json_decode(file_get_contents($this->dir.'/vapid.json'), true)['publicKey'])->toBe('nodePublicKey')
        ->and(is_file($this->dir.'/elsewhere/vapid.json'))->toBeFalse();
});

it('fails verify when a demo row is not what the files say', function () {
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir])->assertSuccessful();
    ExerciseMedia::acrossCoaches()->whereKey('nodeMedia0000001')->update(['label' => 'Changed']); // across coaches: the test edits a row
    $this->artisan('fitpal:import-legacy', ['dataDir' => $this->dir, '--verify-only' => true])->assertFailed()
        ->expectsOutputToContain('GET /api/media/exercises differs from the files');
});
