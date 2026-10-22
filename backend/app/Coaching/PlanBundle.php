<?php

namespace App\Coaching;

use App\Support\ClientSafe;
use App\Support\Js;
use App\Support\Say;
use stdClass;

/**
 * The plan bundle a coach saves to their library and sends to a client (api/domain.mjs
 * validateAssignmentBundle, cleanNutrition, cleanCheckinDay, cleanProgram). One gate for both: a
 * program IS what gets sent, and a library row that would be refused at send time is a trap the
 * coach only finds when they try to use it.
 *
 * Read with JavaScript's rules (App\Support\Js) on the body as sent, decoded with objects as
 * stdClass: the messages are the app's translation keys and must come out byte-identical, and a
 * `week: {}` must be stored as `{}`. A refusal throws ClientSafe(400) — Node answered every bundle
 * error with a 400 — so the message is checked by scripts/check-error-strings.mjs where it is
 * written.
 */
final class PlanBundle
{
    public const MAX_ROUTINES = 20;

    public const MAX_EX = 60;            // per routine

    public const MAX_CUSTOM = 100;

    public const MAX_BYTES = 128 * 1024;

    public const NOTE_MAX = 280;

    public const MAX_KCAL = 20000;

    public const MAX_MACRO = 2000;

    public const PROGRAM_NAME_MAX = 60;

    /** Nesting levels a bundle may have; see validate(). No real plan comes within 10. */
    public const MAX_DEPTH = 400;

    /**
     * The bundle, rebuilt so a caller cannot smuggle extra top-level keys into storage.
     *
     * @throws ClientSafe
     */
    public static function validate(mixed $raw): stdClass
    {
        if (! $raw instanceof stdClass) {
            throw new ClientSafe(400, 'plan required');
        }
        if (! Js::truthy($raw->opengym_plan ?? null)) {
            throw new ClientSafe(400, 'not a plan bundle');
        }
        $routines = $raw->routines ?? null;
        if (! is_array($routines) || $routines === []) {
            throw new ClientSafe(400, 'plan has no routines');
        }
        if (count($routines) > self::MAX_ROUTINES) {
            throw new ClientSafe(400, Say::f('too many routines (max {0})', self::MAX_ROUTINES));
        }
        foreach ($routines as $r) {
            // `!r || typeof r !== 'object' || !r.id || !Array.isArray(r.ex)`: an array is an
            // object to JS but has no id, so only an object with an id and an ex list passes.
            if (! $r instanceof stdClass || ! Js::truthy($r->id ?? null) || ! is_array($r->ex ?? null)) {
                throw new ClientSafe(400, 'malformed routine');
            }
            if (count($r->ex) > self::MAX_EX) {
                throw new ClientSafe(400, Say::f('a routine has more than {0} exercises', self::MAX_EX));
            }
            foreach ($r->ex as $e) {
                if (! $e instanceof stdClass || ! Js::truthy($e->id ?? null)) {
                    throw new ClientSafe(400, 'malformed exercise');
                }
            }
        }
        $customEx = array_values(array_filter(Js::list($raw->customEx ?? null),
            fn ($c) => $c instanceof stdClass && Js::truthy($c->id ?? null)));
        if (count($customEx) > self::MAX_CUSTOM) {
            throw new ClientSafe(400, 'too many custom exercises');
        }
        $nutrition = self::nutrition($raw->nutrition ?? null);
        $checkinDay = self::checkinDay($raw->checkinDay ?? null);
        // Size last: cheap checks first, and this one serialises the whole thing. Node caught the
        // serialiser failing (V8 overflows its stack a few thousand levels down) as "not
        // serialisable"; the limit here is MAX_DEPTH, low enough that every response wrapping a
        // bundle stays inside json_encode's 512 levels — a deeper one would save and then make
        // the coach's whole library unreadable.
        if (Js::deeperThan($raw, self::MAX_DEPTH)) {
            throw new ClientSafe(400, 'plan is not serialisable');
        }
        if (strlen(Js::stringify($raw)) > self::MAX_BYTES) {
            throw new ClientSafe(400, 'plan is too large');
        }

        $bundle = new stdClass;
        $bundle->opengym_plan = $raw->opengym_plan;
        $bundle->name = Js::slice(Js::truthy($raw->name ?? null) ? Js::string($raw->name) : '', 80);
        $bundle->week = ($raw->week ?? null) instanceof stdClass ? $raw->week : new stdClass;
        $bundle->routines = $routines;
        $bundle->customEx = $customEx;
        // Omitted rather than null, so a bundle without targets is byte-identical to the ones
        // written before they existed, and the client can test for the key.
        if ($nutrition !== null) {
            $bundle->nutrition = $nutrition;
        }
        // `!= null`, not truthy: 0 is Sunday.
        if ($checkinDay !== null) {
            $bundle->checkinDay = $checkinDay;
        }

        return $bundle;
    }

    /**
     * cleanProgram: a library row's name (trimmed, 60) and its bundle, the row's name written over
     * the bundle's — the coach renamed it here, and a send should announce the name they can see.
     *
     * @return array{0: string, 1: stdClass}
     *
     * @throws ClientSafe
     */
    public static function program(mixed $name, mixed $bundle): array
    {
        $name = Js::slice(Js::trim($name === null ? '' : Js::string($name)), self::PROGRAM_NAME_MAX);
        if ($name === '') {
            throw new ClientSafe(400, 'program needs a name');
        }
        $clean = self::validate($bundle);
        $clean->name = $name;

        return [$name, $clean];
    }

    /**
     * Daily targets: null for none (every field optional, an absent macro stays absent), an
     * error for a present-but-unusable one — a coach who typed 2,200 in the wrong box must hear
     * it now, not find a week later that it never arrived.
     */
    private static function nutrition(mixed $raw): ?stdClass
    {
        if ($raw === null) {
            return null;
        }
        if (! $raw instanceof stdClass) {
            throw new ClientSafe(400, 'nutrition targets are malformed');
        }
        $out = new stdClass;
        foreach (['kcal', 'p', 'c', 'f'] as $k) {
            $v = $raw->{$k} ?? null;
            if ($v === null || $v === '') {
                continue;
            }
            $max = $k === 'kcal' ? self::MAX_KCAL : self::MAX_MACRO;
            $n = Js::toNumber($v);
            if (! is_finite($n) || $n < 0 || $n > $max) {
                throw new ClientSafe(400, match ($k) {
                    'kcal' => Say::f('calories must be a number between 0 and {0}', $max),
                    'p' => Say::f('protein must be a number between 0 and {0} g', $max),
                    'c' => Say::f('carbs must be a number between 0 and {0} g', $max),
                    'f' => Say::f('fat must be a number between 0 and {0} g', $max),
                });
            }
            if ($n > 0) {
                $out->{$k} = (int) Js::round($n);
            }
        }
        if (get_object_vars($out) === []) {
            return null;   // a note with no numbers is not a target
        }
        $note = Js::slice(Js::trim(Js::truthy($raw->note ?? null) ? Js::string($raw->note) : ''), self::NOTE_MAX);
        if ($note !== '') {
            $out->note = $note;
        }

        return $out;
    }

    /** 0 (Sunday) to 6, or null for none. Type-checked first: Number([]) and Number(false) are 0. */
    private static function checkinDay(mixed $raw): ?int
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        $n = is_int($raw) || is_float($raw) || is_string($raw) ? Js::toNumber($raw) : NAN;
        if (! is_finite($n) || floor($n) !== $n || $n < 0 || $n > 6) {
            throw new ClientSafe(400, 'check-in day must be a weekday, 0 (Sunday) to 6');
        }

        return (int) $n;
    }
}
