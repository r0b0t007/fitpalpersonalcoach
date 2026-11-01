<?php

namespace App\Push;

use App\Support\Js;

/**
 * Every push the server writes, in each language the app ships — api/push-messages.js, word for
 * word (tests/Unit/PushMessagesTest holds it to that file). The language is the member's synced
 * `S.lang`; French says "vous", like the rest of the app.
 */
final class Messages
{
    public const COPY = [
        'en' => [
            'restTitle' => 'Rest over 💪',
            'restBody' => 'Time for your next set.',
            'testBody' => 'Test notification ✅ — this is what alerts look like.',
            'dayFallbackTitle' => 'Workout planned today',
            'dayRoutineSuffix' => 'today',
            'dayBody' => "It's on your plan — let's go 💪",
            'checkinTitle' => 'Weekly check-in 📋',
            'checkinBody' => 'Five quick scales and anything your coach should know.',
            'assignmentBody' => '{0} sent you a program',
            'joinRequestBody' => '{0} asked to train with you',
            'joinAutoBody' => '{0} joined you as a client',
        ],
        'de' => [
            'restTitle' => 'Pause vorbei 💪',
            'restBody' => 'Zeit für deinen nächsten Satz.',
            'testBody' => 'Testbenachrichtigung ✅ — so sehen Hinweise aus.',
            'dayFallbackTitle' => 'Heute steht ein Training an',
            'dayRoutineSuffix' => 'heute',
            'dayBody' => 'Es steht in deinem Plan — los geht’s 💪',
            'checkinTitle' => 'Wöchentlicher Check-in 📋',
            'checkinBody' => 'Fünf kurze Skalen und alles, was dein Coach wissen sollte.',
            'assignmentBody' => '{0} hat dir ein Programm geschickt',
            'joinRequestBody' => '{0} möchte mit dir trainieren',
            'joinAutoBody' => '{0} trainiert jetzt mit dir',
        ],
        'es' => [
            'restTitle' => 'Descanso terminado 💪',
            'restBody' => 'Hora de tu siguiente serie.',
            'testBody' => 'Notificación de prueba ✅ — así se ven los avisos.',
            'dayFallbackTitle' => 'Entrenamiento previsto para hoy',
            'dayRoutineSuffix' => 'hoy',
            'dayBody' => 'Está en tu plan — ¡vamos! 💪',
            'checkinTitle' => 'Check-in semanal 📋',
            'checkinBody' => 'Cinco escalas rápidas y lo que tu entrenador deba saber.',
            'assignmentBody' => '{0} te ha enviado un programa',
            'joinRequestBody' => '{0} quiere entrenar contigo',
            'joinAutoBody' => '{0} ya entrena contigo',
        ],
        'fr' => [
            'restTitle' => 'Repos terminé 💪',
            'restBody' => 'C’est l’heure de votre prochaine série.',
            'testBody' => 'Notification de test ✅ — voici à quoi ressemblent les alertes.',
            'dayFallbackTitle' => 'Séance prévue aujourd’hui',
            'dayRoutineSuffix' => 'aujourd’hui',
            'dayBody' => 'Elle est dans votre plan — c’est parti 💪',
            'checkinTitle' => 'Point hebdomadaire 📋',
            'checkinBody' => 'Cinq échelles rapides et ce que votre coach doit savoir.',
            'assignmentBody' => '{0} vous a envoyé un programme',
            'joinRequestBody' => '{0} souhaite s’entraîner avec vous',
            'joinAutoBody' => '{0} s’entraîne désormais avec vous',
        ],
    ];

    /**
     * `copyFor(lang)`: per key, not per language — a key missing from a pack arrives in English
     * rather than as nothing. A language that is not a string (state is the client's JSON) is
     * simply unknown.
     *
     * @return array<string, string>
     */
    private static function copy(mixed $lang): array
    {
        return (is_string($lang) ? (self::COPY[$lang] ?? []) : []) + self::COPY['en'];
    }

    /** @return array{title: string, body: string, tag: string} */
    public static function restTimer(mixed $lang): array
    {
        $c = self::copy($lang);

        return ['title' => $c['restTitle'], 'body' => $c['restBody'], 'tag' => 'rest-timer'];
    }

    /** `$appName` is RP_NAME — what this server calls itself — so the test looks like a real alert. */
    public static function test(mixed $lang, string $appName): array
    {
        return ['title' => $appName, 'body' => self::copy($lang)['testBody'], 'tag' => 'test'];
    }

    /** @param  object|null  $routine  the planned routine (its `emoji` and `name`), or null */
    public static function dayReminder(mixed $lang, ?object $routine): array
    {
        $c = self::copy($lang);
        $title = $routine
            // `${routine.name}`: a name missing altogether is written "undefined", as Node wrote it.
            ? (Js::truthy($routine->emoji ?? null) ? Js::string($routine->emoji) : '🏋️').' '
                .(property_exists($routine, 'name') ? Js::string($routine->name) : 'undefined').' '.$c['dayRoutineSuffix']
            : $c['dayFallbackTitle'];

        return ['title' => $title, 'body' => $c['dayBody'], 'tag' => 'day-reminder'];
    }

    /** Once a week; the tag replaces the one before on the device rather than stacking. */
    public static function checkinReminder(mixed $lang): array
    {
        $c = self::copy($lang);

        return ['title' => $c['checkinTitle'], 'body' => $c['checkinBody'], 'tag' => 'checkin-reminder'];
    }

    /** Someone asked to train with this coach (CHW-337) — in the COACH's language. */
    public static function joinRequest(mixed $lang, string $name, string $appName): array
    {
        return ['title' => $appName, 'body' => str_replace('{0}', $name, self::copy($lang)['joinRequestBody']), 'tag' => 'join-request'];
    }

    /** A page that accepts every request took someone on (CHW-338) — in the COACH's language. */
    public static function joinAuto(mixed $lang, string $name, string $appName): array
    {
        return ['title' => $appName, 'body' => str_replace('{0}', $name, self::copy($lang)['joinAutoBody']), 'tag' => 'join-auto'];
    }

    /** A coach sent this member a program — in the MEMBER's language. */
    public static function assignment(mixed $lang, string $coachName, string $appName): array
    {
        return ['title' => $appName, 'body' => str_replace('{0}', $coachName, self::copy($lang)['assignmentBody']), 'tag' => 'assignment'];
    }
}
