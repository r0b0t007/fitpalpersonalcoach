<?php

namespace App\Models;

use App\Coaching\MemberCard;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Database\Eloquent\Model;
use stdClass;

/**
 * The raw JSON of one account's training state; see DataController for why it stays raw.
 *
 * Beside it, the two values fitpal:remind reads on every scheduler run for every member — S.reminder and
 * S.checkinDay — kept in columns of their own, derived whenever the state is saved: reading them
 * out of every member's state on each run would parse megabytes of workouts 288 times a day. And
 * the newest check-in date, which DataController compares across a save to tell a coach of a
 * check-in just filed (CHW-339).
 */
class UserState extends Model
{
    protected $primaryKey = 'user_id';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['user_id', 'state', 'ts', 'reminder', 'checkin_day', 'last_checkin'];

    protected static function booted(): void
    {
        static::saving(function (self $row): void {
            // A caller that has the state decoded already (DataController) sets them itself.
            if ($row->isDirty('state') && ! $row->isDirty(['reminder', 'checkin_day', 'last_checkin'])) {
                $row->forceFill(self::derived(json_decode((string) $row->state, false, 100_000)));
            }
        });
    }

    /**
     * The derived columns of a decoded state: `reminder` as its JSON when it is an object,
     * `checkin_day` when it is a day (MemberCard::checkinDay), and `last_checkin`, the newest
     * check-in date that is a date; each null otherwise.
     *
     * @return array{reminder: ?string, checkin_day: ?int, last_checkin: ?string}
     */
    public static function derived(mixed $state): array
    {
        $reminder = $state instanceof stdClass ? ($state->reminder ?? null) : null;

        return [
            'reminder' => $reminder instanceof stdClass ? json_encode($reminder, Json::FLAGS) : null,
            'checkin_day' => MemberCard::checkinDay($state instanceof stdClass ? ($state->checkinDay ?? null) : null),
            'last_checkin' => $state instanceof stdClass ? self::newestCheckin($state) : null,
        ];
    }

    /**
     * The newest check-in day, among those that are days: a `d` that is not one would sort after
     * every real date ("nope" > "2026-…") and hide the next check-in filed.
     */
    private static function newestCheckin(stdClass $state): ?string
    {
        $max = null;
        foreach (Js::list($state->checkins ?? null) as $c) {
            $d = $c instanceof stdClass ? ($c->d ?? null) : null;
            if (is_string($d) && preg_match('/^\d{4}-\d{2}-\d{2}$/D', $d) && ($max === null || strcmp($d, $max) > 0)) {
                $max = $d;
            }
        }

        return $max;
    }
}
