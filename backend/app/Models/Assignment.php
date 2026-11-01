<?php

namespace App\Models;

use App\Support\Js;
use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;
use stdClass;

/**
 * A program sent to a client. Scoped to the sending coach on coach routes (OwnedByCoach): a coach
 * sees and withdraws their own offers only. An assignment belongs to its member as much as to its
 * coach, though, and the Node API read three things across coaches on purpose — forMember() is
 * that read: the per-member pending cap (every coach's offers count), the client card's last
 * decision, and an admin releasing a client (whose coach is not the admin).
 */
class Assignment extends Model
{
    use OwnedByCoach;

    /** api/domain.mjs ASSIGN_MAX_PENDING: per member, every coach's offers together. */
    public const MAX_PENDING = 5;

    /** An offer nobody answered expires by itself (ASSIGN_PENDING_DAYS). */
    public const PENDING_DAYS = 30;

    /** Answered offers are kept this long, then dropped (ASSIGN_DECIDED_DAYS). */
    public const DECIDED_DAYS = 30;

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['id', 'coach_name', 'member_id', 'bundle', 'note', 'schedule', 'status', 'created', 'decided_at'];

    protected function casts(): array
    {
        return ['schedule' => 'boolean', 'auto' => 'boolean'];
    }

    /** Every coach's assignments for one member (api/domain.mjs pendingAssignmentsFor and memberCard). */
    public static function forMember(string $memberId): Builder
    {
        return static::acrossCoaches()->where('member_id', $memberId); // across coaches: a member's offers come from any coach
    }

    /**
     * forMember for a whole roster at once, in Node's array order (oldest first), grouped by member.
     *
     * @param  list<string>  $memberIds
     * @return Collection<string, Collection<int, Assignment>>
     */
    public static function forMembers(array $memberIds): Collection
    {
        return static::acrossCoaches()->whereIn('member_id', $memberIds) // across coaches: a member's offers come from any coach
            ->orderBy('created')->orderBy('id')->get()->groupBy('member_id');
    }

    /** Offers a member has not answered yet (api/domain.mjs pendingAssignmentsFor), oldest first. */
    public static function pendingFor(string $memberId): Builder
    {
        return static::forMember($memberId)->where('status', 'pending')->orderBy('created')->orderBy('id');
    }

    /**
     * How many offers each of these members has waiting, from every coach: one query for a whole
     * send, not one per recipient.
     *
     * @param  list<string>  $memberIds
     * @return Collection<string, int>
     */
    public static function pendingCounts(array $memberIds): Collection
    {
        return static::acrossCoaches()->whereIn('member_id', $memberIds) // across coaches: the cap counts every coach's offers
            ->where('status', 'pending')->groupBy('member_id')->selectRaw('member_id, count(*) as n')
            ->pluck('n', 'member_id')->map(fn ($n) => (int) $n);
    }

    /** The bundle as the app sent it (objects as stdClass, so `{}` goes back out as `{}`). */
    public function plan(): mixed
    {
        return json_decode($this->bundle);
    }

    /** A row of GET /api/assignments, the member's inbox. */
    public function toInbox(): array
    {
        return ['id' => $this->id, 'coachName' => $this->coach_name, 'note' => $this->note, 'created' => $this->created,
            // `auto`: a page's starter program (CHW-338), which the app takes in by itself.
            'schedule' => (bool) $this->schedule, 'auto' => (bool) $this->auto, 'bundle' => $this->plan()];
    }

    /** A row of GET /api/assignments/history: the program's name and size, never the bundle. */
    public function toHistory(): array
    {
        $plan = $this->plan();

        return [
            'id' => $this->id, 'coachName' => $this->coach_name, 'note' => $this->note,
            'created' => $this->created, 'decidedAt' => Js::or($this->decided_at, null), 'status' => $this->status,
            'name' => Js::or($plan instanceof stdClass ? ($plan->name ?? null) : null, ''),
            'routines' => $plan instanceof stdClass && is_array($plan->routines ?? null) ? count($plan->routines) : 0,
        ];
    }

    /**
     * api/domain.mjs pruneAssignments, across every coach as it ran: an offer nobody answered goes
     * after PENDING_DAYS, an answered one DECIDED_DAYS after it was answered — except each member's
     * newest accepted row, which is the program they are on, not history. It is what keeps GET
     * /api/assignments/history bounded with no limit of its own.
     *
     * Node ran it on every send; here it is the scheduler's, hourly (routes/console.php, spec
     * "Background work"), so housekeeping neither holds the recipients' locks nor fails a send.
     * An offer can sit up to an hour past its 30 days before it goes.
     */
    public static function prune(?int $nowMs = null): int
    {
        $nowMs ??= Js::nowMs();
        // The light columns only: the bundle is the largest field in the database.
        $rows = static::acrossCoaches() // across coaches: Node pruned db.assignments whole
            ->orderBy('created')->orderBy('id')->get(['id', 'member_id', 'status', 'created', 'decided_at']);
        $current = [];
        foreach ($rows as $a) {
            if ($a->status !== 'accepted') {
                continue;
            }
            $t = Js::dateParse(Js::or($a->decided_at, Js::or($a->created, ''))) ?? 0;
            // Strictly newer: on a tie the earlier row holds, as Node's Map did.
            if (! isset($current[$a->member_id]) || $t > $current[$a->member_id][1]) {
                $current[$a->member_id] = [$a->id, $t];
            }
        }
        $keep = array_flip(array_column($current, 0));
        $gone = $rows->reject(function (self $a) use ($keep, $nowMs): bool {
            if (isset($keep[$a->id])) {
                return true;
            }
            $days = $a->status === 'pending' ? self::PENDING_DAYS : self::DECIDED_DAYS;
            $t = Js::dateParse($a->status === 'pending' ? $a->created : Js::or($a->decided_at, $a->created)) ?? 0;

            return $nowMs - $t < $days * 86_400_000;
        });

        // Deleted by id AND by the status that made the row stale: the read above locks nothing,
        // and a pending offer answered since (decide locks and commits it) may now be the program
        // its member is on. A DELETE re-reads each row's committed status, so that one survives.
        // Answered rows never change status again, so they need no further guard.
        $n = 0;
        foreach ($gone->partition(fn (self $a) => $a->status === 'pending') as $i => $rows) {
            foreach (array_chunk($rows->pluck('id')->all(), 500) as $ids) {
                $q = static::acrossCoaches()->whereKey($ids); // across coaches: Node pruned db.assignments whole
                $n += ($i === 0 ? $q->where('status', 'pending') : $q->where('status', '!=', 'pending'))->delete();
            }
        }

        return $n;
    }

    /** expireAssignmentsWhere(a => a.coachId === coach): every unanswered offer one coach made. */
    public static function expireAllFrom(string $coachId): int
    {
        return static::acrossCoaches()->where('coach_id', $coachId)->where('status', 'pending') // across coaches: an admin route acts on the detached coach's offers
            ->update(['status' => 'expired', 'decided_at' => Js::isoNow()]);
    }

    /**
     * api/server.js expireAssignmentsWhere(a => a.memberId === member && a.coachId === coach): the
     * pending offers one coach made to one member, retired when the relationship ends. The coach
     * is the member's OWN coach, not whoever is acting — an admin releasing someone else's client
     * must expire that coach's offers, or they keep eating the member's pending cap.
     */
    public static function expirePending(string $memberId, ?string $coachId): int
    {
        if ($coachId === null) {
            return 0;
        }

        return static::forMember($memberId)->where('coach_id', $coachId)->where('status', 'pending')
            ->update(['status' => 'expired', 'decided_at' => Js::isoNow()]);
    }
}
