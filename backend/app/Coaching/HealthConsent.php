<?php

namespace App\Coaching;

use App\Media\Paths;
use App\Models\ProgressPhoto;
use App\Models\User;
use App\Models\UserState;
use App\Support\Json;
use stdClass;

/**
 * A coached client's explicit consent to their coach seeing the health data they log (CHW-360;
 * GDPR Art. 9(2)(a); the DPIA's M6 and M9): weekly check-ins, body weight, measurements, meals
 * and progress photos. Given once in the app (frontend lib/health-consent.js), to the coach they
 * have now: a link that ends clears it (Unlink, Detach). Withdrawing it deletes that data.
 *
 * Without it the coach's views leave the data out and photos are neither taken nor shown to the
 * coach; the app asks before the first entry. The synced state itself is not stripped on save:
 * a client who changes coach would otherwise lose their history the next time their phone syncs.
 * A client with no coach logs for themselves and is not asked.
 */
final class HealthConsent
{
    /** The state keys that hold health data a client logs, and what each is when empty. */
    public const KEYS = ['bodyweight' => [], 'measurements' => [], 'checkins' => [], 'meals' => [], 'mealDays' => null];

    public static function required(User $client): bool
    {
        return $client->coach_id !== null;
    }

    public static function given(User $client): bool
    {
        return $client->health_consent_at !== null;
    }

    /** The client's state as their coach may see it: the health keys emptied unless they consented. */
    public static function forCoach(User $client, stdClass $state): stdClass
    {
        return self::given($client) ? $state : self::emptied($state);
    }

    /** Withdrawal: the health keys emptied in the stored state, and every progress photo deleted. */
    public static function erase(User $client): void
    {
        $row = UserState::query()->whereKey($client->id)->first();
        if ($row !== null) {
            $state = json_decode((string) $row->state);
            if ($state instanceof stdClass) {
                $row->forceFill(['state' => json_encode(self::emptied($state), Json::FLAGS, 100_000)])->save();
            }
        }
        $dir = Paths::photoDir($client->id);
        foreach (ProgressPhoto::of($client->id)->get() as $photo) {
            @unlink($dir.DIRECTORY_SEPARATOR.basename((string) $photo->file));
            $photo->delete();
        }
    }

    private static function emptied(stdClass $state): stdClass
    {
        $copy = clone $state;
        foreach (self::KEYS as $key => $empty) {
            $copy->{$key} = $empty ?? new stdClass;
        }

        return $copy;
    }
}
