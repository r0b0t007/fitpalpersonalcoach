<?php

namespace App\Models;

use App\Coaching\MemberCard;
use App\Support\Json;
use Illuminate\Database\Eloquent\Model;
use stdClass;

/**
 * The raw JSON of one account's training state; see DataController for why it stays raw.
 *
 * Beside it, the two values fitpal:remind reads on every scheduler run for every member — S.reminder and
 * S.checkinDay — kept in columns of their own, derived whenever the state is saved: reading them
 * out of every member's state on each run would parse megabytes of workouts 288 times a day.
 *
 * And `checkin_seen` (CHW-339), which is not derived: the newest check-in date any sync has carried,
 * only ever raised (DataController). A check-in above it is one just filed, which the client's coach
 * is told of; a device syncing an older state cannot lower it and so cannot make one news twice.
 */
class UserState extends Model
{
    protected $primaryKey = 'user_id';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['user_id', 'state', 'ts', 'reminder', 'checkin_day'];

    /**
     * Set by a caller that has filled the derived columns from the state it already decoded
     * (DataController): unchanged values are not dirty, so dirtiness cannot say so, and without
     * this every sync would decode a state of up to 16 MB a second time.
     */
    public bool $derivedSet = false;

    protected static function booted(): void
    {
        static::saving(function (self $row): void {
            if ($row->isDirty('state') && ! $row->derivedSet) {
                $row->forceFill(self::derived(json_decode((string) $row->state, false, 100_000)));
            }
        });
    }

    /**
     * The reminder columns of a decoded state: `reminder` as its JSON when it is an object, and
     * `checkin_day` when it is a day (MemberCard::checkinDay), each null otherwise.
     *
     * @return array{reminder: ?string, checkin_day: ?int}
     */
    public static function derived(mixed $state): array
    {
        $reminder = $state instanceof stdClass ? ($state->reminder ?? null) : null;

        return [
            'reminder' => $reminder instanceof stdClass ? json_encode($reminder, Json::FLAGS) : null,
            'checkin_day' => MemberCard::checkinDay($state instanceof stdClass ? ($state->checkinDay ?? null) : null),
        ];
    }
}
