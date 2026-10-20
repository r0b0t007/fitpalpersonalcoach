<?php

namespace App\Models;

use App\Support\Js;
use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;

/** A sign-up code (migration 2026_10_18_130000). Scoped to the acting coach: OwnedByCoach. */
class Invite extends Model
{
    use OwnedByCoach;

    protected $primaryKey = 'code';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['code', 'note', 'created_by', 'created', 'used_by', 'used_at', 'revoked', 'revoked_at', 'revoked_reason'];

    protected function casts(): array
    {
        return ['revoked' => 'boolean'];
    }

    /** Codes are unique across ALL coaches (the primary key), so the collision check is too. */
    public static function codeTaken(string $code): bool
    {
        return static::acrossCoaches()->whereKey($code)->exists(); // across coaches: the code is a global key
    }

    /**
     * api/server.js mintInvite: 16 hex characters (64 bits — the app has no rate limiting, and
     * register/options tells a caller whether a code is good, so the code itself must not be worth
     * guessing). $coachId is what puts a redeemer on a roster, and only the coach route sets it.
     */
    public static function mint(User $creator, string $note, ?string $coachId = null): self
    {
        do {
            $code = strtoupper(bin2hex(random_bytes(8)));
        } while (self::codeTaken($code));

        $invite = new self;
        $invite->forceFill([
            'code' => $code, 'note' => mb_substr($note, 0, 60), 'created_by' => $creator->id,
            'coach_id' => $coachId, 'created' => Js::isoNow(),
        ])->save();

        return $invite;
    }

    /**
     * The row as Node kept it in db.json, for the routes that sent it whole (invites/new and the
     * admin list): a field Node never set on this invite is absent, not null — mintInvite wrote
     * coachId only for a coach's code, and `revoked` only ever appeared as true.
     */
    public function toNode(): array
    {
        $row = ['code' => $this->code, 'note' => $this->note, 'createdBy' => $this->created_by, 'created' => $this->created];
        foreach (['coachId' => $this->coach_id, 'usedBy' => $this->used_by, 'usedAt' => $this->used_at] as $k => $v) {
            if ($v !== null) {
                $row[$k] = $v;
            }
        }
        if ($this->revoked) {
            $row['revoked'] = true;
            foreach (['revokedAt' => $this->revoked_at, 'revokedReason' => $this->revoked_reason] as $k => $v) {
                if ($v !== null) {
                    $row[$k] = $v;
                }
            }
        }

        return $row;
    }

    /**
     * Every open code one coach handed out, revoked together (api/server.js detachCoach): only
     * unredeemed, unrevoked ones — a used code is history, not a key — and flagged, never deleted.
     */
    public static function revokeOpenOf(string $coachId, string $reason): int
    {
        return static::acrossCoaches()->where('coach_id', $coachId) // across coaches: an admin route acts on the detached coach's codes
            ->whereNull('used_by')->where('revoked', false)
            ->update(['revoked' => true, 'revoked_at' => Js::isoNow(), 'revoked_reason' => $reason]);
    }

    /** Flagged, never deleted: the row is the record that the code was issued, and to whom. */
    public function revoke(?string $reason = null): void
    {
        $this->forceFill(['revoked' => true, 'revoked_at' => Js::isoNow(), 'revoked_reason' => $reason])->save();
    }
}
