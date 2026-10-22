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
 * The two reminders, every minute from the scheduler (api/server.js's 10 s loop): the weekly
 * check-in nudge on the member's check-in day, and "workout planned today" — each at the time the
 * member chose, on their own clock, only for members a browser is subscribed for and who turned
 * reminders on.
 *
 * Cron fires every minute but up to ~51 s late (measured, docs/DEPLOY_COACH_SUBDOMAIN.md), so a
 * reminder is due when its time is this minute OR the one before, and not yet sent: the dates in
 * last_reminder / last_checkin_reminder, written under the account's row lock before the push is
 * queued, are what make it never missed and never doubled.
 */
final class Remind extends Command
{
    protected $signature = 'fitpal:remind';

    protected $description = 'Queue the reminder pushes due this minute';

    public function handle(): int
    {
        $now = new DateTimeImmutable('@'.intdiv(Js::nowMs(), 1000));
        $sent = 0;
        // Only S.reminder is read for everyone; a member's whole state only once their minute is due.
        $rows = UserState::query()
            ->join('users', 'users.id', '=', 'user_states.user_id')
            ->where('users.disabled', false)
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('push_subscriptions')->whereColumn('push_subscriptions.user_id', 'user_states.user_id'))
            ->toBase()
            ->selectRaw("user_states.user_id as id, json_extract(user_states.state, '$.reminder') as reminder")
            ->get();
        foreach ($rows as $row) {
            $reminder = is_string($row->reminder) ? json_decode($row->reminder) : null;
            if (! $reminder instanceof stdClass || ! Js::truthy($reminder->on ?? null)) {
                continue;
            }
            $tz = Js::truthy($reminder->tz ?? null) ? Js::string($reminder->tz) : 'UTC';
            $local = self::dueMinute($reminder->time ?? null, $tz, $now);
            if ($local !== null) {
                $sent += $this->remind($row->id, $local);
            }
        }
        $this->info("{$sent} reminder(s) queued");

        return self::SUCCESS;
    }

    /**
     * The member's local minute their reminder time names — now, or a minute ago for a cron run
     * that started late — or null.
     *
     * @return array{date: string, hhmm: string, weekday: int}|null
     */
    public static function dueMinute(mixed $time, string $tz, DateTimeImmutable $now): ?array
    {
        foreach ([$now, $now->modify('-1 minute')] as $instant) {
            $local = Reminders::localNow($tz, $instant);
            if ($local === null) {
                return null;   // not a zone: skipped, not guessed
            }
            if ($time === $local['hhmm']) {
                return $local;
            }
        }

        return null;
    }

    /** @param  array{date: string, hhmm: string, weekday: int}  $local */
    private function remind(string $userId, array $local): int
    {
        $s = MemberCard::state($userId);
        $pushes = DB::transaction(function () use ($userId, $s, $local): array {
            $u = User::query()->whereKey($userId)->lockForUpdate()->first();
            if (! $u || $u->disabled) {
                return [];
            }
            $pushes = [];
            // The check-in nudge first: it is owed whether or not they train today. Compared by
            // PERIOD, not date: one missed minute (a deploy, a DST jump) must not cost the week.
            $period = Reminders::checkinPeriodStart($s, $local['date']);
            if ($u->last_checkin_reminder !== $period && Reminders::checkinReminderDue($s, $local['date'])) {
                $u->forceFill(['last_checkin_reminder' => $period]);
                $pushes[] = ['checkin-reminder', []];
            }
            if ($u->last_reminder !== $local['date']) {
                $trained = collect(Js::list($s->workouts ?? null))->contains(fn ($w) => $w instanceof stdClass && ($w->d ?? null) === $local['date']);
                $rid = $trained ? null : Reminders::effectiveRoutineId($s, $local['date']);
                if ($rid !== null) {
                    $u->forceFill(['last_reminder' => $local['date']]);
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
