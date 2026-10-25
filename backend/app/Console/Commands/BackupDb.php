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
        // Fixed-width time, then a two-digit counter, then the label: names sort in the order the
        // dumps were taken (prune relies on it), and a re-run never writes over an earlier dump.
        // The counter continues past the highest already there, never into a gap prune left.
        $stamp = $dir.DIRECTORY_SEPARATOR.'db-'.now()->format('Ymd-His-u');
        $n = 1;
        foreach (glob($stamp.'-*.sql.gz') ?: [] as $taken) {
            $n = max($n, (int) substr($taken, strlen($stamp) + 1, 2) + 1);
        }
        $file = sprintf('%s-%02d%s.sql.gz', $stamp, $n, $label !== '' ? "-$label" : '');

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
        // utf8mb4 named: an older client's default is the 3-byte utf8, which turns every emoji in a
        // name or a note into '?' in the dump.
        $args = [$tool, '--single-transaction', '--no-tablespaces', '--routines', '--default-character-set=utf8mb4',
            '-h', (string) ($c['host'] ?? '127.0.0.1'), '-P', (string) ($c['port'] ?? 3306),
            '-u', (string) ($c['username'] ?? ''), (string) ($c['database'] ?? '')];
        $result = Process::env(['MYSQL_PWD' => (string) ($c['password'] ?? '')])->timeout(600)->run($args);
        if (! $result->successful()) {
            return $this->refuse('the dump failed: '.trim($result->errorOutput()));
        }

        // Held in memory either way (the process buffers its output); this app's database is small.
        return $this->write($file, $result->output());
    }

    private function copySqlite(array $c, string $file): bool
    {
        $db = (string) ($c['database'] ?? '');
        if ($db === '' || $db === ':memory:' || ! is_file($db)) {
            return $this->refuse("the SQLite database ($db) is not a file");
        }
        $tmp = $file.'.sqlite';
        try {
            // VACUUM INTO: a consistent copy, whatever is being written meanwhile.
            $pdo = new \PDO('sqlite:'.$db, options: [\PDO::ATTR_ERRMODE => \PDO::ERRMODE_EXCEPTION]);
            $pdo->exec('VACUUM INTO '.$pdo->quote($tmp));
            $copy = @file_get_contents($tmp);

            return $copy === false ? $this->refuse("cannot read the copy ($tmp)") : $this->write($file, $copy);
        } catch (\PDOException $e) {
            return $this->refuse('the copy failed: '.$e->getMessage());
        } finally {
            @unlink($tmp);
        }
    }

    /** Gzipped, and all of it: a short write (a full disk) is a failed dump, not a smaller one. */
    private function write(string $file, string $data): bool
    {
        $gz = gzencode($data, 6);
        if ($gz === false || @file_put_contents($file, $gz) !== strlen($gz)) {
            return $this->refuse("cannot write $file (is the disk full?)");
        }

        return true;
    }

    private function prune(string $dir, int $keep): void
    {
        $dumps = glob($dir.DIRECTORY_SEPARATOR.'db-*.sql.gz') ?: [];
        rsort($dumps);   // fixed-width time and counter first in the name: newest first
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
