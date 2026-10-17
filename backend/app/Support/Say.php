<?php

namespace App\Support;

/**
 * The error envelope the app translates.
 *
 * The React app shows server refusals in the user's language by using the English sentence as the
 * translation key (frontend/src/lib/server-messages.js). A sentence with a value in it cannot be a
 * key, so it is built from a template: Say::f('that exercise already has {0} videos', 6) returns
 * the English text and remembers the template and values. Say::envelope() then adds
 * `msg: {k, v}` beside `error`, exactly as the Node API's json() did, and the app translates the
 * template. The English error strings must stay byte-identical to the Node API's: they are the
 * keys in frontend/src/locales/{fr,es,de}.js.
 */
final class Say
{
    /** @var array<string, array{k: string, v: list<scalar>}> text => template, newest 200 kept */
    private static array $said = [];

    /** A sentence with values filled in, remembered so the envelope can carry its template. */
    public static function f(string $template, int|float|string ...$values): string
    {
        $text = preg_replace_callback(
            '/\{(\d+)\}/',
            static fn (array $m) => array_key_exists((int) $m[1], $values) ? (string) $values[(int) $m[1]] : $m[0],
            $template,
        );
        // Re-saying moves a sentence to the newest end, so under a long-lived worker the oldest
        // UNUSED one is what goes; unset by key rather than array_shift, which would renumber a
        // purely numeric sentence out of reach.
        unset(self::$said[$text]);
        self::$said[$text] = ['k' => $template, 'v' => array_values($values)];
        if (count(self::$said) > 200) {
            unset(self::$said[array_key_first(self::$said)]);
        }

        return $text;
    }

    /** The template behind a sentence, if Say::f built it. */
    public static function saidAs(string $text): ?array
    {
        return self::$said[$text] ?? null;
    }

    /** `{error, msg?}` plus any other fields, in the shape the app expects. */
    public static function envelope(string $error, array $extra = []): array
    {
        $body = ['error' => $error] + $extra;
        if ($msg = self::saidAs($error)) {
            $body['msg'] = $msg;
        }

        return $body;
    }
}
