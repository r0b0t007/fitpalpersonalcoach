<?php

// fitpal:backup-db, the dump deploy-backend.yml takes before it changes anything (CHW-298): of
// the connection Laravel resolved, whatever it is called; the password never on a command line;
// a re-run never over an earlier dump; only the newest few kept. Also the nightly dump the
// schedule takes into its own folder (CHW-306).

use App\Console\Commands\BackupDb;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;

function clearDumps(): void
{
    foreach (['', '/nightly'] as $sub) {
        array_map('unlink', glob(storage_path('backups').$sub.'/db-*') ?: []);
    }
}

beforeEach(fn () => clearDumps());
afterEach(fn () => clearDumps());

function dumps(): array
{
    $files = glob(storage_path('backups').'/db-*.sql.gz') ?: [];
    sort($files);

    return $files;
}

function liveDb(string $driver = 'mariadb', string $password = 'p'): void
{
    config(['database.connections.live' => ['driver' => $driver, 'host' => '127.0.0.1', 'port' => '3306',
        'database' => 'pawputif_app', 'username' => 'pawputif_user', 'password' => $password]]);
}

it('dumps a MySQL or MariaDB connection with the password in the environment, not the command line', function (string $driver) {
    liveDb($driver, 's3cret "quoted" #pw');
    Process::fake(['*dump*' => Process::result('-- the dump'), '*' => Process::result('')]);

    $this->artisan('fitpal:backup-db', ['--connection' => 'live', '--label' => 'abc123'])
        ->assertSuccessful()->expectsOutputToContain('database dumped to');

    Process::assertRan(function (PendingProcess $p) {
        $cmd = implode(' ', (array) $p->command);

        return str_contains($cmd, 'dump') && str_contains($cmd, '--single-transaction') && str_contains($cmd, '--default-character-set=utf8mb4') && str_contains($cmd, 'pawputif_app')
            && ! str_contains($cmd, 's3cret') && ($p->environment['MYSQL_PWD'] ?? null) === 's3cret "quoted" #pw';
    });
    expect(dumps())->toHaveCount(1)
        ->and(basename(dumps()[0]))->toMatch('/^db-\d{8}-\d{6}-\d{6}-01-abc123\.sql\.gz$/')
        ->and(gzdecode(file_get_contents(dumps()[0])))->toStartWith('-- the dump');
})->with(['mysql', 'mariadb']);

it('fails, and leaves no file, when the dump fails', function () {
    liveDb();
    Process::fake(['*dump*' => Process::result('', 'Access denied', 2), '*' => Process::result('')]);
    $this->artisan('fitpal:backup-db', ['--connection' => 'live'])->assertFailed()->expectsOutputToContain('Access denied');
    expect(dumps())->toBe([]);
});

it('copies a SQLite file, consistently', function () {
    $db = sys_get_temp_dir().'/fitpal-backup-'.bin2hex(random_bytes(4)).'.sqlite';
    (new PDO('sqlite:'.$db))->exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('kept')");
    config(['database.connections.file' => ['driver' => 'sqlite', 'database' => $db]]);

    $this->artisan('fitpal:backup-db', ['--connection' => 'file'])->assertSuccessful();
    $copy = $db.'.restored';
    file_put_contents($copy, gzdecode(file_get_contents(dumps()[0])));
    expect((new PDO('sqlite:'.$copy))->query('SELECT v FROM t')->fetchColumn())->toBe('kept');
    @unlink($db);
    @unlink($copy);
});

it('refuses what it cannot dump rather than skipping it', function () {
    config(['database.connections.mem' => ['driver' => 'sqlite', 'database' => ':memory:'], 'database.connections.pg' => ['driver' => 'pgsql']]);
    $this->artisan('fitpal:backup-db', ['--connection' => 'mem'])->assertFailed()->expectsOutputToContain('is not a file');
    $this->artisan('fitpal:backup-db', ['--connection' => 'pg'])->assertFailed()->expectsOutputToContain("no backup for the 'pgsql' driver");
    expect(dumps())->toBe([]);
});

it('never writes over an earlier dump, and keeps only the newest', function () {
    liveDb();
    Process::fake(['*dump*' => Process::result('-- dump'), '*' => Process::result('')]);
    $this->freezeTime();
    foreach (range(1, 4) as $i) {
        $this->artisan('fitpal:backup-db', ['--connection' => 'live', '--label' => 'same', '--keep' => 3])->assertSuccessful();
    }
    // Four runs in one instant: four names, and the three kept are the three NEWEST.
    expect(array_map(fn ($f) => preg_replace('/^db-[\d-]{22}-(\d\d)-same\.sql\.gz$/', '$1', basename($f)), dumps()))
        ->toBe(['02', '03', '04']);

    // With --keep=1, the dump just written is the one kept.
    $this->artisan('fitpal:backup-db', ['--connection' => 'live', '--label' => 'same', '--keep' => 1])
        ->assertSuccessful();
    expect(dumps())->toHaveCount(1)->and(dumps()[0])->toEndWith('-05-same.sql.gz');
});

it('takes a refused or failed SQLite copy as a failed dump', function () {
    $db = sys_get_temp_dir().'/fitpal-backup-'.bin2hex(random_bytes(4)).'.sqlite';
    file_put_contents($db, 'not a database at all');
    config(['database.connections.broken' => ['driver' => 'sqlite', 'database' => $db]]);
    $this->artisan('fitpal:backup-db', ['--connection' => 'broken'])->assertFailed()->expectsOutputToContain('the copy failed');
    expect(dumps())->toBe([])
        ->and(glob(storage_path('backups').'/*.sqlite') ?: [])->toBe([]);   // no temp copy left behind
    @unlink($db);
});

it('dumps --into a folder of its own, and keeps and prunes there alone', function () {
    liveDb();
    Process::fake(['*dump*' => Process::result('-- dump'), '*' => Process::result('')]);
    $this->artisan('fitpal:backup-db', ['--connection' => 'live', '--label' => 'deploy', '--keep' => 2])->assertSuccessful();
    foreach (range(1, 3) as $i) {
        $this->artisan('fitpal:backup-db', ['--connection' => 'live', '--into' => 'nightly', '--keep' => 2])->assertSuccessful();
    }
    // The deploy's dump is untouched by three nightly ones, and the nightly folder holds its two newest.
    expect(dumps())->toHaveCount(1)->and(dumps()[0])->toEndWith('-deploy.sql.gz')
        ->and(glob(storage_path('backups').'/nightly/db-*.sql.gz') ?: [])->toHaveCount(2);

    // And the other way: a deploy's dump with --keep=1 prunes its own folder, not the nightly one.
    $this->artisan('fitpal:backup-db', ['--connection' => 'live', '--label' => 'next', '--keep' => 1])->assertSuccessful();
    expect(dumps())->toHaveCount(1)->and(dumps()[0])->toEndWith('-next.sql.gz')
        ->and(glob(storage_path('backups').'/nightly/db-*.sql.gz') ?: [])->toHaveCount(2);
});

it('refuses an --into that is not one plain folder name', function (string $into) {
    liveDb();
    Process::fake();
    $this->artisan('fitpal:backup-db', ['--connection' => 'live', '--into' => $into])
        ->assertFailed()->expectsOutputToContain('--into takes one folder name');
    Process::assertNothingRan();
})->with(['../escape', 'a/b', '.', 'night ly']);

it('is scheduled nightly into its own folder, in the background', function () {
    $nightly = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'fitpal:backup-db'));
    expect($nightly)->not->toBeNull()
        ->and((string) $nightly->command)->toContain('--into=nightly')->toContain('--keep=14')->toContain(' -v')
        ->and($nightly->expression)->toBe('0 3 * * *')
        ->and($nightly->runInBackground)->toBeTrue()
        ->and($nightly->withoutOverlapping)->toBeTrue()
        ->and($nightly->output)->toBe(storage_path('logs/backup.log'))
        ->and($nightly->shouldAppendOutput)->toBeTrue();
});

it('deletes a dump taken before a deploy once it is 90 days old, and leaves the nightly ones to their rotation', function () {
    @mkdir(storage_path('backups/nightly'), 0775, true);
    $old = storage_path('backups/db-20260101-000000-a.sql.gz');
    $fresh = storage_path('backups/db-20261101-000000-b.sql.gz');
    $nightly = storage_path('backups/nightly/db-20260101-000000-n.sql.gz');
    foreach ([$old, $fresh, $nightly] as $f) {
        file_put_contents($f, 'x');
    }
    touch($old, time() - (BackupDb::DEPLOY_DUMP_DAYS + 1) * 86400);
    touch($nightly, time() - 200 * 86400);   // the nightly folder keeps its own count (--keep=14)
    $this->artisan('fitpal:prune')->assertSuccessful();
    expect(file_exists($old))->toBeFalse()->and(file_exists($fresh))->toBeTrue()->and(file_exists($nightly))->toBeTrue();
});
