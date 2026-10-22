<?php

namespace App\Models;

use App\Support\Js;
use Illuminate\Database\Eloquent\Model;

/**
 * A coach's licence (spec §6). Belongs to the coach by `user_id` and is never tenant-scoped: it is
 * read where no coach context exists (the webhook, the admin panel, sign-up).
 */
class Licence extends Model
{
    /** The statuses a coach keeps writing in (canceled too, until the paid period ends). */
    public const WRITABLE = ['trialing', 'active', 'past_due', 'manual'];

    /**
     * A Creem subscription that can still bill, whether or not it writes today: paused and unpaid
     * resume when the card goes through. A grant by hand does not take one over (the coach would
     * pay twice, or a webhook would undo the grant). Canceled and expired ones are over; a pending
     * checkout is not a subscription yet.
     */
    public const CREEM_LIVE = ['trialing', 'active', 'past_due', 'unpaid', 'paused'];

    /** How long past its period a Creem licence counts as in force with no news from Creem (isStale). */
    public const GRACE_DAYS = 14;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $dateFormat = 'Y-m-d H:i:s.v';

    // Every write names its columns (forceFill): what a licence says is never a request's to set.
    protected $fillable = [];

    /**
     * A Creem licence whose paid period ended more than GRACE_DAYS ago without a word from Creem:
     * a renewal moves period_end on (CHW-270), so this is a webhook lost for good. It neither
     * writes (Entitlement) nor counts as a subscription that can still bill — else the coach could
     * neither work, nor pay again, nor be granted a plan. A manual licence has no period.
     */
    public function isStale(): bool
    {
        return $this->source === 'creem' && $this->period_end !== null
            && $this->period_end->lt(now()->subDays(self::GRACE_DAYS));
    }

    /**
     * A Creem subscription that can still charge the coach (CREEM_LIVE, and not stale): nobody sells
     * them a second plan over it, and a grant by hand does not take it over.
     */
    public function canStillBill(): bool
    {
        return $this->source === 'creem' && in_array($this->status, self::CREEM_LIVE, true) && ! $this->isStale();
    }

    protected function casts(): array
    {
        return [
            'checkout_at' => 'datetime', 'trial_ends_at' => 'datetime', 'period_start' => 'datetime',
            'period_end' => 'datetime', 'cancel_at' => 'datetime', 'canceled_at' => 'datetime',
            'last_event_at' => 'datetime', 'disputed' => 'boolean',
        ];
    }

    /** 32 characters fit `users.licence_id`; base64url, like every other id here. */
    public static function newId(): string
    {
        return 'lic_'.Js::token(18);
    }
}
