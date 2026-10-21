<?php

namespace App\Console;

use App\Models\Assignment;
use App\Models\CoachProgram;
use App\Models\Invite;
use App\Support\Input;
use App\Support\Js;
use Illuminate\Support\Facades\DB;
use stdClass;
use Throwable;

/**
 * The coaching half of fitpal:import-legacy: db.invites, the program libraries (coach-<uid>.json)
 * and db.assignments — and, for --verify, what the Node API would have answered from those same
 * files on the routes that read them.
 *
 * One cleaning step (rows()) decides what is imported, and both the import and the verify read
 * from it. Whatever it drops or changes is reported in $skipped, and verify compares against the
 * cleaned rows — so a reported, deliberate change (an orphan coach's code kept as general, a
 * repeated id, an offer whose member is not an account) is not also a verify failure for ever.
 *
 * The files are the truth. A rerun updates rows in place (invites keep their mint order, programs
 * their library position) and REMOVES rows the files no longer hold: Node itself deletes programs
 * and prunes answered offers, so a row that survived would be one Node no longer serves. Run it
 * only while Node is the live API — after a cutover, check with --verify-only instead. A library
 * file that cannot be read removes nothing: it is reported, and that coach's rows are left alone.
 *
 * Runs with no CoachContext (a console command): every model is unscoped, coach_id is written as
 * the file has it, and bulk upserts are allowed (TenantBuilder refuses them only inside a context).
 */
final class LegacyCoaching
{
    /** Column widths the cleaning step enforces — strict MariaDB refuses a longer value. */
    private const INVITE = ['code' => 32, 'note' => 60, 'createdBy' => 16, 'created' => 30, 'usedBy' => 16, 'usedAt' => 30, 'revokedAt' => 30, 'revokedReason' => 60];

    private const OFFER = ['id' => 16, 'coachName' => 40, 'note' => 280, 'status' => 16, 'created' => 30, 'decidedAt' => 30];

    private const PROGRAM = ['id' => 64, 'name' => 60];

    /** The field each route's answer carries the list in. */
    public const FIELD = [
        'GET /api/coach/invites' => 'invites', 'GET /api/coach/programs' => 'programs',
        'GET /api/admin/invites' => 'invites', 'GET /api/assignments' => 'assignments',
        'GET /api/assignments/history' => 'assignments',
    ];

    /**
     * What is imported, cleaned and in file order: invites and offers as Node-shaped objects, and
     * each readable library by coach id (null for a file that could not be read).
     *
     * @param  array<string, true>  $accounts  the account ids that exist
     * @param  list<string>  $skipped
     * @return array{invites: list<stdClass>, offers: list<stdClass>, libraries: array<string, ?list<stdClass>>}
     */
    public static function rows(stdClass $db, string $dir, array $accounts, array &$skipped): array
    {
        $invites = [];
        foreach (Js::list($db->invites ?? null) as $i) {
            $code = $i instanceof stdClass ? ($i->code ?? null) : null;
            if (! is_string($code) || $code === '' || ! self::fits($i, self::INVITE, "invite $code", $skipped)) {
                if (! is_string($code) || $code === '') {
                    $skipped[] = 'invite '.json_encode($code).' (no usable code)';
                }

                continue;
            }
            // A repeated code: Node's find() answered with the first, so that is the invite.
            if (isset($invites[$code])) {
                $skipped[] = "invite $code (a second row with the same code)";

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
            $invites[$code] = $row;
        }

        $offers = [];
        foreach (Js::list($db->assignments ?? null) as $a) {
            $id = $a instanceof stdClass ? ($a->id ?? null) : null;
            if (! is_string($id) || $id === '') {
                $skipped[] = 'assignment '.json_encode($id).' (no usable id)';

                continue;
            }
            if (isset($offers[$id])) {
                $skipped[] = "assignment $id (a second row with the same id)";

                continue;
            }
            if (! is_string($a->coachId ?? null) || ! isset($accounts[$a->coachId]) || ! is_string($a->memberId ?? null) || ! isset($accounts[$a->memberId])) {
                $skipped[] = "assignment $id (its coach or member is not an account)";

                continue;
            }
            if (self::fits($a, self::OFFER, "assignment $id", $skipped)) {
                $offers[$id] = $a;
            }
        }

        $bySafe = [];
        foreach (array_keys($accounts) as $id) {
            $bySafe[self::safeUid((string) $id)] ??= (string) $id;
        }
        $libraries = [];
        foreach (glob($dir.DIRECTORY_SEPARATOR.'coach-*.json') ?: [] as $file) {
            $coachId = $bySafe[substr(basename($file, '.json'), 6)] ?? null;
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
            foreach ($programs as $p) {
                $pid = $p instanceof stdClass ? ($p->id ?? null) : null;
                if (! is_string($pid) || $pid === '') {
                    $skipped[] = basename($file).' program '.json_encode($pid).' (no usable id)';
                } elseif (isset($kept[$pid])) {
                    $skipped[] = basename($file)." program $pid (a second row with the same id)";
                } elseif (self::fits($p, self::PROGRAM, basename($file)." program $pid", $skipped)) {
                    $kept[$pid] = $p;
                }
            }
            $libraries[$coachId] = array_values($kept);
        }

        return ['invites' => array_values($invites), 'offers' => array_values($offers), 'libraries' => $libraries];
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
                'code' => $i->code, 'note' => self::text($i->note ?? null) ?? '', 'created_by' => self::text($i->createdBy ?? null),
                'coach_id' => self::text($i->coachId ?? null), 'created' => self::text($i->created ?? null) ?? '',
                'used_by' => self::text($i->usedBy ?? null), 'used_at' => self::text($i->usedAt ?? null),
                // `!!i.revoked`, as every Node reader tested it.
                'revoked' => Js::truthy($i->revoked ?? null),
                'revoked_at' => self::text($i->revokedAt ?? null), 'revoked_reason' => self::text($i->revokedReason ?? null),
            ], $rows['invites']);
            foreach (array_chunk($invites, 200) as $chunk) {
                Invite::acrossCoaches()->upsert($chunk, ['code'], array_keys(array_diff_key($chunk[0], ['code' => 0]))); // across coaches: the import writes every coach's codes
            }
            $removed += self::removeAbsent(Invite::acrossCoaches()->pluck('code')->all(), array_column($invites, 'code'), // across coaches: the import mirrors every coach's codes
                fn (array $gone) => Invite::acrossCoaches()->whereKey($gone)->delete()); // across coaches: the import mirrors every coach's codes

            // Libraries. A coach whose file could not be read keeps every row it had.
            $programs = [];
            foreach ($rows['libraries'] as $coachId => $list) {
                foreach ($list ?? [] as $p) {
                    $programs[] = [
                        'coach_id' => (string) $coachId, 'program_id' => $p->id, 'name' => self::text($p->name ?? null) ?? '',
                        'bundle' => Js::stringify($p->bundle ?? null),
                        'created' => (int) Js::toNumber($p->created ?? 0), 'updated' => (int) Js::toNumber($p->updated ?? 0),
                    ];
                }
            }
            foreach (array_chunk($programs, 200) as $chunk) {
                CoachProgram::acrossCoaches()->upsert($chunk, ['coach_id', 'program_id'], ['name', 'bundle', 'created', 'updated']); // across coaches: the import writes every library
            }
            $unread = array_keys(array_filter($rows['libraries'], fn ($l) => $l === null));
            $present = CoachProgram::acrossCoaches()->whereNotIn('coach_id', $unread)->get(['id', 'coach_id', 'program_id']) // across coaches: the import mirrors every library
                ->mapWithKeys(fn (CoachProgram $p) => [$p->id => "{$p->coach_id}\n{$p->program_id}"])->all();
            $keep = array_flip(array_map(fn (array $p) => "{$p['coach_id']}\n{$p['program_id']}", $programs));
            $removed += self::removeAbsent(array_keys(array_filter($present, fn ($k) => ! isset($keep[$k]))), [],
                fn (array $gone) => CoachProgram::acrossCoaches()->whereKey($gone)->delete()); // across coaches: the import mirrors every library

            $offers = array_map(fn (stdClass $a) => [
                'id' => $a->id, 'coach_id' => $a->coachId, 'coach_name' => self::text($a->coachName ?? null) ?? '', 'member_id' => $a->memberId,
                'bundle' => Js::stringify($a->bundle ?? null), 'note' => self::text($a->note ?? null) ?? '',
                'schedule' => Js::truthy($a->schedule ?? null), 'status' => self::text($a->status ?? null) ?? '',
                'created' => self::text($a->created ?? null) ?? '', 'decided_at' => self::text($a->decidedAt ?? null),
            ], $rows['offers']);
            foreach (array_chunk($offers, 200) as $chunk) {
                Assignment::acrossCoaches()->upsert($chunk, ['id'], array_keys(array_diff_key($chunk[0], ['id' => 0]))); // across coaches: the import writes every coach's offers
            }
            $removed += self::removeAbsent(Assignment::acrossCoaches()->pluck('id')->all(), array_column($offers, 'id'), // across coaches: the import mirrors every offer
                fn (array $gone) => Assignment::acrossCoaches()->whereKey($gone)->delete()); // across coaches: the import mirrors every offer

            return ['invites' => count($invites), 'programs' => count($programs), 'assignments' => count($offers), 'removed' => $removed];
        });
    }

    /**
     * For --verify: the cleaned rows grouped once, so each account's answers are computed from its
     * own slice rather than by rescanning every invite and offer per account.
     */
    public static function verifyContext(stdClass $db, string $dir, array $accounts): array
    {
        $ignored = [];
        $rows = self::rows($db, $dir, $accounts, $ignored);
        $ctx = ['invites' => $rows['invites'], 'byCoach' => [], 'byMember' => [], 'dir' => $dir];
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
     * What the Node API answered on each route the coaching tables serve, computed from the files
     * as api/server.js computed it. Keyed by route; each value is the field the app reads.
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
                    'code' => $i->code, 'note' => $i->note ?? null, 'created' => $i->created ?? null,
                    'revoked' => Js::truthy($i->revoked ?? null), 'usedAt' => Js::or($i->usedAt ?? null, null),
                    // `u && canCoachMember(...) ? u.name : null`
                    'usedByName' => $by && $canCoach($u, $by) ? ($by->name ?? null) : null,
                ];
            }, $ctx['byCoach'][$u->id] ?? []);
            $want['GET /api/coach/programs'] = self::programsIn($ctx['dir'].DIRECTORY_SEPARATOR.'coach-'.self::safeUid($u->id).'.json');
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
            'id' => $a->id, 'coachName' => $a->coachName ?? null, 'note' => $a->note ?? null, 'created' => $a->created ?? null,
            'schedule' => Js::truthy($a->schedule ?? null), 'bundle' => $a->bundle ?? null,
        ], array_values(array_filter($mine, fn ($a) => ($a->status ?? null) === 'pending')));
        $decided = array_values(array_filter($mine, fn ($a) => in_array($a->status ?? null, ['accepted', 'declined'], true)));
        $key = fn (stdClass $a) => Js::string(Js::or($a->decidedAt ?? null, Js::or($a->created ?? null, '')));
        usort($decided, fn ($x, $y) => strcmp($key($y), $key($x)));   // stable, as JS's sort
        $want['GET /api/assignments/history'] = array_map(fn (stdClass $a) => [
            'id' => $a->id, 'coachName' => $a->coachName ?? null, 'note' => $a->note ?? null,
            'created' => $a->created ?? null, 'decidedAt' => Js::or($a->decidedAt ?? null, null), 'status' => $a->status,
            'name' => Js::or(($a->bundle ?? null) instanceof stdClass ? ($a->bundle->name ?? null) : null, ''),
            'routines' => ($a->bundle ?? null) instanceof stdClass && is_array($a->bundle->routines ?? null) ? count($a->bundle->routines) : 0,
        ], $decided);

        return $want;
    }

    /** `readCoachData(uid).programs` as Node served it: the list, or nothing for a missing or unreadable file. */
    public static function programsIn(string $file): array
    {
        return self::readPrograms($file) ?? [];
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

    /** api/server.js safeUid: how Node named an account's files. */
    private static function safeUid(string $id): string
    {
        return (string) preg_replace('/[^a-zA-Z0-9_-]/', '', $id);
    }

    /** The programs in a library file, [] when it has none, null when it cannot be read or parsed. */
    private static function readPrograms(string $file): ?array
    {
        if (! is_file($file)) {
            return [];
        }
        try {
            $raw = file_get_contents($file);
            $d = is_string($raw) && $raw !== '' ? Input::parse($raw) : null;
        } catch (Throwable) {
            return null;
        }

        return $d instanceof stdClass ? Js::list($d->programs ?? null) : null;
    }

    /**
     * Whether every text field of a row is text (or absent) and fits its column; a row that does
     * not is reported and skipped, never written half-way. Widths are counted in characters, as
     * MariaDB counts a utf8mb4 VARCHAR.
     *
     * @param  array<string, int>  $widths
     */
    private static function fits(stdClass $row, array $widths, string $label, array &$skipped): bool
    {
        foreach ($widths as $field => $max) {
            $v = $row->{$field} ?? null;
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

    private static function text(mixed $v): ?string
    {
        return is_string($v) && $v !== '' ? $v : null;
    }

    /** Deletes the keys in $present that are not in $keep, in chunks; returns how many went. */
    private static function removeAbsent(array $present, array $keep, callable $delete): int
    {
        $keep = array_flip($keep);
        $gone = array_values(array_filter($present, fn ($k) => ! isset($keep[$k])));
        $n = 0;
        foreach (array_chunk($gone, 500) as $chunk) {
            $n += $delete($chunk);
        }

        return $n;
    }
}
