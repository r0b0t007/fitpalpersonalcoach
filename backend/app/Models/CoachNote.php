<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * A coach's reply to a client's check-in, or comment on one of their workouts (CHW-340). Scoped:
 * OwnedByCoach — a coach reads and writes their own notes only. The client reads the notes from
 * the coach they have now (forMember), across coaches by design, as their inbox does.
 */
class CoachNote extends Model
{
    use OwnedByCoach;

    /** What a note is about. */
    public const REF_TYPES = ['checkin', 'workout'];

    /** The longest note, in characters. */
    public const BODY_MAX = 1000;

    /** The notes the client is sent, newest first: plenty for a coaching relationship's screen. */
    public const LIST_MAX = 100;

    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $fillable = ['member_id', 'ref_type', 'ref_key', 'body', 'created', 'read_at'];

    protected function casts(): array
    {
        return ['created' => 'integer', 'read_at' => 'integer'];
    }

    public static function newId(): string
    {
        return bin2hex(random_bytes(12));
    }

    /** The notes $member has from the coach they have now; none once they have no coach. */
    public static function forMember(User $member): Builder
    {
        return self::acrossCoaches()->where('member_id', $member->id) // across coaches: a client reads their own coach's notes
            ->where('coach_id', $member->coach_id ?? '');
    }

    /** The link between $coachId and $member ended (Unlink): what was said in it goes with it. */
    public static function forgetPair(string $coachId, User $member): int
    {
        return self::acrossCoaches()->where('coach_id', $coachId)->where('member_id', $member->id)->delete(); // across coaches: the caller names the coach whose link ended
    }

    /** A coach was let go (Detach): every note they wrote goes. */
    public static function forgetCoach(string $coachId): int
    {
        return self::acrossCoaches()->where('coach_id', $coachId)->delete(); // across coaches: detach runs outside any coach context, for this one coach
    }

    public function toApi(): array
    {
        return ['id' => $this->id, 'refType' => $this->ref_type, 'refKey' => $this->ref_key, 'body' => $this->body,
            'created' => $this->created, 'readAt' => $this->read_at];
    }
}
