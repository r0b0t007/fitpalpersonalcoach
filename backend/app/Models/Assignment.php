<?php

namespace App\Models;

use App\Support\Js;
use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

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

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['id', 'coach_name', 'member_id', 'bundle', 'note', 'schedule', 'status', 'created', 'decided_at'];

    protected function casts(): array
    {
        return ['schedule' => 'boolean'];
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
