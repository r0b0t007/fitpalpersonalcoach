<?php

namespace App\Push;

use App\Coaching\MemberCard;
use App\Support\Js;
use DateTimeImmutable;
use DateTimeZone;
use stdClass;
use Throwable;

/**
 * The rules behind the two reminders, ported from api/server.js (effectiveRoutineId, userNow) and
 * api/domain.mjs (checkinDayOf, checkinPeriodStart, checkinReminderDue), which mirror
 * frontend/src/lib/history.js and checkins.js. If a rule changes there, change it here: a drift is
 * silent, because a reminder on the wrong day looks exactly like one nobody set.
 */
final class Reminders
{
    /** DEFAULT_CHECKIN_DAY: Sunday, the day people review a week (0 = Sunday, as getDay()). */
    public const DEFAULT_CHECKIN_DAY = 0;

    /**
     * `userNow(tz)` at $instant: the date and hh:mm on the member's own clock, or null for a zone
     * that is not one (that member is skipped rather than guessed for).
     *
     * @return array{date: string, hhmm: string}|null
     */
    public static function localNow(string $tz, DateTimeImmutable $instant): ?array
    {
        try {
            $local = $instant->setTimezone(new DateTimeZone($tz));
        } catch (Throwable) {
            return null;
        }

        return ['date' => $local->format('Y-m-d'), 'hhmm' => $local->format('H:i')];
    }

    /** Weekday of an ISO date, read at midday UTC so no zone moves it (`new Date(iso+'T12:00:00Z')`). */
    public static function weekday(string $iso): int
    {
        return (int) (new DateTimeImmutable($iso.'T12:00:00Z'))->format('w');
    }

    /**
     * The routine planned for a date, or null on a rest day: a day's own plan first ('rest' is a
     * rest day), else the weekday's — which may list several routines; the first that exists. The
     * id as the state holds it (a number stays a number, to find its routine by `===`).
     */
    public static function effectiveRoutineId(stdClass $s, string $iso): mixed
    {
        $routines = Js::list($s->routines ?? null);
        $exists = fn (mixed $id) => self::routine($routines, $id) !== null;
        $dayPlan = $s->dayPlan ?? null;
        $ov = $dayPlan instanceof stdClass ? ($dayPlan->{$iso} ?? null) : null;
        if ($ov === 'rest') {
            return null;
        }
        if (Js::truthy($ov) && $exists($ov)) {
            return $ov;
        }
        $week = $s->week ?? null;
        $wd = self::weekday($iso);
        $day = $week instanceof stdClass ? ($week->{$wd} ?? null) : (is_array($week) ? ($week[$wd] ?? null) : null);
        // `[].concat(week[wd] || [])`: a list, or one id.
        foreach (is_array($day) ? $day : (Js::truthy($day) ? [$day] : []) as $id) {
            if ($exists($id)) {
                return $id;
            }
        }

        return null;
    }

    /** `S.routines.find(r => r.id === id)`. */
    public static function routine(array $routines, mixed $id): ?stdClass
    {
        foreach ($routines as $r) {
            if ($r instanceof stdClass && property_exists($r, 'id') && $r->id === $id) {
                return $r;
            }
        }

        return null;
    }

    /** The member's check-in weekday (MemberCard::checkinDay, the roster's rule), else Sunday. */
    public static function checkinDayOf(stdClass $s): int
    {
        return MemberCard::checkinDay($s->checkinDay ?? null) ?? self::DEFAULT_CHECKIN_DAY;
    }

    /** The latest check-in weekday on or before $todayIso: the start of the week a check-in belongs to. */
    public static function checkinPeriodStart(stdClass $s, string $todayIso): string
    {
        $back = (self::weekday($todayIso) - self::checkinDayOf($s) + 7) % 7;

        return (new DateTimeImmutable($todayIso.'T12:00:00Z'))->modify("-{$back} days")->format('Y-m-d');
    }

    /** On the check-in day only, and only while this period has no check-in yet. */
    public static function checkinReminderDue(stdClass $s, string $todayIso): bool
    {
        if (self::weekday($todayIso) !== self::checkinDayOf($s)) {
            return false;
        }
        $from = self::checkinPeriodStart($s, $todayIso);
        foreach (Js::list($s->checkins ?? null) as $c) {
            // `c && c.d >= from`: dates compare as text.
            if ($c instanceof stdClass && is_string($c->d ?? null) && strcmp($c->d, $from) >= 0) {
                return false;
            }
        }

        return true;
    }
}
