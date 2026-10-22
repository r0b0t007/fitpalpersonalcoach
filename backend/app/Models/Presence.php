<?php

namespace App\Models;

use App\Support\Js;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use stdClass;

/**
 * An account training right now (api/server.js `presence`, livePresence). Belongs to the account
 * itself, coach or client, so it is not OwnedByCoach.
 *
 * A row with no payload is a "left" marker: it holds back, for a few seconds, a heartbeat that was
 * already on its way when the app said it left. PHP serves the two at once, so the later-sent one
 * can land first — Node took them in order.
 */
class Presence extends Model
{
    /** PRESENCE_TTL: about 3.5 heartbeats of 20 s. A row older than this is nobody training. */
    public const TTL_MS = 70000;

    /** How long a "left" holds back a heartbeat sent before it (a request in flight, not a new workout). */
    public const LEFT_HOLD_MS = 5000;

    protected $table = 'presence';

    protected $primaryKey = 'user_id';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    /**
     * `livePresence(uid)` for every account at once: id => the object, for those training now. One
     * query for a whole roster or user list, whatever its length.
     *
     * @return array<string, stdClass>
     */
    public static function liveMap(): array
    {
        $live = [];
        foreach (static::current()->pluck('payload', 'user_id') as $id => $payload) {
            $object = json_decode((string) $payload);
            if ($object instanceof stdClass) {
                $live[$id] = $object;
            }
        }

        return $live;
    }

    /** Heartbeats within the TTL (not the "left" markers). */
    public static function current(): Builder
    {
        return static::query()->whereNotNull('payload')->where('updated_at', '>=', Js::nowMs() - self::TTL_MS);
    }

    /** Off "training now" at once (an account disabled). */
    public static function drop(string $userId): void
    {
        static::query()->whereKey($userId)->delete();
    }
}
