<?php

namespace App\Coaching;

use App\Models\Assignment;
use App\Models\ProgressPhoto;
use App\Models\User;
use App\Models\UserState;
use App\Support\Js;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * What a coach sees of a client, read out of the client's own state blob exactly as the Node API
 * did (api/server.js memberCard, adherenceParts and GET /api/coach/member). The server never
 * writes into a client's state — their next whole-state push would erase it — so everything here
 * is a read, and the payload is a hand-written allow-list: a coach has no business with someone's
 * reminders or device settings, and widening it to the whole blob would hand them over.
 */
final class MemberCard
{
    /**
     * At least frontend/src/lib/adherence.js ADHERENCE_WINDOW_DAYS + 1 (the last test in
     * tests/Feature/CoachRosterTest.php holds the two together). The client windows on the browser's local date and this runs on UTC, which
     * differ by up to a day either way: trimming to exactly the window would silently drop the
     * oldest day for any coach west of UTC between UTC midnight and their own.
     */
    public const ADHERENCE_SEND_DAYS = 30;

    /** The client's state, `readState(id) || {}`. Objects stay objects: `{}` must go back out as `{}`. */
    public static function state(string $uid): stdClass
    {
        $raw = UserState::query()->whereKey($uid)->value('state');
        $state = is_string($raw) ? json_decode($raw) : null;

        return $state instanceof stdClass ? $state : new stdClass;
    }

    /**
     * The client's `S.lang`, read out of their state without loading it: a push needs two letters,
     * and a state can be megabytes of workouts. Null when there is none (or it is not text).
     */
    public static function lang(string $uid): ?string
    {
        $path = DB::getDriverName() === 'sqlite' ? "json_extract(state, '$.lang')" : "JSON_VALUE(state, '$.lang')";
        $lang = UserState::query()->whereKey($uid)->toBase()->selectRaw($path.' as lang')->first()?->lang;

        return is_string($lang) ? $lang : null;
    }

    /**
     * One row of the roster. $viewerId is the coach whose offers the card shows; null shows every
     * coach's, as Node's memberCard(u) without a viewer did for the admin's account list (R2).
     *
     * @param  Collection<int, Assignment>  $offers  every coach's assignments for this member, oldest first
     */
    public static function card(User $u, ?string $viewerId, Collection $offers, ?stdClass $live = null): array
    {
        $s = self::state($u->id);
        $trainable = self::trainable($s);
        // Sending used to be a black hole: a decline looked exactly like "hasn't opened the app".
        // Node sorted String(decidedAt) descending, so a row with no date ("undefined") came
        // before every dated one; the same here. Every Node path that decides writes a date, so
        // only hand-edited data has such a row.
        $key = fn (Assignment $a) => $a->decided_at ?? 'undefined';
        $lastDecided = $offers->filter(fn (Assignment $a) => $a->status === 'accepted' || $a->status === 'declined')
            ->sort(fn (Assignment $a, Assignment $b) => strcmp($key($b), $key($a)))
            ->first();

        $card = [
            'id' => $u->id, 'name' => $u->name, 'created' => $u->createdIso(), 'disabled' => (bool) $u->disabled,
        ] + self::activity($s, $live) + [
            // Only the viewer's own offers: withdraw is theirs to press, and another coach's
            // pending program is not their business to see or cancel.
            'pending' => $offers->filter(fn (Assignment $a) => $a->status === 'pending' && ($viewerId === null || $a->coach_id === $viewerId))
                ->map(fn (Assignment $a) => ['id' => $a->id, 'created' => $a->created, 'coachId' => $a->coach_id])
                ->values()->all(),
            'lastDecision' => $lastDecided
                // `at` absent rather than null with no date, as JSON.stringify drops undefined.
                ? ['status' => $lastDecided->status] + ($lastDecided->decided_at === null ? [] : ['at' => $lastDecided->decided_at])
                : null,
            'adherence' => self::adherenceParts($s, $u, $trainable),
            'lastCheckin' => self::lastCheckin($s),
            'checkinDay' => self::checkinDay($s->checkinDay ?? null),
            'routines' => count($trainable),
        ];

        return $card;
    }

    /**
     * The activity fields every account list shows — the coach's roster and the admin's — read
     * from the state the same way in both.
     */
    public static function activity(stdClass $s, ?stdClass $live): array
    {
        $workouts = Js::list($s->workouts ?? null);

        return ['workouts' => count($workouts)] + self::lastWorkout($workouts) + [
            'lastSync' => Js::or($s->_ts ?? null, null),
            // The presence object while they train (Presence::liveMap, loaded once per list);
            // null otherwise, as Node.
            'live' => $live,
        ];
    }

    /**
     * What both drill-downs into one account open with — the coach's (GET /api/coach/member) and
     * the admin's (GET /api/admin/user) — read from the state the same way in both.
     */
    public static function drillDown(stdClass $s): array
    {
        return [
            'unit' => Js::or($s->unit ?? null, 'kg'),
            'lastSync' => Js::or($s->_ts ?? null, null),
            'routines' => self::routineSummaries($s),
            'bodyweight' => Js::or($s->bodyweight ?? null, []),
        ];
    }

    /**
     * `lastWorkout: last ? last.d : null`, as a field to splice in: a last workout without a `d`
     * gave undefined, which JSON.stringify leaves out — no key at all.
     *
     * @param  list<mixed>  $workouts
     */
    public static function lastWorkout(array $workouts): array
    {
        $last = $workouts === [] ? null : $workouts[array_key_last($workouts)];
        if (! Js::truthy($last)) {
            return ['lastWorkout' => null];
        }

        return is_object($last) && property_exists($last, 'd') ? ['lastWorkout' => $last->d] : [];
    }

    /**
     * `(S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length }))`:
     * an absent field is absent from the JSON, a null one is null.
     *
     * @return list<array<string, mixed>>
     */
    public static function routineSummaries(stdClass $s): array
    {
        $routines = [];
        foreach (Js::list($s->routines ?? null) as $r) {
            $row = [];
            foreach (['id', 'name', 'emoji'] as $k) {
                if (is_object($r) && property_exists($r, $k)) {
                    $row[$k] = $r->{$k};
                }
            }
            $row['count'] = count(Js::list(is_object($r) ? ($r->ex ?? null) : null));
            $routines[] = $row;
        }

        return $routines;
    }

    /**
     * What frontend/src/lib/adherence.js scores, trimmed to the window: `dayPlan` holds every date
     * a member ever rescheduled, and nothing outside the window can change the answer.
     */
    public static function adherenceParts(stdClass $s, User $u, array $trainable): array
    {
        $since = Js::addDaysIso(gmdate('Y-m-d'), -(self::ADHERENCE_SEND_DAYS - 1));
        $dayPlan = new stdClass;
        if (($s->dayPlan ?? null) instanceof stdClass) {
            foreach (get_object_vars($s->dayPlan) as $iso => $v) {
                if (strcmp((string) $iso, $since) >= 0) {
                    $dayPlan->{$iso} = $v;
                }
            }
        }
        $trained = [];
        foreach (Js::list($s->workouts ?? null) as $w) {
            $d = is_object($w) ? ($w->d ?? null) : null;
            if (is_string($d) && $d !== '' && strcmp($d, $since) >= 0) {
                $trained[] = $d;
            }
        }

        return [
            'week' => Js::or($s->week ?? null, new stdClass),
            'dayPlan' => $dayPlan,
            // Only routines that can be trained: an empty one is skipped by nextTrainingDay and
            // refused by the start button, so a day holding nothing else was not a day to miss.
            'routineIds' => array_map(fn ($r) => $r->id ?? null, $trainable),
            'trainedDays' => array_values(array_unique($trained)),
            // Clamps the near end of the window: nobody misses sessions from before they joined.
            'created' => $u->createdIso(),
        ];
    }

    /** GET /api/coach/member: one client, everything <StatsPanels> and the client page read. */
    public static function detail(User $u): array
    {
        $s = self::state($u->id);

        return [
            'user' => ['id' => $u->id, 'name' => $u->name, 'created' => $u->createdIso()],
        ] + self::drillDown($s) + [
            'measurements' => Js::or($s->measurements ?? null, []),
            // Authored by the client and read-only here: the server never writes their state.
            'checkins' => Js::or($s->checkins ?? null, []),
            'checkinDay' => $s->checkinDay ?? null,
            'meals' => Js::or($s->meals ?? null, []),
            'mealDays' => ($s->mealDays ?? null) instanceof stdClass ? $s->mealDays : new stdClass,
            'nutriTarget' => $s->nutriTarget ?? null,
            // Server-owned, metadata only: the bytes are GET /api/media/photo's, behind its own check.
            'photos' => ProgressPhoto::listed($u->id),
            'workouts' => array_reverse(Js::list($s->workouts ?? null)),
            'body' => Js::or($s->body ?? null, 'male'),
            'targetW' => $s->targetW ?? null,
            'effort' => $s->effort ?? null,
            'showRir' => $s->showRir ?? null,   // legacy field effortOf() still falls back to
            // Untrimmed: this is one member, and the coach should see the whole plan.
            'week' => Js::or($s->week ?? null, new stdClass),
            'dayPlan' => Js::or($s->dayPlan ?? null, new stdClass),
        ];
    }

    /** @return list<mixed> routines with at least one exercise */
    private static function trainable(stdClass $s): array
    {
        return array_values(array_filter(Js::list($s->routines ?? null),
            fn ($r) => is_object($r) && count(Js::list($r->ex ?? null)) > 0));
    }

    /** The newest check-in date filed, not the last entry: order is not an invariant to lean on. */
    private static function lastCheckin(stdClass $s): ?string
    {
        $max = '';
        foreach (Js::list($s->checkins ?? null) as $c) {
            $d = is_object($c) ? ($c->d ?? null) : null;
            if (is_string($d) && strcmp($d, $max) > 0) {
                $max = $d;
            }
        }

        return $max === '' ? null : $max;
    }

    /** `Number.isInteger(d) && 0 <= d <= 6`: 3.0 counts (JSON has one number type), '3' does not. */
    public static function checkinDay(mixed $d): ?int
    {
        if ((is_int($d) || (is_float($d) && floor($d) === $d)) && $d >= 0 && $d <= 6) {
            return (int) $d;
        }

        return null;
    }
}
