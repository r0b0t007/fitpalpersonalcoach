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
 * have now: any change of coach clears it (User::booted).
 * Withdrawing it deletes that data.
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

    /**
     * The body weight a workout carries: the weigh-in before it (finish-workout.js `bw`), and the
     * spellings recovery.js also reads. The workout itself stays: training is not health data here.
     */
    public const WORKOUT_KEYS = ['bw', 'bwUnit', 'bodyweight', 'bodyweightUnit'];

    public static function required(User $client): bool
    {
        return $client->coach_id !== null;
    }

    public static function given(User $client): bool
    {
        return $client->health_consent_at !== null;
    }

    /** A coached client who has not agreed: nothing they log reaches their coach. */
    public static function missing(User $client): bool
    {
        return self::required($client) && ! self::given($client);
    }

    /** The client's state as their coach may see it: the health data emptied unless they consented. */
    public static function forCoach(User $client, stdClass $state): stdClass
    {
        return self::given($client) ? $state : self::emptied($state);
    }

    /**
     * Withdrawal's rows: the health data emptied in the stored state, and every progress photo's
     * row deleted. Call it in a transaction with the client's row locked. Returns the photo files,
     * for the caller to delete once that transaction has committed: a rollback must not leave rows
     * pointing at files that are gone.
     *
     * @return list<string>
     */
    public static function erase(User $client): array
    {
        $row = UserState::query()->whereKey($client->id)->lockForUpdate()->first();
        if ($row !== null) {
            $state = json_decode((string) $row->state);
            if ($state instanceof stdClass) {
                $row->forceFill(['state' => json_encode(self::emptied($state), Json::FLAGS, 100_000)])->save();
            }
        }
        $dir = Paths::photoDir($client->id);
        $photos = ProgressPhoto::of($client->id)->get();
        ProgressPhoto::query()->whereKey($photos->modelKeys())->delete();

        return $photos->map(fn (ProgressPhoto $p) => $dir.DIRECTORY_SEPARATOR.basename((string) $p->file))->all();
    }

    private static function emptied(stdClass $state): stdClass
    {
        $copy = clone $state;
        foreach (self::KEYS as $key => $empty) {
            $copy->{$key} = $empty ?? new stdClass;
        }
        if (is_array($copy->workouts ?? null)) {
            $copy->workouts = array_map(fn ($w) => is_object($w) ? self::withoutWeight($w) : $w, $copy->workouts);
        }
        if (is_object($copy->active ?? null)) {
            $copy->active = self::withoutWeight($copy->active);
        }

        return $copy;
    }

    private static function withoutWeight(stdClass $workout): stdClass
    {
        $w = clone $workout;
        foreach (self::WORKOUT_KEYS as $key) {
            unset($w->{$key});
        }

        return $w;
    }
}
