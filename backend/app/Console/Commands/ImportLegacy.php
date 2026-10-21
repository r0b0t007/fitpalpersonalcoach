<?php

namespace App\Console\Commands;

use App\Audit\Audit;
use App\Auth\SessionToken;
use App\Console\LegacyCoaching;
use App\Http\Request;
use App\Models\User;
use App\Models\UserState;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\WebAuthn\LegacyCredential;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Contracts\Http\Kernel as HttpKernel;
use Illuminate\Support\Facades\DB;
use Laragear\WebAuthn\Models\WebAuthnCredential;
use SplFileObject;
use Throwable;

/**
 * Brings a Node API data directory into the database. Idempotent: rows are upserted by id, so it
 * can be run against a copy today and against the live directory at cutover.
 *
 * Imports today: accounts, passkeys, training state, the audit log (audit.log, into a table that
 * holds nothing else — see below), and the coaching data: invites, program libraries and
 * assignments (App\Console\LegacyCoaching, which mirrors the files: rows they no longer hold are
 * removed). Photos, media rows and push subscriptions follow in R3 as their tables land.
 */
final class ImportLegacy extends Command
{
    protected $signature = 'fitpal:import-legacy
        {dataDir : The Node API DATA_DIR (holds db.json and state-*.json)}
        {--verify : After importing, read every account back through the API and compare it with the files}
        {--verify-only : Compare the database with the files without importing (after a cutover, say)}';

    protected $description = 'Import accounts, passkeys, training state, the audit log, invites, programs and assignments from a Node API data directory';

    public function handle(): int
    {
        $dir = rtrim($this->argument('dataDir'), '/\\');
        $dbFile = $dir.DIRECTORY_SEPARATOR.'db.json';
        if (! is_file($dbFile)) {
            $this->error("no db.json in $dir");

            return self::FAILURE;
        }
        // Parsed as Node's JSON.parse parsed it (Input::parse): a lone surrogate or a stray invalid
        // byte does not refuse the whole file. Objects are kept for the coaching data, where a
        // bundle's {} must stay {}; the account code reads its two lists as arrays.
        //
        // A file that is empty, or holds no users list, is refused before anything is written: the
        // import mirrors invites, programs and assignments, so a truncated copy read as `{}` would
        // otherwise delete every one of them and report success.
        $raw = (string) file_get_contents($dbFile);
        try {
            $dbo = trim($raw) === '' ? null : Input::parse($raw);
            $db = $dbo instanceof \stdClass && is_array($dbo->users ?? null)
                ? json_decode(json_encode(['users' => $dbo->users, 'creds' => Js::list($dbo->creds ?? null)], JSON_THROW_ON_ERROR, 100_000), true, 100_000, JSON_THROW_ON_ERROR)
                : null;
        } catch (Throwable) {
            $db = null;
        }
        if ($db === null) {
            $this->error('db.json is not a Node API database (empty, not JSON, or no users list)');

            return self::FAILURE;
        }
        // Read-only: the import rewrites accounts and states from the files, so verifying right
        // after one checks the import and the read path, never drift since. This checks the
        // database as it stands.
        if ($this->option('verify-only')) {
            return $this->verify($db, $dbo, $dir);
        }

        $users = 0;
        $seen = [];
        $skipped = [];
        foreach ($db['users'] ?? [] as $position => $u) {
            if (empty($u['id']) || ! is_string($u['id'])) {
                continue;
            }
            // A duplicated id: Node's db.users.find answered with the FIRST row, so that is the
            // account; a later row with the same id was never reachable there.
            if (isset($seen[$u['id']])) {
                continue;
            }
            $seen[$u['id']] = true;
            $user = User::query()->firstOrNew(['id' => $u['id']]);
            $user->fill([
                'name' => mb_substr((string) ($u['name'] ?? ''), 0, 40),
                // `=== true`, as Node's isAdmin/isCoach: a stray "yes" or 1 in db.json granted
                // nothing there, so it must grant nothing here.
                'admin' => ($u['admin'] ?? null) === true,
                'coach' => ($u['coach'] ?? null) === true,
                'disabled' => ! empty($u['disabled']),
                'sv' => (int) ($u['sv'] ?? 0),
                'invited_by' => $u['invitedBy'] ?? null,
                'last_reminder' => $u['lastReminder'] ?? null,
                'last_checkin_reminder' => $u['lastCheckinReminder'] ?? null,
            ]);
            // Verbatim, milliseconds included. The Node API's oldest accounts have no `created`,
            // and keep none: the app reads null as "joined before we kept dates". Node only ever
            // wrote an ISO string; anything else is reported and kept as no date, never allowed
            // to stop the import halfway through the accounts.
            $user->created_at = self::createdAt($u['created'] ?? null, $u['id'], $skipped);
            // db.json's order is the roster's (Node listed db.users as stored). Kept, so the
            // undated oldest accounts — which no date can order — stay where Node had them.
            $user->legacy_order = (int) $position;
            $user->save();
            $users++;
        }

        // Second pass, now that every account exists: who coaches whom. users.coach_id is a foreign
        // key, and db.json may list a client before their coach. A coachId naming no account (Node
        // answered coachName null for it) is left empty and reported.
        $exists = array_flip(User::query()->pluck('id')->all());
        $current = User::query()->whereNotNull('coach_id')->pluck('coach_id', 'id')->all();
        foreach ($db['users'] ?? [] as $u) {
            if (! is_string($u['id'] ?? null) || ! array_key_exists($u['id'], $seen) || $seen[$u['id']] === 'linked') {
                continue;
            }
            $seen[$u['id']] = 'linked';
            $coach = is_string($u['coachId'] ?? null) ? $u['coachId'] : null;
            if ($coach !== null && ! isset($exists[$coach])) {
                $skipped[] = "coach of {$u['id']} ($coach: no such account)";
                $coach = null;
            }
            if (($current[$u['id']] ?? null) !== $coach) {   // a rerun writes only what changed
                User::query()->whereKey($u['id'])->update(['coach_id' => $coach]);
            }
        }

        $creds = 0;
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
        // Listed, not globbed: a data directory whose path holds `[` or `*` must still be read.
        foreach (LegacyCoaching::files($dir, 'state-') as $uid => $file) {
            $uid = (string) $uid;
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

        $coaching = LegacyCoaching::import($dbo, $dir, array_flip(User::query()->pluck('id')->all()), $skipped);

        $this->info("users $users · passkeys $creds · states $states · audit $audit · invites {$coaching['invites']} · programs {$coaching['programs']} · assignments {$coaching['assignments']}");
        if ($coaching['removed'] > 0) {
            $this->warn("removed {$coaching['removed']} invite/program/assignment row(s) the files no longer hold");
        }
        foreach ($skipped as $s) {
            $this->warn("skipped $s");
        }

        return $this->option('verify') ? $this->verify($db, $dbo, $dir) : self::SUCCESS;
    }

    /**
     * Every account read back the way the app reads it — /me and /data through the HTTP kernel,
     * with a session minted for it — and compared with what the Node API would have answered from
     * the same files (api/server.js publicUser, GET /api/data). Then the coaching routes, replayed
     * for each account as Node answered them from the same files: a coach's invites and program
     * library, an admin's invite list, and everyone's inbox and answered offers
     * (LegacyCoaching::nodeAnswers). A mismatch is reported by account and route; any mismatch
     * fails the command, so a cutover script can stop on it.
     */
    private function verify(array $db, \stdClass $dbo, string $dir): int
    {
        $objects = [];
        foreach (Js::list($dbo->users ?? null) as $u) {
            if ($u instanceof \stdClass && is_string($u->id ?? null)) {
                $objects[$u->id] ??= $u;
            }
        }
        $kernel = app(HttpKernel::class);
        // unique() keeps the FIRST row per id, as Node's db.users.find does; keyBy alone keeps the last.
        $byId = collect($db['users'] ?? [])->filter(fn ($u) => is_string($u['id'] ?? null))->unique('id')->keyBy('id');
        $adminUids = (array) config('fitpal.admin_uids');
        $coaching = LegacyCoaching::verifyContext($dbo, $dir, array_flip(User::query()->pluck('id')->all()));
        $problems = [];
        $get = function (User $user, string $path) use ($kernel) {
            $request = Request::create($path, 'GET', server: ['HTTP_AUTHORIZATION' => 'Bearer '.SessionToken::make($user)]);
            $response = $kernel->handle($request);
            $kernel->terminate($request, $response);
            // Each replayed request starts clean, as a real one would: no signed-in user and no
            // coach context carried over from the previous coach's request.
            app('auth')->forgetGuards();
            app()->forgetScopedInstances();

            return $response;
        };

        foreach ($byId as $id => $u) {
            $user = User::query()->find($id);
            if ($user === null) {
                $problems[] = "$id: not imported";

                continue;
            }
            $me = $get($user, '/api/me');
            if (! empty($u['disabled'])) {
                // A disabled account's sessions are refused, by Node and by Laravel alike.
                if ($me->getStatusCode() !== 401) {
                    $problems[] = "$id: disabled, but /me answered {$me->getStatusCode()}";
                }

                continue;
            }
            $isAdmin = ($u['admin'] ?? null) === true || in_array($id, $adminUids, true);
            $coach = isset($u['coachId']) ? $byId->get($u['coachId']) : null;
            $want = [
                // What NODE would answer — publicUser sends the name as stored — not what the
                // import produces: a name the import had to cut must show up as a difference.
                'id' => $id, 'name' => $u['name'] ?? null, 'admin' => $isAdmin,
                'coach' => ($u['coach'] ?? null) === true || $isAdmin,
                'coachName' => $coach['name'] ?? null,
            ];
            $got = json_decode((string) $me->getContent(), true)['user'] ?? null;
            if ($got !== $want) {
                $problems[] = "$id: /me is ".json_encode($got).', the files say '.json_encode($want);
            }

            foreach (LegacyCoaching::nodeAnswers($coaching, $objects[$id], $objects, $adminUids) as $route => $node) {
                $answer = json_decode((string) $get($user, substr($route, 4))->getContent());
                $laravel = $answer->{LegacyCoaching::FIELD[$route]} ?? null;
                if (json_encode(LegacyCoaching::canonical($laravel), Json::FLAGS) !== json_encode(LegacyCoaching::canonical($node), Json::FLAGS)) {
                    $problems[] = "$id: $route differs from the files";
                }
            }

            $file = $dir.DIRECTORY_SEPARATOR.'state-'.$id.'.json';
            // Node's GET /api/data answers the file exactly as stored, and the import stores it raw.
            $wantState = is_file($file) ? json_decode((string) file_get_contents($file)) : null;
            $gotState = json_decode((string) $get($user, '/api/data')->getContent())->state ?? null;
            // Compared re-encoded, not with ==, which is loose all the way down ("5" == 5,
            // null == false): a type the app would see changed must count as a difference.
            // Decoding to objects keeps {} apart from [].
            if (json_encode($gotState, Json::FLAGS) !== json_encode($wantState, Json::FLAGS)) {
                $problems[] = "$id: /data differs from state-$id.json";
            }
        }

        foreach ($problems as $p) {
            $this->error('verify  '.$p);
        }
        if ($problems !== []) {
            return self::FAILURE;
        }
        $this->info('verified '.$byId->count().' account(s): /me, /data and the coaching routes match the files');

        return self::SUCCESS;
    }

    /** An account's `created` as Node wrote it (an ISO string), or null — reported when it was something else. */
    private static function createdAt(mixed $created, string $id, array &$skipped): ?Carbon
    {
        if ($created === null || $created === '') {
            return null;
        }
        if (is_string($created) && preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/D', $created)) {
            try {
                return Carbon::parse($created);
            } catch (Throwable) {
                // falls through to the report below
            }
        }
        $skipped[] = "created of $id (".json_encode($created).': not an ISO date; kept as none)';

        return null;
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
