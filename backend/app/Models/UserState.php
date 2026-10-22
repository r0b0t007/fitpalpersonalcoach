<?php

namespace App\Models;

use App\Coaching\MemberCard;
use App\Support\Json;
use Illuminate\Database\Eloquent\Model;
use stdClass;

/**
 * The raw JSON of one account's training state; see DataController for why it stays raw.
 *
 * Beside it, the two values fitpal:remind reads every minute for every member — S.reminder and
 * S.checkinDay — kept in columns of their own, derived whenever the state is saved: reading them
 * out of every member's state each minute would parse megabytes of workouts 1,440 times a day.
 */
class UserState extends Model
{
    protected $primaryKey = 'user_id';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['user_id', 'state', 'ts', 'reminder', 'checkin_day'];

    protected static function booted(): void
    {
        static::saving(function (self $row): void {
            // A caller that has the state decoded already (DataController) sets them itself.
            if ($row->isDirty('state') && ! $row->isDirty('reminder') && ! $row->isDirty('checkin_day')) {
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
