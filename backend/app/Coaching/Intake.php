<?php

namespace App\Coaching;

use App\Support\ClientSafe;
use App\Support\Js;
use App\Support\Phone;
use stdClass;

/**
 * What a follower tells a coach when asking to join (CHW-336): goal, level, days a week, injuries,
 * equipment, an optional WhatsApp number, and their consent to share it. Kept to what the form
 * offers (frontend/src/lib/join.js holds the same lists): anything else is dropped, never stored.
 *
 * Injuries are health data (GDPR art. 9; Morocco law 09-08): the consent is required and stamped
 * (consent_at), and the text is optional and short (CHW-334 has the rest: legal pages, wiping).
 */
final class Intake
{
    public const GOALS = ['strength', 'fat_loss', 'muscle', 'fitness', 'sport', 'other'];

    public const LEVELS = ['beginner', 'intermediate', 'advanced'];

    public const EQUIPMENT = ['gym', 'home', 'dumbbells', 'bands', 'none'];

    public const INJURIES_MAX = 500;

    /** @return array{goal: string, level: string, days: int, injuries: string, equipment: list<string>, phone: string, consent_at: int} */
    public static function from(mixed $raw): array
    {
        $incomplete = new ClientSafe(400, 'tell us your goal, level and days a week');
        if (! $raw instanceof stdClass) {
            throw $incomplete;
        }
        $goal = $raw->goal ?? null;
        $level = $raw->level ?? null;
        $days = $raw->days ?? null;
        $injuries = is_string($raw->injuries ?? null) ? trim($raw->injuries) : '';
        if (! in_array($goal, self::GOALS, true) || ! in_array($level, self::LEVELS, true)
            || ! is_int($days) || $days < 1 || $days > 7 || mb_strlen($injuries) > self::INJURIES_MAX) {
            throw $incomplete;
        }
        $phone = Phone::digits($raw->phone ?? null);
        if ($phone === null) {
            throw new ClientSafe(400, 'that is not a phone number — include the country code');
        }
        if (($raw->consent ?? null) !== true) {
            throw new ClientSafe(400, 'please agree to share your answers with your coach');
        }
        $equipment = is_array($raw->equipment ?? null) ? $raw->equipment : [];

        return [
            'goal' => $goal, 'level' => $level, 'days' => $days, 'injuries' => $injuries,
            // In the form's order, once each, only what it offers.
            'equipment' => array_values(array_filter(self::EQUIPMENT, fn ($e) => in_array($e, $equipment, true))),
            'phone' => $phone,
            'consent_at' => Js::nowMs(),
        ];
    }
}
