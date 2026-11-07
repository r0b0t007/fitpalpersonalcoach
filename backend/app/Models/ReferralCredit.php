<?php

namespace App\Models;

use App\Support\Js;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A free month banked for a coach who referred another (CHW-350, App\Coaching\Referrals). Not
 * scoped to a coach context: it is read for its referrer only (Referrals::summary), listed for the
 * owner in the admin panel (ReferralCreditResource, CHW-374), and written by the hourly command
 * and the admin panel.
 */
class ReferralCredit extends Model
{
    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['id', 'referrer_id', 'referred_id', 'months', 'created', 'used_at', 'used_note'];

    protected function casts(): array
    {
        return ['months' => 'integer', 'created' => 'integer', 'used_at' => 'integer'];
    }

    /** The coach who earned the month. */
    public function referrer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'referrer_id');
    }

    /** The coach whose activation earned it; null once they objected (Referrals::forget). */
    public function referred(): BelongsTo
    {
        return $this->belongsTo(User::class, 'referred_id');
    }

    /** 28 characters, base64url, like a licence's id. */
    public static function newId(): string
    {
        return 'ref_'.Js::token(18);
    }
}
