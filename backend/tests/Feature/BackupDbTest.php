<?php

// fitpal:backup-db, the dump deploy-backend.yml takes before it changes anything (CHW-298): of
// the connection Laravel resolved, whatever it is called; the password never on a command line;
// a re-run never over an earlier dump; only the newest few kept.

use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Process;

beforeEach(function () {
    array_map('unlink', glob(storage_path('backups').'/db-*') ?: []);
});

afterEach(function () {
    array_map('unlink', glob(storage_path('backups').'/db-*') ?: []);
});

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

        return str_contains($cmd, 'dump') && str_contains($cmd, '--single-transaction') && str_contains($cmd, 'pawputif_app')
            && ! str_contains($cmd, 's3cret') && ($p->environment['MYSQL_PWD'] ?? null) === 's3cret "quoted" #pw';
    });
    expect(dumps())->toHaveCount(1)
        ->and(basename(dumps()[0]))->toMatch('/^db-\d{8}-\d{6}-abc123\.sql\.gz$/')
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
    expect(dumps())->toHaveCount(3);   // four runs in one second: four names, the oldest pruned
});
