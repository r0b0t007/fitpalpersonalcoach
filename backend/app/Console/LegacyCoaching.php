<?php

namespace App\Console;

use App\Models\Assignment;
use App\Models\CoachProgram;
use App\Models\Invite;
use App\Models\User;
use App\Support\Input;
use App\Support\Js;
use stdClass;
use Throwable;

/**
 * The coaching half of fitpal:import-legacy: db.invites, the program libraries (coach-<uid>.json)
 * and db.assignments — and, for --verify, what the Node API would have answered from those same
 * files on the routes that read them.
 *
 * The files are the truth. A rerun updates rows in place (invites keep their mint order, programs
 * their library position) and REMOVES rows the files no longer have: Node itself deletes programs
 * and prunes answered offers, so a row that survived would be one Node no longer serves. Run it
 * only while Node is the live API — after a cutover, check with --verify-only instead.
 *
 * Runs with no CoachContext (a console command), so every model is unscoped and coach_id is set
 * by hand: the import is the one writer that knows each row's coach from the file.
 */
final class LegacyCoaching
{
    /**
     * @param  stdClass  $db  db.json as Node parsed it (objects stay objects: a bundle's {} is kept)
     * @param  list<string>  $skipped
     * @return array{invites: int, programs: int, assignments: int, removed: int}
     */
    public static function import(stdClass $db, string $dir, array &$skipped): array
    {
        $users = array_flip(User::query()->pluck('id')->all());
        $out = ['invites' => 0, 'programs' => 0, 'assignments' => 0, 'removed' => 0];

        // Invites, in db.json order: that is mint order, which `seq` keeps for every list. A code
        // already imported keeps its seq; db.invites is only ever appended to.
        $codes = [];
        foreach (Js::list($db->invites ?? null) as $i) {
            $code = $i->code ?? null;
            if (! $i instanceof stdClass || ! is_string($code) || $code === '' || strlen($code) > 32) {
                $skipped[] = 'invite '.json_encode($code).' (no usable code)';

                continue;
            }
            // A repeated code: Node's find() answered with the first, so that is the invite.
            if (isset($codes[$code])) {
                $skipped[] = "invite $code (a second row with the same code)";

                continue;
            }
            $codes[$code] = true;
            $coachId = self::str($i->coachId ?? null);
            if ($coachId !== null && ! isset($users[$coachId])) {
                // coachBinding() found no such coach, so the code bound nobody — kept, as general.
                $skipped[] = "coach of invite $code ($coachId: no such account; kept as a general code)";
                $coachId = null;
            }
            if (isset($i->requestId)) {
                // Access requests are not ported (spec §2); the code itself is.
                $skipped[] = "requestId of invite $code (access requests are not ported; the code is kept)";
            }
            Invite::acrossCoaches()->firstOrNew(['code' => $code]) // across coaches: the import writes every coach's codes
                ->forceFill([
                    'note' => (string) ($i->note ?? ''), 'created_by' => self::str($i->createdBy ?? null),
                    'coach_id' => $coachId, 'created' => (string) ($i->created ?? ''),
                    'used_by' => self::str($i->usedBy ?? null), 'used_at' => self::str($i->usedAt ?? null),
                    // `!!i.revoked`, as every Node reader tested it.
                    'revoked' => Js::truthy($i->revoked ?? null),
                    'revoked_at' => self::str($i->revokedAt ?? null), 'revoked_reason' => self::str($i->revokedReason ?? null),
                ])->save();
            $out['invites']++;
        }
        $out['removed'] += self::removeAbsent(Invite::acrossCoaches()->pluck('code')->all(), $codes, // across coaches: the import mirrors every coach's codes
            fn (array $gone) => Invite::acrossCoaches()->whereKey($gone)->delete()); // across coaches: the import mirrors every coach's codes

        // Program libraries: one file per coach, named after safeUid(id) as Node named it.
        $bySafe = [];
        foreach (array_keys($users) as $id) {
            $bySafe[preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $id)] ??= (string) $id;
        }
        $kept = [];
        foreach (glob($dir.DIRECTORY_SEPARATOR.'coach-*.json') ?: [] as $file) {
            $coachId = $bySafe[substr(basename($file, '.json'), 6)] ?? null;
            if ($coachId === null) {
                $skipped[] = basename($file).' (no such account)';

                continue;
            }
            foreach (self::programsIn($file) as $p) {
                $pid = $p instanceof stdClass ? ($p->id ?? null) : null;
                if (! is_string($pid) || $pid === '' || strlen($pid) > 64) {
                    $skipped[] = basename($file).' program '.json_encode($pid).' (no usable id)';

                    continue;
                }
                if (isset($kept["$coachId\n$pid"])) {
                    $skipped[] = basename($file)." program $pid (a second row with the same id)";

                    continue;
                }
                $row = CoachProgram::acrossCoaches()->where('coach_id', $coachId)->where('program_id', $pid)->first() // across coaches: the import writes every coach's library
                    ?? (new CoachProgram)->forceFill(['coach_id' => $coachId, 'program_id' => $pid]);
                $row->forceFill([
                    'name' => mb_substr((string) ($p->name ?? ''), 0, 60), 'bundle' => Js::stringify($p->bundle ?? null),
                    'created' => (int) Js::toNumber($p->created ?? 0), 'updated' => (int) Js::toNumber($p->updated ?? 0),
                ])->save();
                $kept["$coachId\n$pid"] = $row->id;
                $out['programs']++;
            }
        }
        $out['removed'] += self::removeAbsent(CoachProgram::acrossCoaches()->pluck('id')->all(), array_flip($kept), // across coaches: the import mirrors every library
            fn (array $gone) => CoachProgram::acrossCoaches()->whereKey($gone)->delete()); // across coaches: the import mirrors every library

        $ids = [];
        foreach (Js::list($db->assignments ?? null) as $a) {
            $id = $a instanceof stdClass ? ($a->id ?? null) : null;
            if (! is_string($id) || $id === '' || strlen($id) > 16) {
                $skipped[] = 'assignment '.json_encode($id).' (no usable id)';

                continue;
            }
            if (isset($ids[$id])) {
                $skipped[] = "assignment $id (a second row with the same id)";

                continue;
            }
            $coachId = self::str($a->coachId ?? null);
            $memberId = self::str($a->memberId ?? null);
            if (! isset($users[$coachId ?? '']) || ! isset($users[$memberId ?? ''])) {
                $skipped[] = "assignment $id (its coach or member is not an account)";

                continue;
            }
            $ids[$id] = true;
            Assignment::acrossCoaches()->firstOrNew(['id' => $id]) // across coaches: the import writes every coach's offers
                ->forceFill([
                    'coach_id' => $coachId, 'coach_name' => mb_substr((string) ($a->coachName ?? ''), 0, 40), 'member_id' => $memberId,
                    'bundle' => Js::stringify($a->bundle ?? null), 'note' => (string) ($a->note ?? ''),
                    'schedule' => Js::truthy($a->schedule ?? null), 'status' => (string) ($a->status ?? ''),
                    'created' => (string) ($a->created ?? ''), 'decided_at' => self::str($a->decidedAt ?? null),
                ])->save();
            $out['assignments']++;
        }
        $out['removed'] += self::removeAbsent(Assignment::acrossCoaches()->pluck('id')->all(), $ids, // across coaches: the import mirrors every offer
            fn (array $gone) => Assignment::acrossCoaches()->whereKey($gone)->delete()); // across coaches: the import mirrors every offer

        return $out;
    }

    /** `readCoachData(uid).programs`: the list, or nothing for a missing or unreadable file. */
    public static function programsIn(string $file): array
    {
        try {
            $d = is_file($file) ? Input::parse((string) file_get_contents($file)) : null;
        } catch (Throwable) {
            return [];
        }

        return $d instanceof stdClass ? Js::list($d->programs ?? null) : [];
    }

    /**
     * What the Node API answered on each route the coaching tables serve, computed from the files
     * as api/server.js computed it. Keyed by route; each value is the field the app reads.
     *
     * @param  array<string, stdClass>  $users  db.users by id (first row per id)
     * @return array<string, mixed>
     */
    public static function nodeAnswers(stdClass $db, string $dir, stdClass $u, array $users, array $adminUids): array
    {
        $isAdmin = fn (?stdClass $x) => $x !== null && (($x->admin ?? null) === true || in_array($x->id ?? null, $adminUids, true));
        $isCoach = fn (?stdClass $x) => $x !== null && (($x->coach ?? null) === true || $isAdmin($x));
        // domain.mjs canCoachMember
        $canCoach = fn (stdClass $coach, ?stdClass $m) => $m !== null && ($m->id ?? null) !== $coach->id
            && empty($m->disabled) && empty($coach->disabled) && ($isAdmin($coach) || ($m->coachId ?? null) === $coach->id);
        $invites = Js::list($db->invites ?? null);
        $offers = array_values(array_filter(Js::list($db->assignments ?? null), fn ($a) => $a instanceof stdClass && ($a->memberId ?? null) === $u->id));
        $want = [];

        if ($isCoach($u)) {
            $want['GET /api/coach/invites'] = array_values(array_map(fn (stdClass $i) => [
                'code' => $i->code ?? null, 'note' => $i->note ?? null, 'created' => $i->created ?? null,
                'revoked' => Js::truthy($i->revoked ?? null), 'usedAt' => Js::or($i->usedAt ?? null, null),
                'usedByName' => Js::truthy($i->usedBy ?? null) && $canCoach($u, $users[$i->usedBy] ?? null) ? $users[$i->usedBy]->name : null,
            ], array_filter($invites, fn ($i) => $i instanceof stdClass && ($i->coachId ?? null) === $u->id)));
            $safe = preg_replace('/[^a-zA-Z0-9_-]/', '', $u->id);
            $want['GET /api/coach/programs'] = self::programsIn($dir.DIRECTORY_SEPARATOR."coach-$safe.json");
        }
        if ($isAdmin($u)) {
            $want['GET /api/admin/invites'] = array_map(function ($i) use ($users) {
                $row = clone $i;
                unset($row->requestId);   // not ported, reported by the import
                $row->usedByName = Js::truthy($i->usedBy ?? null) ? ($users[$i->usedBy]->name ?? null) : null;

                return $row;
            }, array_values(array_filter($invites, fn ($i) => $i instanceof stdClass)));
        }
        $want['GET /api/assignments'] = array_map(fn (stdClass $a) => [
            'id' => $a->id ?? null, 'coachName' => $a->coachName ?? null, 'note' => $a->note ?? null, 'created' => $a->created ?? null,
            'schedule' => Js::truthy($a->schedule ?? null), 'bundle' => $a->bundle ?? null,
        ], array_values(array_filter($offers, fn ($a) => ($a->status ?? null) === 'pending')));
        $decided = array_values(array_filter($offers, fn ($a) => in_array($a->status ?? null, ['accepted', 'declined'], true)));
        $key = fn (stdClass $a) => Js::string(Js::or($a->decidedAt ?? null, Js::or($a->created ?? null, '')));
        usort($decided, fn ($x, $y) => strcmp($key($y), $key($x)));   // stable, as JS's sort
        $want['GET /api/assignments/history'] = array_map(fn (stdClass $a) => [
            'id' => $a->id ?? null, 'coachName' => $a->coachName ?? null, 'note' => $a->note ?? null,
            'created' => $a->created ?? null, 'decidedAt' => Js::or($a->decidedAt ?? null, null), 'status' => $a->status,
            'name' => Js::or(($a->bundle ?? null) instanceof stdClass ? ($a->bundle->name ?? null) : null, ''),
            'routines' => ($a->bundle ?? null) instanceof stdClass && is_array($a->bundle->routines ?? null) ? count($a->bundle->routines) : 0,
        ], $decided);

        return $want;
    }

    /** The field each route's answer carries the list in. */
    public const FIELD = [
        'GET /api/coach/invites' => 'invites', 'GET /api/coach/programs' => 'programs',
        'GET /api/admin/invites' => 'invites', 'GET /api/assignments' => 'assignments',
        'GET /api/assignments/history' => 'assignments',
    ];

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

    private static function str(mixed $v): ?string
    {
        return is_string($v) && $v !== '' ? $v : null;
    }

    /** Deletes the rows not in $keep (keyed by key), reports nothing itself, returns how many went. */
    private static function removeAbsent(array $present, array $keep, callable $delete): int
    {
        $gone = array_values(array_filter($present, fn ($k) => ! isset($keep[$k])));
        $n = 0;
        foreach (array_chunk($gone, 500) as $chunk) {
            $n += $delete($chunk);
        }

        return $n;
    }
}
