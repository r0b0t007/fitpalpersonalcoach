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

    public $incrementing = false;

    protected $keyType = 'string';

    protected $dateFormat = 'Y-m-d H:i:s.v';

    // Every write names its columns (forceFill): what a licence says is never a request's to set.
    protected $fillable = [];

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
