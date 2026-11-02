<?php

namespace App\Coaching;

use App\Models\JoinRequest;
use App\Models\User;
use App\Push\Reminders;
use App\Support\Js;
use stdClass;

/**
 * What the coach's morning digest counts (CHW-339, fitpal:coach-digest): requests waiting, clients
 * whose check-in is overdue, and planned sessions missed over the last week. The last two are
 * frontend rules the coach's Today already shows — lib/checkins.js checkinOverdue and
 * lib/adherence.js adherenceOf — ported here because PHP cannot import them. A drift would be
 * silent (the email says two overdue while Today lists one), so tests/Unit/DigestParityTest.php
 * runs this copy against the same cases the frontend runs (frontend/src/lib/digest-parity.json).
 */
final class Digest
{
    /** adherenceOf's window: today, which is pending and never a miss, and the 7 days before it. */
    public const WINDOW_DAYS = 8;

    /**
     * checkinOverdue: owed from the check-in day onward until one is filed for that period, so the
     * digest and the roster's "Check-in overdue" row agree on the day.
     */
    public static function checkinOverdue(?int $checkinDay, ?string $lastCheckin, string $todayIso): bool
    {
        $from = Reminders::checkinPeriodStart((object) ['checkinDay' => $checkinDay], $todayIso);

        return $lastCheckin === null || $lastCheckin === '' || strcmp($lastCheckin, $from) < 0;
    }

    /**
     * adherenceOf(parts, todayIso, days).missed: planned days in the window with no workout, today
     * excluded, the window's near end clamped to the join date (pulled back to the first logged day
     * when imported history predates the account, and never past today).
     *
     * @param  array{week?: mixed, dayPlan?: mixed, routineIds?: list<mixed>, trainedDays?: list<string>, created?: ?string}  $parts  MemberCard::adherenceParts
     */
    public static function missed(array $parts, string $todayIso, int $days = self::WINDOW_DAYS): int
    {
        $trained = [];
        foreach ($parts['trainedDays'] ?? [] as $d) {
            $trained[(string) $d] = true;
        }
        $joined = Js::truthy($parts['created'] ?? null) ? substr((string) $parts['created'], 0, 10) : null;
        $first = null;
        foreach (array_keys($trained) as $d) {
            $first = $first === null || strcmp((string) $d, $first) < 0 ? (string) $d : $first;
        }
        $from = null;
        if ($joined !== null) {
            $from = $first !== null && strcmp($first, $joined) < 0 ? $first : $joined;
            $from = strcmp($from, $todayIso) > 0 ? $todayIso : $from;
        }
        // effectiveRoutineIds over the routines that can be trained: a day holding only a deleted
        // or empty routine is not a day anybody could have trained.
        $plan = new stdClass;
        $plan->week = $parts['week'] ?? new stdClass;
        $plan->dayPlan = $parts['dayPlan'] ?? new stdClass;
        $plan->routines = array_map(fn ($id) => (object) ['id' => $id], $parts['routineIds'] ?? []);

        $missed = 0;
        for ($back = $days - 1; $back >= 1; $back--) {
            $iso = Js::addDaysIso($todayIso, -$back);
            if ($from !== null && strcmp($iso, $from) < 0) {
                continue;
            }
            if (! isset($trained[$iso]) && Reminders::effectiveRoutineId($plan, $iso) !== null) {
                $missed++;
            }
        }

        return $missed;
    }

    /**
     * One coach's counts on their own $todayIso. A client with nothing to train counts for neither
     * (Today's "No program" row is what they need), and a check-in counts only with the client's
     * consent: without it the coach is shown none of their check-ins (CHW-360), so "overdue" would
     * be a guess.
     *
     * @return array{requests: int, checkins: int, missed: int}
     */
    public static function forCoach(User $coach, string $todayIso): array
    {
        $out = [
            'requests' => JoinRequest::pendingFor($coach),
            'checkins' => 0,
            'missed' => 0,
        ];
        foreach (User::clientsOf($coach)->where('disabled', false)->orderBy('id')->get() as $client) {
            $s = MemberCard::state($client->id);
            $trainable = MemberCard::trainable($s);
            if ($trainable === []) {
                continue;
            }
            if (HealthConsent::given($client) && self::checkinOverdue(MemberCard::checkinDay($s->checkinDay ?? null), MemberCard::lastCheckin($s), $todayIso)) {
                $out['checkins']++;
            }
            $out['missed'] += self::missed(MemberCard::adherenceParts($s, $client, $trainable), $todayIso);
        }

        return $out;
    }
}
