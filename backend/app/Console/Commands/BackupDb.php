<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Process;

/**
 * A gzipped dump of the database the app is configured for, before a deploy changes code or schema
 * (deploy-backend.yml). Reads the connection Laravel itself resolved — never a second reading of
 * .env, which would disagree with dotenv on quotes, escapes and interpolation — so the dump is of
 * the database the app writes to, whatever the connection is called.
 *
 * MySQL and MariaDB go through mariadb-dump (mysqldump where it is not installed), the password in
 * the environment, never on the command line; a SQLite file is copied through VACUUM INTO, which
 * gives a consistent copy while the app runs. Files are named by time, then label, so a re-run
 * never replaces an earlier dump, and only the newest `--keep` stay.
 */
final class BackupDb extends Command
{
    protected $signature = 'fitpal:backup-db
        {--connection= : The connection to dump (default: database.default)}
        {--label= : Added to the file name, e.g. the commit being deployed}
        {--keep=5 : How many dumps to keep in storage/backups}';

    protected $description = 'Dump the database to storage/backups before a deploy';

    public function handle(): int
    {
        $name = (string) ($this->option('connection') ?: config('database.default'));
        $c = (array) config("database.connections.$name");
        $label = preg_replace('/[^A-Za-z0-9._-]/', '', (string) $this->option('label'));
        $dir = storage_path('backups');
        @mkdir($dir, 0700, true);
        $base = $dir.DIRECTORY_SEPARATOR.'db-'.now()->format('Ymd-His').($label !== '' ? "-$label" : '');
        // Never over an earlier dump, even one from the same second.
        for ($file = "$base.sql.gz", $n = 2; file_exists($file); $n++) {
            $file = "$base-$n.sql.gz";
        }

        $ok = match ($c['driver'] ?? null) {
            'mysql', 'mariadb' => $this->dumpMysql($c, $file),
            'sqlite' => $this->copySqlite($c, $file),
            default => $this->refuse("no backup for the '".($c['driver'] ?? '?')."' driver of connection '$name'"),
        };
        if (! $ok) {
            @unlink($file);

            return self::FAILURE;
        }
        $this->prune($dir, max(1, (int) $this->option('keep')));
        $this->info('database dumped to '.$file);

        return self::SUCCESS;
    }

    private function dumpMysql(array $c, string $file): bool
    {
        $tool = Process::run(['sh', '-c', 'command -v mariadb-dump || command -v mysqldump'])->output();
        $tool = trim(strtok($tool, "\n") ?: '') ?: 'mariadb-dump';
        $args = [$tool, '--single-transaction', '--no-tablespaces', '--routines',
            '-h', (string) ($c['host'] ?? '127.0.0.1'), '-P', (string) ($c['port'] ?? 3306),
            '-u', (string) ($c['username'] ?? ''), (string) ($c['database'] ?? '')];
        $result = Process::env(['MYSQL_PWD' => (string) ($c['password'] ?? '')])->timeout(600)->run($args);
        if (! $result->successful()) {
            return $this->refuse('the dump failed: '.trim($result->errorOutput()));
        }
        // Held in memory either way (the process buffers its output); this app's database is small.
        file_put_contents($file, gzencode($result->output(), 6));

        return true;
    }

    private function copySqlite(array $c, string $file): bool
    {
        $db = (string) ($c['database'] ?? '');
        if ($db === '' || $db === ':memory:' || ! is_file($db)) {
            return $this->refuse("the SQLite database ($db) is not a file");
        }
        $tmp = $file.'.sqlite';
        // VACUUM INTO: a consistent copy, whatever is being written meanwhile.
        $pdo = new \PDO('sqlite:'.$db);
        $pdo->exec('VACUUM INTO '.$pdo->quote($tmp));
        $in = fopen($tmp, 'rb');
        $gz = gzopen($file, 'wb6');
        while (! feof($in)) {
            gzwrite($gz, (string) fread($in, 1 << 20));
        }
        fclose($in);
        gzclose($gz);
        @unlink($tmp);

        return true;
    }

    private function prune(string $dir, int $keep): void
    {
        $dumps = glob($dir.DIRECTORY_SEPARATOR.'db-*.sql.gz') ?: [];
        rsort($dumps);   // the name starts with the time: newest first
        foreach (array_slice($dumps, $keep) as $old) {
            @unlink($old);
        }
    }

    private function refuse(string $why): bool
    {
        $this->error($why);

        return false;
    }
}
