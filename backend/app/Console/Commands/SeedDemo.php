<?php

namespace App\Console\Commands;

use App\Domain\Entitlement;
use App\Models\Assignment;
use App\Models\User;
use App\Models\UserState;
use App\Support\Js;
use Carbon\Carbon;
use DateTimeZone;
use Exception;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * A coach's roster, filled with demo clients so the coach screens can be looked at, filmed and
 * screenshotted with data in them (docs/VIDEO_CAPTURE.md). The port of the Node API's
 * api/seed-demo.mjs (`git show 5d0c52f4:api/seed-demo.mjs`), writing through the models instead
 * of db.json — so, unlike there, nothing needs a restart afterwards.
 *
 * The rules it keeps, because it writes to a live database:
 *
 *  1. It only ever ADDS: no row it did not create is edited or removed.
 *  2. Every account it creates has an id starting with DEMO_PREFIX, and is shorter than the 16
 *     characters every minted id has — so --remove is exact, never a guess at what looked fake,
 *     and cannot reach a real account whose random id happens to start the same way.
 *  3. The demo clients have no passkey, no email and no password: nobody can sign in as one.
 *     They exist to be looked at from the coach side and nothing else.
 *
 * On writing a client's state: the API never does that (S belongs to the client, and a coach
 * reaches it only through an assignment the client accepts), because a server write would race a
 * real device and lose somebody's training. These clients have no device to race, and seeding the
 * state is the only way to give one a history at all — which is why this is a command, not a
 * route.
 *
 * The clients take seats: on an instance with billing, they count against the coach's licence
 * like any other client (an admin has no cap).
 */
final class SeedDemo extends Command
{
    protected $signature = 'fitpal:seed-demo
        {--coach= : The coach (or admin) to give the demo clients to; needed when there is more than one}
        {--remove : Take every demo client, their state and their assignments back out}
        {--list : Show what is seeded, and change nothing}
        {--tz= : The timezone whose calendar the dates are written in: the coach\'s (default: the app\'s)}
        {--force : Required to seed or remove on a production instance}';

    protected $description = 'Add six demo clients, with histories, to a coach\'s roster (or --remove them, or --list them)';

    public const DEMO_PREFIX = 'demo-';

    private const DAY = 86_400_000;

    /** Real ids from lib/exercises-data.js. */
    private const EX = [
        'bench' => '0025', 'squat' => '0043', 'deadlift' => '0032', 'pullup' => '0652', 'row' => '0027',
        'dbBench' => '0289', 'curl' => '0294', 'rdl' => '0085', 'pulldown' => '2330', 'legPress' => '2287',
    ];

    public function handle(): int
    {
        // One action per run: `--remove --list` doing only one of the two, silently, would leave
        // demo clients on a roster whoever typed it thought were gone.
        $seedOnly = $this->option('coach') !== null || $this->option('tz') !== null;
        if (($this->option('list') && $this->option('remove')) || (($this->option('list') || $this->option('remove')) && $seedOnly)) {
            $this->error('one of: a seed (with --coach and --tz), --remove, or --list');

            return self::FAILURE;
        }
        if ($this->option('list')) {
            return $this->list();
        }
        if (app()->isProduction() && ! $this->option('force')) {
            $this->error('this is a production instance: the demo clients would sit on a real roster, among real clients. Say so with --force.');

            return self::FAILURE;
        }

        return $this->option('remove') ? $this->remove() : $this->seed();
    }

    /**
     * The demo accounts: the prefix, and shorter than a minted id (rule 2 above). Compared with `=`,
     * not LIKE: SQLite's LIKE ignores case, and `Demo-…` is not ours.
     */
    public static function demoUsers(): Builder
    {
        return User::query()->whereRaw('substr(id, 1, ?) = ?', [strlen(self::DEMO_PREFIX), self::DEMO_PREFIX])->whereRaw('length(id) < 16');
    }

    private function list(): int
    {
        $users = self::demoUsers()->orderBy('id')->get();
        if ($users->isEmpty()) {
            $this->line('Nothing seeded: no account with the '.self::DEMO_PREFIX.' prefix.');

            return self::SUCCESS;
        }
        $this->line("{$users->count()} demo client(s):");
        $states = UserState::query()->whereIn('user_id', $users->modelKeys())->pluck('state', 'user_id');
        foreach ($users as $u) {
            $s = json_decode((string) ($states[$u->id] ?? '{}'));
            $this->line(sprintf('  %-16s %-22s %3d workouts, %2d check-ins, coach=%s', $u->id, $u->name,
                count((array) ($s->workouts ?? [])), count((array) ($s->checkins ?? [])), $u->coach_id ?? '-'));
        }
        $statuses = Assignment::acrossCoaches()->whereIn('member_id', $users->modelKeys())->orderBy('created')->pluck('status'); // across coaches: whoever sent them, they are the demo clients' offers
        $this->line("  {$statuses->count()} assignment(s): ".($statuses->implode(', ') ?: 'none'));

        return self::SUCCESS;
    }

    private function remove(): int
    {
        $ids = self::demoUsers()->pluck('id')->all();
        if ($ids === []) {
            $this->line('Nothing to remove.');

            return self::SUCCESS;
        }
        [$offers, $states] = DB::transaction(fn () => [
            // Every offer to a demo client, the seeded ones and any a coach has sent since: the
            // assignments table restricts deleting a member who has rows.
            Assignment::acrossCoaches()->whereIn('member_id', $ids)->delete(), // across coaches: whoever sent them, they are the demo clients' offers
            UserState::query()->whereIn('user_id', $ids)->delete(),
            // Presence, push, photos and licences follow by cascade; a demo client has none.
            User::query()->whereKey($ids)->delete(),
        ]);
        $this->info(count($ids)." demo client(s) removed, with {$states} state(s) and {$offers} assignment(s).");

        return self::SUCCESS;
    }

    private function seed(): int
    {
        if (($n = self::demoUsers()->count()) > 0) {
            $this->error("already seeded: {$n} demo client(s). Run --remove first, or --list to see them.");

            return self::FAILURE;
        }
        $tz = (string) ($this->option('tz') ?: config('app.timezone'));
        try {
            new DateTimeZone($tz);   // what Carbon takes: Etc/UTC and the old aliases too
        } catch (Exception) {
            $this->error("--tz takes a timezone name, like Africa/Casablanca; {$tz} is not one");

            return self::FAILURE;
        }
        $coach = $this->coach();
        if ($coach === null) {
            return self::FAILURE;
        }
        // The demo clients take seats like any client. Past a paying coach's cap they would refuse
        // the coach's real invites (402) until someone ran --remove; an admin, or an instance with
        // billing off, has no cap.
        $seats = Entitlement::for($coach);
        $people = count(self::people());
        if ($seats->cap !== null && $seats->used + $people > $seats->cap) {
            $this->error("{$coach->name} has {$seats->used} of {$seats->cap} client seat(s) taken: {$people} demo clients would take them past the plan's cap. Seed onto an admin, or a coach with room.");

            return self::FAILURE;
        }

        $now = Js::nowMs();
        $workouts = $checkins = 0;
        $today = Carbon::createFromTimestampMs($now, $tz)->startOfDay();
        DB::transaction(function () use ($coach, $now, $today, &$workouts, &$checkins): void {
            foreach (self::people() as $p) {
                $id = self::DEMO_PREFIX.$p['key'];
                $s = self::state($p, $now, $today);
                $workouts += count($s->workouts);
                $checkins += count($s->checkins);
                // forceFill: coach_id is not mass-assignable, as everywhere a request could reach.
                // Joined at the start of their first day, so no session that day predates the account
                // (the roster sends `created`, and adherence clamps its window to it).
                // Made-up clients who have consented (CHW-360): their check-ins and photos are what the demo
                // shows a coach.
                (new User)->forceFill(['id' => $id, 'name' => $p['name'], 'coach_id' => $coach->id,
                    'created_at' => $today->copy()->subDays($p['joined']), 'health_consent_at' => Js::nowMs()])->save();
                UserState::query()->create(['user_id' => $id, 'state' => Js::stringify($s), 'ts' => $s->_ts]);

                // An accepted assignment is what gives the client page a "Current program".
                $bundle = fn (string $name) => Js::stringify((object) ['name' => $name, 'routines' => $s->routines, 'week' => $s->week]);
                $offer = fn (array $row) => (new Assignment)->forceFill($row + ['id' => Js::randomId(), 'coach_id' => $coach->id,
                    'coach_name' => $coach->name, 'member_id' => $id, 'schedule' => true])->save();
                if (isset($p['program'])) {
                    $offer(['bundle' => $bundle($p['program']), 'note' => 'Start light and add a little each week.', 'status' => 'accepted',
                        'created' => self::iso($now - $p['accepted'] * self::DAY), 'decided_at' => self::iso($now - ($p['accepted'] - 1) * self::DAY)]);
                }
                if (isset($p['pending'])) {
                    $offer(['bundle' => $bundle($p['pending']), 'note' => 'Moving you to four days — see what you think.', 'status' => 'pending',
                        'created' => self::iso($now - $p['pendingDays'] * self::DAY)]);
                }
                $this->line(sprintf('  %-16s %-22s %3d workouts  %2d check-ins   %s', $id, $p['name'], count($s->workouts), count($s->checkins), $p['note']));
            }
        });
        $this->info(sprintf('Seeded %d clients onto %s (%s): %d workouts, %d check-ins, dated in %s.',
            $people, $coach->name, $coach->id, $workouts, $checkins, $tz));
        $this->line('None of them can sign in. To undo: php artisan fitpal:seed-demo --remove');

        return self::SUCCESS;
    }

    /** The coach named by --coach, or the only coach there is; null (said why) otherwise. */
    private function coach(): ?User
    {
        $wanted = $this->option('coach');
        if ($wanted !== null) {
            $coach = User::query()->find((string) $wanted);
            if ($coach === null || ! $coach->isCoach() || $coach->disabled) {
                $this->error("no coach with id {$wanted}");

                return null;
            }

            return $coach;
        }
        // isCoach() as a query: the coach and admin flags, and the admins named in ADMIN_UIDS.
        $coaches = User::query()->where('disabled', false)
            ->where(fn (Builder $q) => $q->where('coach', true)->orWhere('admin', true)->orWhereIn('id', config('fitpal.admin_uids', [])))
            ->signupOrder()->get();
        if ($coaches->count() === 1) {
            return $coaches->first();
        }
        $this->error($coaches->isEmpty() ? 'there is no coach on this instance to give the demo clients to'
            : 'more than one coach: say which with --coach');
        foreach ($coaches as $c) {
            $this->line("  --coach {$c->id}   ({$c->name}".($c->isAdmin() ? ', admin' : '').')');
        }

        return null;
    }

    /**
     * The roster. Each persona is built to light up a different part of the coach's Today screen,
     * so the "needs attention" list and the adherence bars have something real to disagree about.
     * `trains` are weekdays, Monday = 1; the day counts are back from today.
     */
    private static function people(): array
    {
        return [
            ['key' => 'nadia', 'name' => 'Nadia El Amrani', 'joined' => 96, 'plan' => 'ppl', 'trains' => [1, 3, 5], 'miss' => 0.08,
                'bw' => [71.5, 68.2], 'checkinWeeks' => 12, 'checkinBase' => 4.2, 'program' => 'Push / Pull / Legs', 'accepted' => 92,
                'note' => 'Consistent, progressing, nothing to fix: a client doing fine.'],
            ['key' => 'karim', 'name' => 'Karim Benali', 'joined' => 141, 'plan' => 'upper-lower', 'trains' => [1, 2, 4, 5], 'miss' => 0.05,
                'bw' => [78.0, 83.4], 'checkinWeeks' => 18, 'checkinBase' => 4.5, 'program' => 'Upper / Lower', 'accepted' => 137,
                'note' => 'Four days a week, gaining, the longest history on the roster.'],
            ['key' => 'sara', 'name' => 'Sara Mansouri', 'joined' => 26, 'plan' => 'full-body', 'trains' => [1, 3, 5], 'miss' => 0.22,
                'bw' => [64.0, 63.1], 'checkinWeeks' => 3, 'checkinBase' => 3.4, 'program' => 'Full body — beginner', 'accepted' => 24,
                'note' => 'Three weeks in, still finding the habit. Check-ins say tired.'],
            ['key' => 'youssef', 'name' => 'Youssef Idrissi', 'joined' => 118, 'plan' => 'ppl', 'trains' => [1, 3, 5], 'miss' => 0.12, 'stopped' => 16,
                'bw' => [88.0, 86.9], 'checkinWeeks' => 12, 'checkinBase' => 3.1, 'program' => 'Push / Pull / Legs', 'accepted' => 110,
                'note' => 'Was solid, then stopped 16 days ago: inactive, check-in overdue.'],
            ['key' => 'lina', 'name' => 'Lina Cherkaoui', 'joined' => 34, 'plan' => 'full-body', 'trains' => [2, 4], 'miss' => 0.15,
                'bw' => [59.5, 59.8], 'checkinWeeks' => 4, 'checkinBase' => 3.9, 'pending' => 'Upper / Lower', 'pendingDays' => 3,
                'note' => 'On an old plan; a new program waits on her to accept it.'],
            ['key' => 'omar', 'name' => 'Omar Tazi', 'joined' => 2, 'plan' => null, 'trains' => [], 'miss' => 0,
                'bw' => [74.0, 74.0], 'checkinWeeks' => 0, 'checkinBase' => 0,
                'note' => 'Signed up two days ago. No program, no history: the new client.'],
        ];
    }

    /** Routines by plan: [exercise, sets, reps]. */
    private static function plans(): array
    {
        $e = self::EX;

        return [
            'ppl' => [
                ['Push', 'arm', [[$e['bench'], 4, 6], [$e['dbBench'], 3, 10], [$e['curl'], 3, 12]]],
                ['Pull', 'pullup', [[$e['row'], 4, 8], [$e['pulldown'], 3, 10], [$e['pullup'], 3, 8]]],
                ['Legs', 'legs', [[$e['squat'], 4, 6], [$e['rdl'], 3, 8], [$e['legPress'], 3, 12]]],
            ],
            'upper-lower' => [
                ['Upper A', 'arm', [[$e['bench'], 4, 5], [$e['row'], 4, 6], [$e['curl'], 3, 10]]],
                ['Lower A', 'legs', [[$e['squat'], 4, 5], [$e['rdl'], 3, 8]]],
                ['Upper B', 'pullup', [[$e['pullup'], 4, 6], [$e['dbBench'], 4, 8], [$e['pulldown'], 3, 12]]],
                ['Lower B', 'legs', [[$e['deadlift'], 3, 5], [$e['legPress'], 4, 10]]],
            ],
            'full-body' => [
                ['Full body A', 'barbell', [[$e['squat'], 3, 8], [$e['bench'], 3, 8], [$e['row'], 3, 10]]],
                ['Full body B', 'kettlebell', [[$e['deadlift'], 3, 5], [$e['dbBench'], 3, 10], [$e['pulldown'], 3, 12]]],
            ],
        ];
    }

    /**
     * Opening working weight per exercise, in kg, and what it climbs by each time it is trained.
     * Deliberately unequal: a roster where everyone adds 2.5 kg a week reads as generated.
     *
     * Read as the Node script read them, with `||`: the pull-up's 0 falls through to 20 kg and
     * 1 kg a session. That is what the filmed episodes show, and a re-seed must match them.
     *
     * @return array{0: array<string, float>, 1: array<string, float>}
     */
    private static function weights(): array
    {
        $e = self::EX;

        return [
            [$e['bench'] => 45, $e['squat'] => 55, $e['deadlift'] => 70, $e['pullup'] => 0, $e['row'] => 40,
                $e['dbBench'] => 20, $e['curl'] => 10, $e['rdl'] => 45, $e['pulldown'] => 35, $e['legPress'] => 80],
            [$e['bench'] => 1.25, $e['squat'] => 2.5, $e['deadlift'] => 2.5, $e['pullup'] => 0, $e['row'] => 1.25,
                $e['dbBench'] => 1, $e['curl'] => 0.5, $e['rdl'] => 2.5, $e['pulldown'] => 1.25, $e['legPress'] => 5],
        ];
    }

    /**
     * A small deterministic PRNG, seeded per person: the roster must come out the same on every run,
     * so a --remove and a re-seed do not quietly produce a different history. FNV-1a into xorshift32,
     * as the Node script had it.
     */
    private static function rng(string $seed): \Closure
    {
        $h = 2166136261;
        foreach (str_split($seed) as $ch) {
            $h = (($h ^ ord($ch)) * 16777619) & 0xFFFFFFFF;
        }

        return function () use (&$h): float {
            $h = ($h ^ ($h << 13)) & 0xFFFFFFFF;
            $h ^= $h >> 17;
            $h = ($h ^ ($h << 5)) & 0xFFFFFFFF;

            return ($h % 10000) / 10000;
        };
    }

    /**
     * One persona's S, as the app would have synced it.
     *
     * Dates are calendar days in $today's timezone, not UTC: a client's device stamps `d` with its own local day
     * (lib/format.js todayISO) and the coach's screens compare against local today, so a seed
     * written in UTC reads as "yesterday" for the first hours after midnight anywhere east of
     * Greenwich — which turns every fresh check-in into "overdue" on the dashboard.
     *
     * Times are that day's clock time, and never later than now: nothing seeded may sit in the
     * future (the Node script dated today's session, and _ts, hours ahead).
     */
    private static function state(array $p, int $now, Carbon $today): stdClass
    {
        $rand = self::rng($p['key']);
        [$startW, $stepW] = self::weights();
        // Calendar days back from today, not 24-hour blocks: across a DST change those land on the
        // wrong date (one day twice, the day before it skipped).
        $day = fn (int $back) => $today->copy()->subDays($back);
        $at = fn (int $back, int $hour) => min($now, $day($back)->addHours($hour)->getTimestampMs());

        $routines = [];
        foreach (self::plans()[$p['plan']] ?? [] as $i => [$name, $emoji, $ex]) {
            $routines[] = (object) ['id' => self::DEMO_PREFIX."{$p['key']}-r{$i}", 'name' => $name, 'emoji' => $emoji,
                'ex' => array_map(fn ($e) => (object) ['id' => $e[0], 'sets' => $e[1], 'reps' => $e[2], 'weight' => ($startW[$e[0]] ?? 0) ?: 20], $ex)];
        }
        // Weekday -> [routine id]. S.week is day -> ARRAY everywhere (the P0 bug was code reading it
        // as a scalar), and an object even when empty.
        $week = new stdClass;
        foreach ($p['trains'] as $i => $d) {
            if ($routines !== []) {
                $week->{$d} = [$routines[$i % count($routines)]->id];
            }
        }

        $workouts = [];
        $done = [];   // exercise -> times trained, which drives its weight
        $last = $p['stopped'] ?? 0;
        for ($d = $p['joined']; $d >= $last; $d--) {
            $date = $day($d);
            $slot = array_search($date->dayOfWeekIso, $p['trains'], true);
            if ($slot === false || $routines === []) {
                continue;
            }
            if ($rand() < $p['miss']) {
                continue;   // a missed session, which is what adherence is for
            }
            $routine = $routines[$slot % count($routines)];
            $entries = [];
            foreach ($routine->ex as $e) {
                $n = $done[$e->id] = ($done[$e->id] ?? 0) + 1;
                $w = round(((($startW[$e->id] ?? 0) ?: 20) + (($stepW[$e->id] ?? 0) ?: 1) * ($n - 1)) * 2) / 2;
                $sets = [];
                for ($s = 0; $s < $e->sets; $s++) {
                    // The last set drops a rep or two, the way a real one does.
                    $r = $s === $e->sets - 1 ? max(1, $e->reps - ($rand() < 0.5 ? 1 : 2)) : $e->reps;
                    $sets[] = (object) ['w' => $w, 'r' => $r, 'done' => true];
                }
                $entries[] = (object) ['id' => $e->id, 'sets' => $sets];
            }
            // An `end` as well as a `start`, or the client page reads "0 min" against every session.
            // Modelled from the work done: a warm-up, then about a working set and its rest per set,
            // with enough jitter that six clients do not all train for exactly as long.
            $setCount = array_sum(array_map(fn ($e) => count($e->sets), $entries));
            $minutes = 4 + $setCount * 2.3 + ($rand() - 0.5) * 6;
            $start = $date->copy()->addHours(18)->getTimestampMs();
            $end = $start + (int) round($minutes) * 60_000;
            if ($end > $now) {
                continue;   // today's session, still to come
            }
            $workouts[] = (object) ['d' => $date->format('Y-m-d'), 'start' => $start, 'end' => $end, 'name' => $routine->name, 'entries' => $entries];
        }

        // Body weight, one reading a week, drifting from the first value to the second with a little
        // noise. floor, not round: rounding up would overshoot past today and file a weigh-in dated
        // in the future, which every chart then draws a line out to.
        [$fromBw, $toBw] = $p['bw'];
        $bodyweight = [];
        $bwWeeks = max(1, intdiv($p['joined'], 7));
        for ($i = 0; $i <= $bwWeeks; $i++) {
            $t = $i / $bwWeeks;
            $w = $fromBw + ($toBw - $fromBw) * $t + ($rand() - 0.5) * 0.6;
            $bodyweight[] = (object) ['d' => $day(max(0, $p['joined'] - $i * 7))->format('Y-m-d'), 'w' => round($w * 10) / 10];
        }

        // Weekly check-ins, scores wobbling around the persona's baseline.
        $checkins = [];
        for ($i = 0; $i < $p['checkinWeeks']; $i++) {
            $back = $last + $i * 7;
            if ($back > $p['joined']) {
                break;
            }
            $score = fn () => max(1, min(5, (int) round($p['checkinBase'] + ($rand() - 0.5) * 1.6)));
            $checkins[] = (object) ['d' => $day($back)->format('Y-m-d'), 't' => $at($back, 20),
                'answers' => (object) ['energy' => $score(), 'sleep' => $score(), 'recovery' => $score(), 'stress' => $score(), 'nutrition' => $score()]];
        }
        usort($checkins, fn ($a, $b) => strcmp($a->d, $b->d));

        return (object) [
            '_ts' => $at($last, 20),
            'routines' => $routines, 'week' => $week, 'workouts' => $workouts, 'bodyweight' => $bodyweight, 'checkins' => $checkins,
            'checkinDay' => 0,
            'measurements' => [], 'meals' => [], 'foods' => [], 'customEx' => [], 'programs' => [], 'dayPlan' => new stdClass,
            'unit' => 'kg', 'weekStart' => 1, 'barWeights' => new stdClass,
            'gymCards' => [], 'lastGymCardId' => null, 'checkIn' => true,
        ];
    }

    private static function iso(int $ms): string
    {
        return Js::iso(Carbon::createFromTimestampMs($ms));
    }
}
