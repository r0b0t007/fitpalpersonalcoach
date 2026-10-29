<?php

namespace App\Console\Commands;

use App\Coaching\MemberCard;
use App\Jobs\SendPush;
use App\Models\User;
use App\Models\UserState;
use App\Push\Reminders;
use App\Support\Js;
use DateTimeImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * The two reminders, on every scheduler run (api/server.js's 10 s loop): "workout planned today"
 * and the weekly check-in nudge, each at the time the member chose, on their own clock, for members
 * a browser is subscribed for who turned reminders on.
 *
 * The host runs cron every 5 minutes, not every minute, and each run starts up to ~51 s late
 * (docs/DEPLOY_COACH_SUBDOMAIN.md, CHW-311). So the day reminder is due when its time is any of
 * the last LOOKBACK_MINUTES minutes: two runs' worth, so a skipped run (a deploy's maintenance
 * window) still loses nothing. It arrives up to about 5 minutes late. The check-in nudge is owed
 * for the whole check-in day from its time on, until sent: a missed run (a deploy, a DST jump
 * over 02:30) costs it a few minutes, not the week — Node's exact-minute match lost the week.
 * last_reminder / last_checkin_reminder, written under the account's row lock before the push is
 * queued, are what make each never doubled.
 *
 * Read on every run for everyone: only the small reminder columns (UserState::derived). A
 * member's whole state only once something of theirs is due.
 */
final class Remind extends Command
{
    /** Two 5-minute cron ticks: the minutes since the run before last. */
    public const LOOKBACK_MINUTES = 10;

    protected $signature = 'fitpal:remind';

    protected $description = 'Queue the reminder pushes due since the last runs';

    public function handle(): int
    {
        $now = new DateTimeImmutable('@'.intdiv(Js::nowMs(), 1000));
        $sent = 0;
        $rows = UserState::query()
            ->join('users', 'users.id', '=', 'user_states.user_id')
            ->where('users.disabled', false)
            ->whereNotNull('user_states.reminder')
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('push_subscriptions')->whereColumn('push_subscriptions.user_id', 'user_states.user_id'))
            ->toBase()
            ->select(['user_states.user_id as id', 'user_states.reminder', 'user_states.checkin_day', 'users.last_checkin_reminder'])
            ->get();
        foreach ($rows as $row) {
            $reminder = json_decode((string) $row->reminder);
            if (! $reminder instanceof stdClass || ! Js::truthy($reminder->on ?? null)) {
                continue;
            }
            $tz = Js::truthy($reminder->tz ?? null) ? Js::string($reminder->tz) : 'UTC';
            $minutes = Reminders::localMinutes($tz, $now, self::LOOKBACK_MINUTES);
            if ($minutes === null) {
                continue;   // not a zone: skipped, not guessed
            }
            $time = $reminder->time ?? null;
            $day = self::dueMinute($time, $minutes);
            $checkin = self::checkinOwed($time, $minutes, $row->checkin_day ?? Reminders::DEFAULT_CHECKIN_DAY, $row->last_checkin_reminder);
            if ($day !== null || $checkin !== null) {
                $sent += $this->remind($row->id, $day, $checkin);
            }
        }
        $this->info("{$sent} reminder(s) queued");

        return self::SUCCESS;
    }

    /**
     * The member's local minute their reminder time names, if it is one of $minutes (the last
     * LOOKBACK_MINUTES, Reminders::localMinutes), or null. Its date is the minute's own: a time
     * just before midnight is sent on the first run after it, naming that evening's routine.
     *
     * @param  list<array{date: string, hhmm: string}>  $minutes
     * @return array{date: string, hhmm: string}|null
     */
    public static function dueMinute(mixed $time, array $minutes): ?array
    {
        foreach ($minutes as $local) {
            if ($time === $local['hhmm']) {
                return $local;
            }
        }

        return null;
    }

    /**
     * The member's check-in day when the check-in nudge may be owed: one of $minutes falls on it at
     * or past their time, and this period is not yet handled. Read over the whole look-back, not
     * only now: a time in a check-in day's last minutes comes after its last run, and the next run
     * is already on the next day. Whether one is actually owed (no check-in yet this period) needs
     * the state; that is remind()'s to read.
     *
     * @param  list<array{date: string, hhmm: string}>  $minutes
     * @return array{date: string, hhmm: string}|null
     */
    public static function checkinOwed(mixed $time, array $minutes, int $checkinDay, ?string $handled): ?array
    {
        if (! is_string($time) || ! preg_match('/^\d\d:\d\d$/D', $time)) {
            return null;
        }
        $weekday = [];
        foreach ($minutes as $local) {
            if (strcmp($local['hhmm'], $time) >= 0 && ($weekday[$local['date']] ??= Reminders::weekday($local['date'])) === $checkinDay) {
                return $handled === $local['date'] ? null : $local;   // the period starts on the check-in day itself
            }
        }

        return null;
    }

    /**
     * @param  array{date: string, hhmm: string}|null  $day  the day reminder's minute, if due
     * @param  array{date: string, hhmm: string}|null  $checkin  today, if the check-in nudge may be owed
     */
    private function remind(string $userId, ?array $day, ?array $checkin): int
    {
        $s = MemberCard::state($userId);
        $pushes = DB::transaction(function () use ($userId, $s, $day, $checkin): array {
            $u = User::query()->whereKey($userId)->lockForUpdate()->first();
            if (! $u || $u->disabled) {
                return [];
            }
            $pushes = [];
            // The check-in nudge first: it is owed whether or not they train today.
            if ($checkin !== null) {
                $period = Reminders::checkinPeriodStart($s, $checkin['date']);
                if ($u->last_checkin_reminder !== $period) {
                    // Handled for this period either way: nudged now, or already checked in — so
                    // the rest of the day does not read their state again on each run.
                    $u->forceFill(['last_checkin_reminder' => $period]);
                    if (Reminders::checkinReminderDue($s, $checkin['date'])) {
                        $pushes[] = ['checkin-reminder', []];
                    }
                }
            }
            if ($day !== null && $u->last_reminder !== $day['date']) {
                $trained = collect(Js::list($s->workouts ?? null))->contains(fn ($w) => $w instanceof stdClass && ($w->d ?? null) === $day['date']);
                $rid = $trained ? null : Reminders::effectiveRoutineId($s, $day['date']);
                if ($rid !== null) {
                    $u->forceFill(['last_reminder' => $day['date']]);
                    $pushes[] = ['day-reminder', [Reminders::routine(Js::list($s->routines ?? null), $rid)]];
                }
            }
            $u->save();

            return $pushes;
        });
        foreach ($pushes as [$kind, $args]) {
            SendPush::dispatch($userId, $kind, $args);
        }

        return count($pushes);
    }
}
