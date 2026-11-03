<?php

namespace App\Filament;

use App\Models\AuditEvent;
use App\Models\CoachPage;
use App\Models\CoachPageView;
use App\Models\JoinRequest;
use App\Models\Licence;
use App\Models\User;
use App\Support\Js;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The funnel the Monday review reads (CHW-335, docs/growth/2026-11-funnel-and-promotion.md §2),
 * counted from what the app already keeps: no analytics in the app, no tracker on the page.
 *
 * Each step is read from the table that holds it longest. audit_events is pruned (AUDIT_DAYS,
 * AUDIT_MAX), and unverified join requests go after a day, so the coach funnel stands on rows that
 * stay — the account, the page, the roster, the licence — and only the follower funnel, a window
 * of the last days, reads the log, for the steps nothing else records: a request asked, a code
 * proved, a request accepted. Those events name the coach as their target (JoinController), which
 * a renamed page cannot lose.
 */
final class Funnel
{
    private const DAY = 86_400_000;

    /** A coach's habit, the doc's day-30 stage: this many clients trained in the last week… */
    public const HABIT_CLIENTS = 3;

    /** …read once the coach is this many days in. */
    public const HABIT_DAYS = 30;

    /**
     * The coaches who signed themselves up, by the week they did (UTC, from Monday), newest first,
     * with how far each week's coaches have come. `habitDue` is how many activated coaches are
     * HABIT_DAYS in, the base `habit` is read against; a habit is read today, not on the day.
     *
     * @return array<string, array{week: string, signups: int, page: int, requested: int, client: int, activated: int, habitDue: int, habit: int, paid: int}>
     */
    public static function coaches(int $weeks = 12, ?int $nowMs = null): array
    {
        $now = $nowMs ?? Js::nowMs();
        $monday = CarbonImmutable::createFromTimestampMs($now, 'UTC')->startOfWeek();
        $rows = [];
        for ($i = 0; $i < $weeks; $i++) {
            $week = $monday->subWeeks($i)->format('Y-m-d');
            $rows[$week] = ['week' => $week, 'signups' => 0, 'page' => 0, 'requested' => 0, 'client' => 0, 'activated' => 0, 'habitDue' => 0, 'habit' => 0, 'paid' => 0];
        }
        $coaches = User::query()->where('coach', true)->where('self_serve', true)
            ->where('created_at', '>=', $monday->subWeeks($weeks - 1))->get(['id', 'admin', 'created_at'])
            ->reject(fn (User $u) => $u->isAdmin());
        if ($coaches->isEmpty()) {
            return $rows;
        }
        $ids = $coaches->pluck('id')->all();
        $open = CoachPage::acrossCoaches()->whereKey($ids)->where('open', true)->pluck('coach_id')->flip(); // across coaches: the operator counts every coach
        $requested = self::requestedCoaches()->flip();
        $roster = self::rosters($now - 7 * self::DAY);
        $paid = Licence::query()->where('source', 'creem')->whereNotNull('period_start')->whereIn('user_id', $ids)->distinct()->pluck('user_id')->flip();
        $due = $now - self::HABIT_DAYS * self::DAY;

        foreach ($coaches as $coach) {
            $week = CarbonImmutable::instance($coach->created_at)->setTimezone('UTC')->startOfWeek()->format('Y-m-d');
            if (! isset($rows[$week])) {
                continue;
            }
            $r = &$rows[$week];
            $mine = $roster->get($coach->id);
            $activated = $mine !== null && $mine->active > 0;
            $r['signups']++;
            $r['page'] += (int) $open->has($coach->id);
            $r['requested'] += (int) $requested->has($coach->id);
            $r['client'] += (int) ($mine !== null && $mine->clients > 0);
            $r['activated'] += (int) $activated;
            if ($activated && $coach->created_at->getTimestampMs() <= $due) {
                $r['habitDue']++;
                $r['habit'] += (int) ($mine->weekly >= self::HABIT_CLIENTS);
            }
            $r['paid'] += (int) $paid->has($coach->id);
            unset($r);
        }

        return $rows;
    }

    /**
     * The followers' funnel over the last $days, per coach and for all of them (key `all`, first):
     * page views, requests asked, codes proved, requests accepted (by hand or by the page), and
     * accepted followers who logged a workout — with the median time from asking to that workout,
     * in ms. `auditSince` is the oldest event the log still holds, when it is inside the window:
     * the three middle steps count from there only.
     *
     * @return array{rows: array<string, array{coach: string, views: int, requests: int, verified: int, accepted: int, trained: int, median: ?int}>, auditSince: ?int}
     */
    public static function followers(int $days = 30, ?int $nowMs = null): array
    {
        $now = $nowMs ?? Js::nowMs();
        $since = $now - $days * self::DAY;
        $count = [];
        $add = function (?string $coach, string $step, int $n) use (&$count): void {
            if ($coach !== null) {
                $count[$coach][$step] = ($count[$coach][$step] ?? 0) + $n;
            }
        };

        $views = CoachPageView::acrossCoaches()->where('day', '>=', gmdate('Y-m-d', intdiv($since, 1000))) // across coaches: the operator counts every coach
            ->groupBy('coach_id')->selectRaw('coach_id, SUM(n) AS n')->pluck('n', 'coach_id');
        foreach ($views as $coach => $n) {
            $add($coach, 'views', (int) $n);
        }
        $steps = ['join.request' => 'requests', 'join.verify' => 'verified', 'coach.request.auto' => 'accepted', 'coach.request.accept' => 'accepted'];
        $events = AuditEvent::query()->whereIn('ev', array_keys($steps))->where('ok', true)->where('ts', '>=', $since)
            ->groupBy('ev', 'uid', 'tgt')->selectRaw('ev, uid, tgt, COUNT(*) AS n')->get();
        foreach ($events as $e) {
            // The coach's own accept is theirs (uid); the rest name the coach as the target.
            $add($e->ev === 'coach.request.accept' ? $e->uid : $e->tgt, $steps[$e->ev], (int) $e->n);
        }
        $waits = [];
        foreach (self::firstWorkouts($since) as $w) {
            $add($w->coach_id, 'trained', 1);
            $waits[$w->coach_id][] = $w->wait;
        }

        $names = User::query()->whereKey(array_keys($count))->pluck('name', 'id');
        $handles = CoachPage::acrossCoaches()->whereKey(array_keys($count))->pluck('handle', 'coach_id'); // across coaches: the operator counts every coach
        $row = fn (string $label, array $c, array $w) => [
            'coach' => $label, 'views' => $c['views'] ?? 0, 'requests' => $c['requests'] ?? 0, 'verified' => $c['verified'] ?? 0,
            'accepted' => $c['accepted'] ?? 0, 'trained' => $c['trained'] ?? 0, 'median' => self::median($w),
        ];
        $rows = [];
        foreach ($count as $coach => $c) {
            $label = ($names[$coach] ?? $coach).(isset($handles[$coach]) ? ' · '.$handles[$coach] : '');
            $rows[$coach] = $row($label, $c, $waits[$coach] ?? []);
        }
        uasort($rows, fn ($a, $b) => [$b['views'], $b['requests']] <=> [$a['views'], $a['requests']]);
        $all = [];
        foreach ($count as $c) {
            foreach ($c as $step => $n) {
                $all[$step] = ($all[$step] ?? 0) + $n;
            }
        }
        $oldest = AuditEvent::query()->min('ts');

        return [
            'rows' => ['all' => $row('All coaches', $all, array_merge([], ...array_values($waits)))] + $rows,
            'auditSince' => $oldest !== null && (int) $oldest > $since ? (int) $oldest : null,
        ];
    }

    /**
     * Each follower accepted from a request who then logged a workout in the window: their coach,
     * and how long from asking to that workout. A follower who trained before they asked (an
     * account that had a history) is not counted; one who asked twice counts once, from the ask
     * that came before the workout.
     *
     * @return Collection<int, object{coach_id: string, wait: int}>
     */
    private static function firstWorkouts(int $since): Collection
    {
        return JoinRequest::acrossCoaches() // across coaches: the operator counts every coach
            ->join('user_states', 'user_states.user_id', '=', 'join_requests.member_id')
            ->where('join_requests.status', 'accepted')
            ->where('user_states.first_workout_at', '>=', $since)
            ->whereColumn('user_states.first_workout_at', '>=', 'join_requests.created')
            ->orderByDesc('join_requests.created')
            ->get(['join_requests.coach_id', 'join_requests.member_id', 'join_requests.created', 'user_states.first_workout_at'])
            ->unique('member_id')
            ->map(fn ($r) => (object) ['coach_id' => $r->coach_id, 'wait' => (int) $r->first_workout_at - (int) $r->created])
            ->values();
    }

    /**
     * The coaches any follower asked to join: a request still kept, or one the log remembers.
     *
     * @return Collection<int, string>
     */
    private static function requestedCoaches(): Collection
    {
        return JoinRequest::acrossCoaches()->select('coach_id')->distinct()->pluck('coach_id') // across coaches: the operator counts every coach
            ->merge(AuditEvent::query()->where('ev', 'join.request')->whereNotNull('tgt')->distinct()->pluck('tgt'))
            ->unique()->values();
    }

    /**
     * Every coach's clients (enabled, not admins): how many, how many have logged a workout, and
     * how many logged one on or after $weekAgo — grouped in SQL, as a coach's states can be large.
     *
     * @return Collection<string, object{clients: int, active: int, weekly: int}>
     */
    private static function rosters(int $weekAgo): Collection
    {
        return DB::table('users')
            ->leftJoin('user_states', 'user_states.user_id', '=', 'users.id')
            ->where('users.disabled', false)->where('users.admin', false)
            ->groupBy('users.coach_id')
            ->selectRaw('users.coach_id AS coach, COUNT(*) AS clients,'
                .' SUM(CASE WHEN user_states.first_workout_at IS NOT NULL THEN 1 ELSE 0 END) AS active,'
                .' SUM(CASE WHEN user_states.last_workout >= ? THEN 1 ELSE 0 END) AS weekly', [gmdate('Y-m-d', intdiv($weekAgo, 1000))])
            ->get()
            ->filter(fn ($r) => $r->coach !== null)
            ->mapWithKeys(fn ($r) => [$r->coach => (object) ['clients' => (int) $r->clients, 'active' => (int) $r->active, 'weekly' => (int) $r->weekly]]);
    }

    /** @param list<int> $values */
    private static function median(array $values): ?int
    {
        if ($values === []) {
            return null;
        }
        sort($values);
        $mid = intdiv(count($values), 2);

        return count($values) % 2 ? $values[$mid] : intdiv($values[$mid - 1] + $values[$mid], 2);
    }
}
