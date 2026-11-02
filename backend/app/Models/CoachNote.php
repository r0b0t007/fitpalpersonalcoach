<?php

namespace App\Models;

use App\Coaching\HealthConsent;
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

    /** The notes $member has from the coach they have now; none once they have no coach. */
    public static function forMember(User $member): Builder
    {
        return self::acrossCoaches()->where('member_id', $member->id) // across coaches: a client reads their own coach's notes
            ->where('coach_id', $member->coach_id ?? '');
    }

    /**
     * The notes on $member their coach's client page shows (MemberCard::detail), in that coach's
     * context. A reply to a check-in is about health data, and goes unseen without consent.
     */
    public static function listedFor(User $member): array
    {
        $query = self::query()->where('member_id', $member->id);
        if (HealthConsent::missing($member)) {
            $query->where('ref_type', '!=', 'checkin');
        }

        return $query->orderByDesc('created')->limit(self::LIST_MAX)->get()->map(fn (self $n) => $n->toApi())->all();
    }

    /** Health consent withdrawn (HealthConsent::erase): the replies about their check-ins go with it. */
    public static function forgetCheckins(User $member): int
    {
        return self::acrossCoaches()->where('member_id', $member->id)->where('ref_type', 'checkin')->delete(); // across coaches: withdrawal is the client's, whoever wrote the reply
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
