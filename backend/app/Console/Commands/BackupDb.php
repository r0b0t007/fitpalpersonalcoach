<?php

namespace App\Console\Commands;

use App\Backup\Age;
use App\Backup\Offsite;
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
 *
 * `--into` puts the dump in a subdirectory of storage/backups and counts `--keep` there alone. The
 * nightly schedule (routes/console.php) uses it so that its dumps never push out a deploy's, and
 * never become "the newest db-*.sql.gz" that the undo for a bad deploy restores.
 *
 * `--offsite` (the nightly one, CHW-361) encrypts the dump to the owner's age key before it is
 * written (`db-….sql.gz.age`; the server cannot read it back) and puts a copy in the R2 bucket
 * (App\Backup\Offsite), under `<into>/` there. Encrypted whenever the key is usable, whatever
 * state the R2 settings are in: a wrong endpoint or a blanked secret costs the copy, never the
 * encryption. Without a usable key it still writes the dump as it always did, readable, and fails:
 * a night without a dump would be worse than a night without a copy. A failed upload also fails,
 * and keeps the encrypted dump on the server. (SQLite's VACUUM INTO copy is readable on disk for
 * the moment it takes to gzip and encrypt it, as the live database file beside it always is.)
 */
final class BackupDb extends Command
{
    protected $signature = 'fitpal:backup-db
        {--connection= : The connection to dump (default: database.default)}
        {--label= : Added to the file name, e.g. the commit being deployed}
        {--keep=5 : How many dumps to keep in storage/backups (or in the --into subdirectory)}
        {--into= : A subdirectory of storage/backups to dump into, e.g. nightly}
        {--offsite : Encrypt the dump to BACKUP_AGE_RECIPIENT and copy it to the R2 bucket}';

    protected $description = 'Dump the database to storage/backups (before a deploy, and nightly into storage/backups/nightly)';

    public function handle(): int
    {
        $name = (string) ($this->option('connection') ?: config('database.default'));
        $c = (array) config("database.connections.$name");
        $label = preg_replace('/[^A-Za-z0-9._-]/', '', (string) $this->option('label'));
        $into = (string) $this->option('into');
        if ($into !== '' && ! preg_match('/^[A-Za-z0-9_-]+$/', $into)) {
            $this->error("--into takes one folder name (letters, digits, - and _), not '$into'");

            return self::FAILURE;
        }
        $dir = storage_path('backups'.($into !== '' ? DIRECTORY_SEPARATOR.$into : ''));
        @mkdir($dir, 0700, true);
        // Fixed-width time, then a two-digit counter, then the label: names sort in the order the
        // dumps were taken (prune relies on it), and a re-run never writes over an earlier dump.
        // The counter continues past the highest already there, never into a gap prune left.
        $stamp = $dir.DIRECTORY_SEPARATOR.'db-'.now()->format('Ymd-His-u');
        $n = 1;
        foreach (glob($stamp.'-*.sql.gz*') ?: [] as $taken) {
            $n = max($n, (int) substr($taken, strlen($stamp) + 1, 2) + 1);
        }
        $file = sprintf('%s-%02d%s.sql.gz', $stamp, $n, $label !== '' ? "-$label" : '');
        $offsite = (bool) $this->option('offsite');
        $unready = $offsite ? Offsite::problems() : [];
        $this->recipient = $offsite && Offsite::recipientUsable() ? (string) config('fitpal.backup.recipient') : null;
        if ($this->recipient !== null) {
            $file .= '.age';
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
        $this->info('database dumped to '.$file.($this->recipient !== null ? ', encrypted' : ''));
        if ($unready !== []) {
            $this->error('not copied off the server'.($this->recipient === null ? ', and not encrypted' : '').': '.implode(' ', $unready));

            return self::FAILURE;
        }
        if ($offsite) {
            $key = ($into !== '' ? $into : 'deploy').'/'.basename($file);
            if (($why = Offsite::put($key, (string) $this->written)) !== null) {
                $this->error("not copied off the server ($why); the encrypted dump stays in $dir");

                return self::FAILURE;
            }
            $this->info("copied to R2: $key");
        }

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

    /** The age recipient the dump is encrypted to, when --offsite has a usable key; null writes it readable. */
    private ?string $recipient = null;

    /** The bytes write() put on disk, so the upload sends them without reading the file back. */
    private ?string $written = null;

    /**
     * Gzipped (and encrypted, with a recipient), and all of it: a short write (a full disk) is a
     * failed dump, not a smaller one.
     */
    private function write(string $file, string $data): bool
    {
        $gz = gzencode($data, 6);
        if ($gz !== false && $this->recipient !== null) {
            try {
                $gz = Age::encrypt($gz, $this->recipient);
            } catch (\Throwable $e) {
                return $this->refuse('cannot encrypt the dump: '.$e->getMessage());
            }
        }
        if ($gz === false || @file_put_contents($file, $gz) !== strlen($gz)) {
            return $this->refuse("cannot write $file (is the disk full?)");
        }
        $this->written = $gz;

        return true;
    }

    /**
     * The coach terms (CHW-357) promise that a copy taken before a deploy lasts 90 days at most:
     * with rare deploys, the newest five could otherwise hold deleted clients for months. Hourly,
     * from fitpal:prune. Only the deploy's own dumps; the nightly folder rotates by its --keep.
     */
    public const DEPLOY_DUMP_DAYS = 90;

    public static function pruneOld(int $nowSec): int
    {
        $removed = 0;
        foreach (self::dumpsIn(storage_path('backups')) as $dump) {
            if (filemtime($dump) < $nowSec - self::DEPLOY_DUMP_DAYS * 86400 && @unlink($dump)) {
                $removed++;
            }
        }

        return $removed;
    }

    private function prune(string $dir, int $keep): void
    {
        $dumps = self::dumpsIn($dir);
        rsort($dumps);   // fixed-width time and counter first in the name: newest first
        foreach (array_slice($dumps, $keep) as $old) {
            @unlink($old);
        }
    }

    /**
     * The dumps in a folder, readable (.sql.gz) and encrypted (.sql.gz.age) together — the night
     * --offsite was first set up has both — and nothing else: not a SQLite copy still being taken.
     *
     * @return list<string>
     */
    private static function dumpsIn(string $dir): array
    {
        return array_values(array_filter(glob($dir.DIRECTORY_SEPARATOR.'db-*') ?: [], fn ($f) => (bool) preg_match('/\.sql\.gz(\.age)?$/', $f)));
    }

    private function refuse(string $why): bool
    {
        $this->error($why);

        return false;
    }
}
