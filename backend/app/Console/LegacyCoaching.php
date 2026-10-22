<?php

namespace App\Console;

use App\Models\Assignment;
use App\Models\CoachProgram;
use App\Models\Invite;
use App\Support\Input;
use App\Support\Js;
use App\Support\Uid;
use Illuminate\Support\Facades\DB;
use stdClass;
use Throwable;

/**
 * The coaching half of fitpal:import-legacy: db.invites, the program libraries (coach-<uid>.json)
 * and db.assignments — and, for --verify, what the Node API would have answered from those same
 * files on the routes that read them.
 *
 * One cleaning step (rows()) decides what is imported, and both the import and the verify read
 * from it. A row it cannot store as Node served it — a field missing, of the wrong type, too wide
 * for its column, an orphan coach or member, a repeated id — is skipped and reported, never
 * half-written; the few changes it makes on purpose (an orphan coach's code kept as general, an
 * invite's requestId dropped) are reported too. Verify compares against the same cleaned rows, so
 * none of that is also a verify failure for ever.
 *
 * The files are the truth. A rerun updates rows in place (invites keep their mint order, programs
 * their library position) and REMOVES rows the files no longer hold: Node itself deletes programs
 * and prunes answered offers, so a row that survived would be one Node no longer serves. Run it
 * only while Node is the live API — after a cutover, check with --verify-only instead. A library
 * file that cannot be read or parsed (a torn copy) removes nothing: it is reported, and that
 * coach's rows are left alone.
 *
 * Runs with no CoachContext (a console command): every model is unscoped, coach_id is written as
 * the file has it, and bulk upserts are allowed (TenantBuilder refuses them only inside a context).
 */
final class LegacyCoaching
{
    /** Text fields and their column widths; `true` marks the ones every Node writer always set. */
    private const INVITE = ['code' => [32, true], 'note' => [60, true], 'createdBy' => [16, false], 'created' => [30, true],
        'usedBy' => [16, false], 'usedAt' => [30, false], 'revokedAt' => [30, false], 'revokedReason' => [60, false]];

    private const OFFER = ['id' => [16, true], 'coachName' => [40, true], 'note' => [280, true], 'status' => [16, true],
        'created' => [30, true], 'decidedAt' => [30, false]];

    private const PROGRAM = ['id' => [64, true], 'name' => [60, true]];

    /** Nesting a stored bundle may have: Js::stringify's 512 levels with room to spare. */
    private const BUNDLE_DEPTH = 500;

    /** The field each route's answer carries the list in. */
    public const FIELD = [
        'GET /api/coach/invites' => 'invites', 'GET /api/coach/programs' => 'programs',
        'GET /api/admin/invites' => 'invites', 'GET /api/assignments' => 'assignments',
        'GET /api/assignments/history' => 'assignments',
    ];

    /**
     * What is imported, cleaned and in file order: invites and offers as Node-shaped objects, and
     * each library by coach id (null for a file that could not be read or parsed).
     *
     * @param  array<string, true>  $accounts  the account ids that exist
     * @param  list<string>  $skipped
     * @return array{invites: list<stdClass>, offers: list<stdClass>, libraries: array<string, ?list<stdClass>>}
     */
    public static function rows(stdClass $db, string $dir, array $accounts, array &$skipped): array
    {
        $invites = [];
        $seen = [];
        foreach (Js::list($db->invites ?? null) as $i) {
            $code = $i instanceof stdClass ? ($i->code ?? null) : null;
            if (! is_string($code) || $code === '') {
                $skipped[] = 'invite '.json_encode($code).' (no usable code)';

                continue;
            }
            // A repeated code: Node's find() answered with the FIRST row, kept or not, so a later
            // row with the same code was never served.
            if (isset($seen[$code])) {
                $skipped[] = "invite $code (a second row with the same code)";

                continue;
            }
            $seen[$code] = true;
            if (! self::fits($i, self::INVITE, "invite $code", $skipped)) {
                continue;
            }
            $row = clone $i;
            if (isset($row->coachId) && ! (is_string($row->coachId) && isset($accounts[$row->coachId]))) {
                // coachBinding() found no such coach, so the code bound nobody — kept, as general.
                $who = is_string($row->coachId) ? $row->coachId : json_encode($row->coachId);
                $skipped[] = "coach of invite $code ($who: no such account; kept as a general code)";
                unset($row->coachId);
            }
            if (property_exists($row, 'requestId')) {
                // Access requests are not ported (spec §2); the code itself is.
                $skipped[] = "requestId of invite $code (access requests are not ported; the code is kept)";
                unset($row->requestId);
            }
            $invites[] = $row;
        }

        $offers = [];
        $seen = [];
        foreach (Js::list($db->assignments ?? null) as $a) {
            $id = $a instanceof stdClass ? ($a->id ?? null) : null;
            if (! is_string($id) || $id === '') {
                $skipped[] = 'assignment '.json_encode($id).' (no usable id)';

                continue;
            }
            if (isset($seen[$id])) {
                $skipped[] = "assignment $id (a second row with the same id)";

                continue;
            }
            $seen[$id] = true;
            if (! is_string($a->coachId ?? null) || ! isset($accounts[$a->coachId]) || ! is_string($a->memberId ?? null) || ! isset($accounts[$a->memberId])) {
                $skipped[] = "assignment $id (its coach or member is not an account)";

                continue;
            }
            if (self::fits($a, self::OFFER, "assignment $id", $skipped) && self::storable($a->bundle ?? null, "assignment $id", $skipped)) {
                $offers[] = $a;
            }
        }

        $bySafe = self::bySafeUid($accounts);
        $libraries = [];
        foreach (self::files($dir, 'coach-') as $uid => $file) {
            $coachId = $bySafe[$uid] ?? null;
            if ($coachId === null) {
                $skipped[] = basename($file).' (no such account)';

                continue;
            }
            $programs = self::readPrograms($file);
            if ($programs === null) {
                $skipped[] = basename($file).' (cannot be read; this library is left as it was)';
                $libraries[$coachId] = null;

                continue;
            }
            $kept = [];
            $seen = [];
            foreach ($programs as $p) {
                $pid = $p instanceof stdClass ? ($p->id ?? null) : null;
                $label = basename($file).' program '.(is_string($pid) ? $pid : json_encode($pid));
                if (! is_string($pid) || $pid === '') {
                    $skipped[] = "$label (no usable id)";

                    continue;
                }
                if (isset($seen[$pid])) {
                    $skipped[] = "$label (a second row with the same id)";

                    continue;
                }
                $seen[$pid] = true;
                // created/updated are Date.now() values: stored as unsigned integers, so anything
                // else could not come back as Node served it.
                foreach (['created', 'updated'] as $k) {
                    $v = $p->{$k} ?? null;
                    if (! is_int($v) || $v < 0) {
                        $skipped[] = "$label ($k is not a timestamp in milliseconds)";

                        continue 2;
                    }
                }
                if (self::fits($p, self::PROGRAM, $label, $skipped) && self::storable($p->bundle ?? null, $label, $skipped)) {
                    $kept[] = $p;
                }
            }
            $libraries[$coachId] = $kept;
        }

        return ['invites' => $invites, 'offers' => $offers, 'libraries' => $libraries];
    }

    /**
     * Writes rows() in one transaction — a failure halfway leaves the tables as they were, mirror
     * deletes included — as bulk upserts in file order.
     *
     * @return array{invites: int, programs: int, assignments: int, removed: int}
     */
    public static function import(stdClass $db, string $dir, array $accounts, array &$skipped): array
    {
        $rows = self::rows($db, $dir, $accounts, $skipped);

        return DB::transaction(function () use ($rows): array {
            $removed = 0;

            // Invites, in db.json order: mint order, which seq keeps. An upsert keeps an existing
            // code's seq and appends new codes in the order given.
            $invites = array_map(fn (stdClass $i) => [
                'code' => $i->code, 'note' => $i->note, 'created_by' => self::text($i->createdBy ?? null),
                'coach_id' => self::text($i->coachId ?? null), 'created' => $i->created,
                'used_by' => self::text($i->usedBy ?? null), 'used_at' => self::text($i->usedAt ?? null),
                // `!!i.revoked`, as every Node reader tested it.
                'revoked' => Js::truthy($i->revoked ?? null),
                'revoked_at' => self::text($i->revokedAt ?? null), 'revoked_reason' => self::text($i->revokedReason ?? null),
            ], $rows['invites']);
            foreach (array_chunk($invites, 200) as $chunk) {
                Invite::acrossCoaches()->upsert($chunk, ['code'], array_keys(array_diff_key($chunk[0], ['code' => 0]))); // across coaches: the import writes every coach's codes
            }
            $keep = array_flip(array_column($invites, 'code'));
            $removed += self::delete(Invite::class, array_filter(Invite::acrossCoaches()->pluck('code')->all(), fn ($c) => ! isset($keep[$c]))); // across coaches: the import mirrors every coach's codes

            // Libraries. A coach whose file could not be read keeps every row it had.
            $programs = [];
            foreach ($rows['libraries'] as $coachId => $list) {
                foreach ($list ?? [] as $p) {
                    $programs[] = ['coach_id' => (string) $coachId, 'program_id' => $p->id, 'name' => $p->name,
                        'bundle' => Js::stringify($p->bundle), 'created' => $p->created, 'updated' => $p->updated];
                }
            }
            foreach (array_chunk($programs, 200) as $chunk) {
                CoachProgram::acrossCoaches()->upsert($chunk, ['coach_id', 'program_id'], ['name', 'bundle', 'created', 'updated']); // across coaches: the import writes every library
            }
            $unread = array_keys(array_filter($rows['libraries'], fn ($l) => $l === null));
            $keep = array_flip(array_map(fn (array $p) => "{$p['coach_id']}\n{$p['program_id']}", $programs));
            $gone = CoachProgram::acrossCoaches()->whereNotIn('coach_id', $unread)->get(['id', 'coach_id', 'program_id']) // across coaches: the import mirrors every library
                ->reject(fn (CoachProgram $p) => isset($keep["{$p->coach_id}\n{$p->program_id}"]))->pluck('id')->all();
            $removed += self::delete(CoachProgram::class, $gone);

            $offers = array_map(fn (stdClass $a) => [
                'id' => $a->id, 'coach_id' => $a->coachId, 'coach_name' => $a->coachName, 'member_id' => $a->memberId,
                'bundle' => Js::stringify($a->bundle), 'note' => $a->note,
                'schedule' => Js::truthy($a->schedule ?? null), 'status' => $a->status,
                'created' => $a->created, 'decided_at' => self::text($a->decidedAt ?? null),
            ], $rows['offers']);
            foreach (array_chunk($offers, 200) as $chunk) {
                Assignment::acrossCoaches()->upsert($chunk, ['id'], array_keys(array_diff_key($chunk[0], ['id' => 0]))); // across coaches: the import writes every coach's offers
            }
            $keep = array_flip(array_column($offers, 'id'));
            $removed += self::delete(Assignment::class, array_filter(Assignment::acrossCoaches()->pluck('id')->all(), fn ($id) => ! isset($keep[$id]))); // across coaches: the import mirrors every offer

            return ['invites' => count($invites), 'programs' => count($programs), 'assignments' => count($offers), 'removed' => $removed];
        });
    }

    /**
     * For --verify: the cleaned rows, read once and grouped once, so each account's answers are
     * computed from its own slice rather than by rescanning every row per account.
     */
    public static function verifyContext(stdClass $db, string $dir, array $accounts): array
    {
        $ignored = [];
        $rows = self::rows($db, $dir, $accounts, $ignored);
        $ctx = ['invites' => $rows['invites'], 'byCoach' => [], 'byMember' => [], 'libraries' => $rows['libraries']];
        foreach ($rows['invites'] as $i) {
            if (is_string($i->coachId ?? null)) {
                $ctx['byCoach'][$i->coachId][] = $i;
            }
        }
        foreach ($rows['offers'] as $a) {
            $ctx['byMember'][$a->memberId][] = $a;
        }

        return $ctx;
    }

    /**
     * What the Node API answered on each route the coaching tables serve, computed from the cleaned
     * rows as api/server.js computed it. Keyed by route; each value is the field the app reads.
     *
     * @param  array<string, stdClass>  $users  db.users by id (first row per id)
     * @return array<string, mixed>
     */
    public static function nodeAnswers(array $ctx, stdClass $u, array $users, array $adminUids): array
    {
        $isAdmin = fn (?stdClass $x) => $x !== null && (($x->admin ?? null) === true || in_array($x->id ?? null, $adminUids, true));
        $isCoach = fn (?stdClass $x) => $x !== null && (($x->coach ?? null) === true || $isAdmin($x));
        // domain.mjs canCoachMember, `disabled` read as JS reads it.
        $canCoach = fn (stdClass $coach, ?stdClass $m) => $m !== null && ($m->id ?? null) !== $coach->id
            && ! Js::truthy($m->disabled ?? null) && ! Js::truthy($coach->disabled ?? null) && ($isAdmin($coach) || ($m->coachId ?? null) === $coach->id);
        $account = fn (mixed $uid) => is_string($uid) ? ($users[$uid] ?? null) : null;
        $want = [];

        if ($isCoach($u)) {
            $want['GET /api/coach/invites'] = array_map(function (stdClass $i) use ($u, $account, $canCoach) {
                $by = Js::truthy($i->usedBy ?? null) ? $account($i->usedBy) : null;

                return [
                    'code' => $i->code, 'note' => $i->note, 'created' => $i->created,
                    'revoked' => Js::truthy($i->revoked ?? null), 'usedAt' => Js::or($i->usedAt ?? null, null),
                    // `u && canCoachMember(...) ? u.name : null`
                    'usedByName' => $by && $canCoach($u, $by) ? ($by->name ?? null) : null,
                ];
            }, $ctx['byCoach'][$u->id] ?? []);
            // readCoachData serves [] for a file it cannot parse, as for none at all.
            $want['GET /api/coach/programs'] = $ctx['libraries'][$u->id] ?? [];
        }
        if ($isAdmin($u)) {
            $want['GET /api/admin/invites'] = array_map(function (stdClass $i) use ($account) {
                $row = clone $i;
                // `(db.users.find(...) || {}).name || null`
                $row->usedByName = Js::truthy($i->usedBy ?? null) ? Js::or($account($i->usedBy)?->name ?? null, null) : null;

                return $row;
            }, $ctx['invites']);
        }
        $mine = $ctx['byMember'][$u->id] ?? [];
        $want['GET /api/assignments'] = array_map(fn (stdClass $a) => [
            'id' => $a->id, 'coachName' => $a->coachName, 'note' => $a->note, 'created' => $a->created,
            'schedule' => Js::truthy($a->schedule ?? null), 'bundle' => $a->bundle,
        ], array_values(array_filter($mine, fn ($a) => $a->status === 'pending')));
        $decided = array_values(array_filter($mine, fn ($a) => in_array($a->status, ['accepted', 'declined'], true)));
        $key = fn (stdClass $a) => Js::string(Js::or($a->decidedAt ?? null, Js::or($a->created, '')));
        usort($decided, fn ($x, $y) => strcmp($key($y), $key($x)));   // stable, as JS's sort
        $want['GET /api/assignments/history'] = array_map(fn (stdClass $a) => [
            'id' => $a->id, 'coachName' => $a->coachName, 'note' => $a->note,
            'created' => $a->created, 'decidedAt' => Js::or($a->decidedAt ?? null, null), 'status' => $a->status,
            'name' => Js::or($a->bundle->name ?? null, ''),
            'routines' => is_array($a->bundle->routines ?? null) ? count($a->bundle->routines) : 0,
        ], $decided);

        return $want;
    }

    /**
     * The `<prefix><uid>.json` files of a data directory, keyed by uid. Listed, not globbed: a
     * directory whose path holds `[`, `*` or `?` would make glob() find nothing — and an import
     * that finds no libraries would mirror every program away.
     *
     * @return array<string, string>
     */
    public static function files(string $dir, string $prefix): array
    {
        $out = [];
        foreach (scandir($dir) ?: [] as $name) {
            if (str_starts_with($name, $prefix) && str_ends_with($name, '.json') && strlen($name) > strlen($prefix) + 5) {
                $out[substr($name, strlen($prefix), -5)] = $dir.DIRECTORY_SEPARATOR.$name;
            }
        }
        ksort($out, SORT_STRING);

        return $out;
    }

    /**
     * A value with every object's keys sorted, recursively: a JSON object's key order means
     * nothing to the app, and Node kept db.json keys in the order each was first written.
     */
    public static function canonical(mixed $v): mixed
    {
        if (is_array($v) && array_is_list($v)) {
            return array_map(self::canonical(...), $v);
        }
        if (is_array($v) || $v instanceof stdClass) {
            $o = (array) $v;
            ksort($o, SORT_STRING);

            return (object) array_map(self::canonical(...), $o);
        }

        return $v;
    }

    /**
     * readCoachData's programs: `Array.isArray(d && d.programs) ? d.programs : []` for any JSON —
     * null, [] or an object without the list included. Null only where Node's JSON.parse would
     * have thrown, or the file is empty: a torn copy, whose library this import must not erase.
     */
    private static function readPrograms(string $file): ?array
    {
        [$read, $d] = self::readJson($file);

        return ! $read ? null : ($d instanceof stdClass ? Js::list($d->programs ?? null) : []);
    }

    /**
     * A data file as Node's JSON.parse read it (Input::parse): [true, the value], or [false, null]
     * for one that is empty or would have thrown — a torn copy, which an import must not mirror.
     *
     * @return array{bool, mixed}
     */
    public static function readJson(string $file): array
    {
        $raw = @file_get_contents($file);
        if (! is_string($raw) || trim($raw) === '') {
            return [false, null];
        }
        try {
            return [true, Input::parse($raw)];
        } catch (Throwable) {
            return [false, null];
        }
    }

    /**
     * Account ids by the name their files carry (Uid::safe, as Node's safeUid named them); the
     * first account wins a name two ids would share.
     *
     * @param  array<string, true>  $accounts
     * @return array<string, string>
     */
    public static function bySafeUid(array $accounts): array
    {
        $bySafe = [];
        foreach (array_keys($accounts) as $id) {
            $bySafe[Uid::safe((string) $id)] ??= (string) $id;
        }

        return $bySafe;
    }

    /**
     * Whether every text field of a row is text, present where Node always wrote it, and fits
     * its column; a row that is not is reported and skipped, never written half-way. Widths are
     * counted in characters, as MariaDB counts a utf8mb4 VARCHAR.
     *
     * @param  array<string, array{int, bool}>  $fields
     */
    public static function fits(stdClass $row, array $fields, string $label, array &$skipped): bool
    {
        foreach ($fields as $field => [$max, $required]) {
            $v = $row->{$field} ?? null;
            if ($v === null && $required) {
                $skipped[] = "$label ($field is missing)";

                return false;
            }
            if ($v !== null && ! is_string($v)) {
                $skipped[] = "$label ($field is not text)";

                return false;
            }
            if (is_string($v) && mb_strlen($v) > $max) {
                $skipped[] = "$label ($field is longer than $max characters)";

                return false;
            }
        }

        return true;
    }

    /** A bundle that can be stored and served back as it was: an object, of sane depth. */
    private static function storable(mixed $bundle, string $label, array &$skipped): bool
    {
        if (! $bundle instanceof stdClass) {
            $skipped[] = "$label (bundle is not a plan)";

            return false;
        }
        if (Js::deeperThan($bundle, self::BUNDLE_DEPTH)) {
            $skipped[] = "$label (bundle is nested deeper than ".self::BUNDLE_DEPTH.' levels)';

            return false;
        }

        return true;
    }

    private static function text(mixed $v): ?string
    {
        return is_string($v) && $v !== '' ? $v : null;
    }

    /**
     * Deletes these keys of a coaching model, in chunks; returns how many went.
     *
     * @param  class-string<Invite|CoachProgram|Assignment>  $model
     */
    private static function delete(string $model, array $keys): int
    {
        $n = 0;
        foreach (array_chunk(array_values($keys), 500) as $chunk) {
            $n += $model::acrossCoaches()->whereKey($chunk)->delete(); // across coaches: the import mirrors every coach's rows
        }

        return $n;
    }
}
