<?php

namespace App\Console\Commands;

use App\Coaching\Digest;
use App\Jobs\SendPush;
use App\Mail\AccountMail;
use App\Mail\SendAfterResponse;
use App\Models\PushSubscription;
use App\Models\User;
use App\Support\Js;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use stdClass;
use Throwable;

/**
 * The coach's morning digest (CHW-339): one email and one push saying what needs them today —
 * requests waiting, check-ins overdue, sessions missed over the last week (App\Coaching\Digest) —
 * and nothing at all on a quiet day.
 *
 * Hourly (routes/console.php): "07:00" is a different UTC hour in each zone, so each run sends to
 * the coaches whose own clock is in the morning window and who have not had today's. The zone is
 * the one their app recorded with their reminder setting (S.reminder.tz), else ZONE. A coach whose
 * morning passes without a run (a deploy's maintenance window across it) gets none that day.
 * users.last_digest, written under the coach's row lock before anything is sent, keeps it to one
 * a day, whatever the counts were: a request arriving at 10:00 has its own push and email.
 *
 * The mail goes from here, synchronously — there is no response to send it after — so a run sends
 * at most BATCH digests and the rest wait for the next hour, still inside their morning.
 */
final class CoachDigest extends Command
{
    /** The zone of a coach whose app has recorded none: the home market's. */
    public const ZONE = 'Africa/Casablanca';

    /** The morning window, on the coach's own clock: from 07:00 to before noon. */
    public const FROM_HOUR = 7;

    public const UNTIL_HOUR = 12;

    public const BATCH = 40;

    protected $signature = 'fitpal:coach-digest';

    protected $description = 'Send each coach the morning digest, when their own clock says morning';

    public function handle(): int
    {
        $now = new DateTimeImmutable('@'.intdiv(Js::nowMs(), 1000));
        $sent = 0;
        foreach ($this->coaches() as $row) {
            if ($sent >= self::BATCH) {
                break;
            }
            $today = self::morningOf($row->reminder, $now);
            if ($today === null || $row->last_digest === $today) {
                continue;
            }
            $coach = $this->claim($row->id, $today);
            if ($coach === null) {
                continue;
            }
            $counts = Digest::forCoach($coach, $today);
            if (array_sum($counts) > 0 && $this->send($coach, $counts)) {
                $sent++;
            }
        }
        $this->info("{$sent} digest(s) sent");

        return self::SUCCESS;
    }

    /**
     * The coach's local date when their clock is in the morning window, else null. $reminder is
     * user_states.reminder (UserState::derived), whose `tz` the app sets from the device.
     */
    public static function morningOf(?string $reminder, DateTimeImmutable $now): ?string
    {
        $r = $reminder === null ? null : json_decode($reminder);
        $tz = $r instanceof stdClass && is_string($r->tz ?? null) && $r->tz !== '' ? $r->tz : self::ZONE;
        try {
            $local = $now->setTimezone(new DateTimeZone($tz));
        } catch (Throwable) {
            $local = $now->setTimezone(new DateTimeZone(self::ZONE));   // not a zone: the default, not a skip
        }
        $hour = (int) $local->format('G');

        return $hour >= self::FROM_HOUR && $hour < self::UNTIL_HOUR ? $local->format('Y-m-d') : null;
    }

    /** Coaches with someone to report on: a client, or a request waiting. The small columns only. */
    private function coaches(): iterable
    {
        return DB::table('users')
            ->leftJoin('user_states', 'user_states.user_id', '=', 'users.id')
            ->where('users.disabled', false)
            ->where(fn ($q) => $q
                ->whereExists(fn ($c) => $c->selectRaw('1')->from('users as clients')->whereColumn('clients.coach_id', 'users.id')->where('clients.disabled', false))
                ->orWhereExists(fn ($r) => $r->selectRaw('1')->from('join_requests')->whereColumn('join_requests.coach_id', 'users.id')->where('join_requests.status', 'pending')))
            ->orderBy('users.id')
            ->select(['users.id', 'users.last_digest', 'user_states.reminder'])
            ->get();
    }

    /** Today's digest is this run's to send: marked under the coach's lock, before anything goes. */
    private function claim(string $id, string $today): ?User
    {
        return DB::transaction(function () use ($id, $today): ?User {
            $coach = User::query()->whereKey($id)->lockForUpdate()->first();
            if ($coach === null || $coach->disabled || $coach->last_digest === $today) {
                return null;
            }
            $coach->forceFill(['last_digest' => $today])->save();

            return $coach;
        });
    }

    /** @param  array{requests: int, checkins: int, missed: int}  $counts */
    private function send(User $coach, array $counts): bool
    {
        $told = false;
        if (PushSubscription::query()->where('user_id', $coach->id)->exists()) {
            SendPush::dispatch($coach->id, 'coach-digest', [$counts]);
            $told = true;
        }
        // Only to an address they proved: the digest names how their business is doing.
        if ($coach->email !== null && $coach->email_verified_at !== null) {
            SendAfterResponse::send($coach->email, new AccountMail('digest', $coach, rtrim((string) config('fitpal.origin'), '/').'/#/today', counts: $counts));
            $told = true;
        }

        return $told;
    }
}
