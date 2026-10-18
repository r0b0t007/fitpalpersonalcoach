<?php

namespace App\Console\Commands;

use App\Audit\Audit;
use App\Models\User;
use App\Models\UserState;
use App\WebAuthn\LegacyCredential;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Laragear\WebAuthn\Models\WebAuthnCredential;
use SplFileObject;
use Throwable;

/**
 * Brings a Node API data directory into the database. Idempotent: rows are upserted by id, so it
 * can be run against a copy today and against the live directory at cutover.
 *
 * Imports today: accounts, passkeys, training state, and the audit log (audit.log, into a table
 * that holds nothing else — see below). Invites, assignments, programs, photos, media rows and push
 * subscriptions follow in R2–R3 as their tables land.
 */
final class ImportLegacy extends Command
{
    protected $signature = 'fitpal:import-legacy {dataDir : The Node API DATA_DIR (holds db.json and state-*.json)}';

    protected $description = 'Import users, passkeys, training state and the audit log from a Node API data directory';

    public function handle(): int
    {
        $dir = rtrim($this->argument('dataDir'), '/\\');
        $dbFile = $dir.DIRECTORY_SEPARATOR.'db.json';
        if (! is_file($dbFile)) {
            $this->error("no db.json in $dir");

            return self::FAILURE;
        }
        $db = json_decode((string) file_get_contents($dbFile), true);
        if (! is_array($db)) {
            $this->error('db.json is not valid JSON');

            return self::FAILURE;
        }

        $users = 0;
        foreach ($db['users'] ?? [] as $u) {
            if (empty($u['id']) || ! is_string($u['id'])) {
                continue;
            }
            $user = User::query()->firstOrNew(['id' => $u['id']]);
            $user->fill([
                'name' => mb_substr((string) ($u['name'] ?? ''), 0, 40),
                'admin' => ! empty($u['admin']),
                'coach' => ! empty($u['coach']),
                'coach_id' => $u['coachId'] ?? null,
                'disabled' => ! empty($u['disabled']),
                'sv' => (int) ($u['sv'] ?? 0),
                'invited_by' => $u['invitedBy'] ?? null,
                'last_reminder' => $u['lastReminder'] ?? null,
                'last_checkin_reminder' => $u['lastCheckinReminder'] ?? null,
            ]);
            // The Node API wrote `created` as null for its oldest accounts. Those get the date of
            // the FIRST import and keep it: a rerun must not move anyone's creation date.
            if (! empty($u['created'])) {
                $user->created_at = $u['created'];
            } elseif (! $user->exists) {
                $user->created_at = now();
            }
            $user->save();
            $users++;
        }

        $creds = 0;
        $skipped = [];
        foreach ($db['creds'] ?? [] as $c) {
            $user = isset($c['userId']) ? User::query()->find($c['userId']) : null;
            if ($user === null || empty($c['id']) || empty($c['publicKey'])) {
                $skipped[] = $c['id'] ?? '?';

                continue;
            }
            try {
                if ($existing = WebAuthnCredential::query()->find($c['id'])) {
                    $existing->counter = (int) ($c['counter'] ?? 0);
                    $existing->save();
                } else {
                    LegacyCredential::import($user, $c);
                }
                $creds++;
            } catch (Throwable $e) {
                $skipped[] = $c['id'].' ('.$e->getMessage().')';
            }
        }

        $states = 0;
        foreach (glob($dir.DIRECTORY_SEPARATOR.'state-*.json') ?: [] as $file) {
            $uid = substr(basename($file, '.json'), 6);
            if (! User::query()->whereKey($uid)->exists()) {
                continue;
            }
            $raw = (string) file_get_contents($file);
            $decoded = json_decode($raw);
            if (! is_object($decoded) && ! is_array($decoded)) {
                $skipped[] = basename($file).' (not JSON)';

                continue;
            }
            $ts = is_object($decoded) && isset($decoded->_ts) && is_numeric($decoded->_ts) ? (int) $decoded->_ts : null;
            UserState::query()->updateOrCreate(['user_id' => $uid], ['state' => $raw, 'ts' => $ts]);
            $states++;
        }

        // The audit log: JSONL, one event per line, ids and timestamps kept so the owner's history
        // reads on across the cutover (and the id sequence carries on above the last one). A torn
        // last line is skipped, as the Node reader did.
        //
        // Ids are one sequence: Laravel hands them out too, and retention and paging read id order
        // as time order. So an existing row is never overwritten, and the import refuses a table
        // that holds events this log contradicts. What the table may hold besides this log: rows
        // BELOW the log's first id — an earlier import of the same instance whose oldest lines Node
        // has since compacted or cleared away (Node never reuses an id, so they cannot clash). What
        // it may not: a row inside or above the log's range that the log does not have, or has
        // differently — those were written by something else, e.g. a Laravel that already ran.
        $audit = 0;
        $auditFile = $dir.DIRECTORY_SEPARATOR.'audit.log';
        if (is_file($auditFile)) {
            $rows = [];
            foreach (new SplFileObject($auditFile) as $line) {
                $r = json_decode(trim((string) $line), true);
                if (is_array($r) && is_numeric($r['id'] ?? null) && (int) $r['id'] > 0 && ! empty($r['ev'])) {
                    $rows[(int) $r['id']] = Audit::row($r);
                }
            }
            if ($rows !== []) {
                $conflict = self::auditConflicts($rows);
                if ($conflict !== null) {
                    $skipped[] = "audit.log ($conflict; import it into a fresh database)";
                } else {
                    foreach (array_chunk(array_values($rows), 500) as $chunk) {
                        $audit += DB::table('audit_events')->insertOrIgnore($chunk);
                    }
                    self::advanceAuditSequence();
                }
            }
        }

        $this->info("users $users · passkeys $creds · states $states · audit $audit");
        foreach ($skipped as $s) {
            $this->warn("skipped $s");
        }

        return self::SUCCESS;
    }

    /**
     * Why the table cannot take this log, or null when it can. Asked of the database in chunks,
     * never by loading the table: rows above the log, rows inside its id range that it does not
     * contain, and rows it does contain but with another time or event.
     *
     * @param  array<int, array>  $rows  the log, keyed by id
     */
    private static function auditConflicts(array $rows): ?string
    {
        $min = min(array_keys($rows));
        $max = max(array_keys($rows));
        $above = DB::table('audit_events')->where('id', '>', $max)->count();
        if ($above > 0) {
            return "$above event(s) newer than the log's last id $max are not from it";
        }
        $present = 0;
        $differ = 0;
        foreach (array_chunk(array_keys($rows), 500) as $ids) {
            foreach (DB::table('audit_events')->whereIn('id', $ids)->get(['id', 'ts', 'ev']) as $e) {
                $present++;
                if ((int) $e->ts !== $rows[$e->id]['ts'] || $e->ev !== $rows[$e->id]['ev']) {
                    $differ++;
                }
            }
        }
        if ($differ > 0) {
            return "$differ event(s) share an id with the log but not its content";
        }
        $inRange = DB::table('audit_events')->whereBetween('id', [$min, $max])->count();
        if ($inRange !== $present) {
            return ($inRange - $present)." event(s) inside the log's id range are not in it";
        }

        return null;
    }

    /**
     * PostgreSQL does not move a sequence past ids inserted explicitly, so the next live event
     * would collide with an imported one (and record() would swallow the error). MariaDB, MySQL and
     * SQLite advance on their own.
     */
    private static function advanceAuditSequence(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("SELECT setval(pg_get_serial_sequence('audit_events', 'id'), (SELECT COALESCE(MAX(id), 1) FROM audit_events))");
        }
    }
}
