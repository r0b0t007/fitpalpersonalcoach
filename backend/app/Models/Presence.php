<?php

namespace App\Models;

use App\Support\Js;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use stdClass;

/**
 * An account training right now (api/server.js `presence`, livePresence). Belongs to the account
 * itself, coach or client, so it is not OwnedByCoach.
 */
class Presence extends Model
{
    /** PRESENCE_TTL: about 3.5 heartbeats of 20 s. A row older than this is nobody training. */
    public const TTL_MS = 70000;

    protected $table = 'presence';

    protected $primaryKey = 'user_id';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['payload', 'updated_at'];

    /** `livePresence(uid)`: the object while they train, null otherwise. */
    public static function live(string $userId): ?stdClass
    {
        $payload = static::current()->whereKey($userId)->value('payload');
        $live = is_string($payload) ? json_decode($payload) : null;

        return $live instanceof stdClass ? $live : null;
    }

    /** Rows still within the TTL. */
    public static function current(): Builder
    {
        return static::query()->where('updated_at', '>=', Js::nowMs() - self::TTL_MS);
    }

    /** Off "training now" at once (a workout left, an account disabled). */
    public static function drop(string $userId): void
    {
        static::query()->whereKey($userId)->delete();
    }
}
