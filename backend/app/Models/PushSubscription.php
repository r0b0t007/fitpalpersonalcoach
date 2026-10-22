<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * A browser that allowed notifications (Node's db.subs entry). It belongs to the account that
 * subscribed it — any account, coach or client — so it is not OwnedByCoach.
 */
class PushSubscription extends Model
{
    /** A browser holds one subscription per device: far above real use, and a bound on fan-out. */
    public const MAX_PER_USER = 20;

    public $timestamps = false;

    // Not user_id: whose browser it is is never a request's to say (rows are written with forceFill).
    protected $fillable = ['endpoint', 'endpoint_hash', 'p256dh', 'auth', 'created'];

    public static function hashOf(string $endpoint): string
    {
        return hash('sha256', $endpoint);
    }

    /** A user's subscriptions, oldest first (Node kept them in the order they were added). */
    public static function of(string $userId): Builder
    {
        return static::query()->where('user_id', $userId)->orderBy('id');
    }
}
