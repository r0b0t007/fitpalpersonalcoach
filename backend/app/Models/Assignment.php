<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

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
}
