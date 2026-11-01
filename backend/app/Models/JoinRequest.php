<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * A follower asking to join a coach (CHW-336). Scoped: OwnedByCoach — a coach sees their own
 * requests; the public routes, which act for no coach, find one by its id or token on purpose.
 */
class JoinRequest extends Model
{
    use OwnedByCoach;

    /** A code is good for this long (as a sign-in link is). */
    public const CODE_MINUTES = 15;

    /** Wrong codes before the request must be started again. */
    public const MAX_ATTEMPTS = 5;

    /** Requests waiting on one coach before more are refused. */
    public const MAX_PENDING = 50;

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['email', 'name', 'lang', 'intake', 'status', 'code_hash', 'attempts', 'code_expires', 'token_hash', 'created', 'decided'];

    protected function casts(): array
    {
        return ['attempts' => 'integer', 'code_expires' => 'integer', 'created' => 'integer', 'decided' => 'integer'];
    }

    /**
     * One coach's requests, for the public routes, which act for no coach: the filter the scope
     * would add if that coach were acting.
     */
    public static function queueOf(User $coach): Builder
    {
        return self::acrossCoaches()->where('coach_id', $coach->id); // across coaches: the public routes act for no coach, so this is the scope written out for one
    }

    /** How long after the accept the browser that asked can sign in with its token (JoinController::claim). */
    public const CLAIM_DAYS = 7;

    /** A request the coach has not answered in this many days lapses: no queue fills for good. */
    public const PENDING_DAYS = 14;

    /**
     * fitpal:prune: an intake holds health data, so what is not waiting on anyone goes. Unverified
     * after a day (nobody proved the address); pending ones lapse to `expired` after PENDING_DAYS
     * with no answer, which also frees the coach's queue (MAX_PENDING) from anyone who filled it;
     * declined and expired ones go 30 days after they were decided. Accepted ones stay.
     */
    public static function prune(int $nowMs): int
    {
        $day = 86_400_000;
        self::acrossCoaches()->where('status', 'pending')->where('created', '<', $nowMs - self::PENDING_DAYS * $day) // across coaches: prune runs for every coach
            ->update(['status' => 'expired', 'decided' => $nowMs]);
        // An accepted request's token signs in for CLAIM_DAYS: after that it is forgotten, so a copy
        // of it found later opens nothing.
        self::acrossCoaches()->where('status', 'accepted')->whereNotNull('token_hash')->where('decided', '<', $nowMs - self::CLAIM_DAYS * $day) // across coaches: prune runs for every coach
            ->update(['token_hash' => null]);

        return self::acrossCoaches()->where('status', 'unverified')->where('created', '<', $nowMs - $day)->delete() // across coaches: prune runs for every coach
            + self::acrossCoaches()->whereIn('status', ['declined', 'expired'])->whereRaw('COALESCE(decided, created) < ?', [$nowMs - 30 * $day])->delete(); // across coaches: prune runs for every coach
    }

    public static function newId(): string
    {
        return bin2hex(random_bytes(12));
    }

    public static function hash(string $secret): string
    {
        return hash('sha256', $secret);
    }
}
