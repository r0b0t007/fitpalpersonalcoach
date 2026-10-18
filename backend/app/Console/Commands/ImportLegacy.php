<?php

namespace App\Console\Commands;

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
 * R0 scope: accounts, passkeys and training state. Invites, assignments, programs, photos, media
 * rows, push subscriptions and the audit log follow in R1–R3 as their tables land.
 */
final class ImportLegacy extends Command
{
    protected $signature = 'fitpal:import-legacy {dataDir : The Node API DATA_DIR (holds db.json and state-*.json)}';

    protected $description = 'Import users, passkeys and training state from a Node API data directory';

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
        $audit = 0;
        $auditFile = $dir.DIRECTORY_SEPARATOR.'audit.log';
        if (is_file($auditFile)) {
            $batch = [];
            foreach (new SplFileObject($auditFile) as $line) {
                $r = json_decode(trim((string) $line), true);
                if (! is_array($r) || empty($r['id']) || empty($r['ev']) || ! is_numeric($r['id'])) {
                    continue;
                }
                $batch[] = [
                    'id' => (int) $r['id'], 'ts' => (int) ($r['ts'] ?? 0), 'ev' => mb_substr((string) $r['ev'], 0, 64),
                    'ok' => ($r['ok'] ?? true) !== false,
                    'uid' => isset($r['uid']) ? mb_substr((string) $r['uid'], 0, 16) : null,
                    'name' => isset($r['name']) ? mb_substr((string) $r['name'], 0, 40) : null,
                    'tgt' => isset($r['tgt']) ? mb_substr((string) $r['tgt'], 0, 16) : null,
                    'tname' => isset($r['tname']) ? mb_substr((string) $r['tname'], 0, 40) : null,
                    'msg' => isset($r['msg']) ? mb_substr((string) $r['msg'], 0, 120) : null,
                    'ip' => isset($r['ip']) ? mb_substr((string) $r['ip'], 0, 45) : null,
                ];
                if (count($batch) === 500) {
                    $audit += self::upsertAudit($batch);
                    $batch = [];
                }
            }
            $audit += self::upsertAudit($batch);
        }

        $this->info("users $users · passkeys $creds · states $states · audit $audit");
        foreach ($skipped as $s) {
            $this->warn("skipped $s");
        }

        return self::SUCCESS;
    }

    /** Upsert by id, so a second import of the same log adds nothing. */
    private static function upsertAudit(array $rows): int
    {
        if ($rows === []) {
            return 0;
        }
        DB::table('audit_events')->upsert($rows, ['id'], ['ts', 'ev', 'ok', 'uid', 'name', 'tgt', 'tname', 'msg', 'ip']);

        return count($rows);
    }
}
