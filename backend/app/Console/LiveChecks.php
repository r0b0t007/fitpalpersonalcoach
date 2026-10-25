<?php

namespace App\Console;

use App\Auth\SessionToken;
use App\Models\PushSubscription;
use App\Push\Vapid;
use Throwable;

/**
 * The settings a live instance cannot get wrong without a word, checked one way for both readers:
 * fitpal:check-config names them, and fitpal:import-legacy refuses on them in production — at the
 * cutover, where each passkey keeps the RP_ID it was imported under (a rerun only moves its
 * counter), so what the import gets wrong stays wrong.
 */
final class LiveChecks
{
    /**
     * Passkeys answer only for RP_ID, which must be ORIGIN's host — or, for a new registration, a
     * parent of it. `$exact` asks for the host itself: what the import needs, since the Node API
     * registered every passkey under exactly that and the authenticator answers for nothing else.
     * On a live instance ORIGIN is also https (SessionToken::secure: the `__Host-` cookie, and
     * WebAuthn wants it) and not a loopback address.
     *
     * @return list<string>
     */
    public static function origin(bool $live, bool $exact = false): array
    {
        $rp = strtolower((string) config('fitpal.rp_id'));
        $origin = (string) config('fitpal.origin');
        $host = strtolower((string) parse_url($origin, PHP_URL_HOST));
        $out = [];
        if ($exact ? $host !== $rp : ($host === '' || ($host !== $rp && ! str_ends_with($host, '.'.$rp)))) {
            $out[] = $exact
                ? "RP_ID ($rp) is not the host of ORIGIN ($origin) — the passkeys being imported were registered under the address the app is opened at, and answer for nothing else."
                : "RP_ID ($rp) is not the host of ORIGIN ($origin), nor a parent domain of it — every passkey registration and sign-in fails.";
        }
        if ($live && (self::loopback($rp) || self::loopback($host))) {
            $out[] = 'RP_ID or ORIGIN is still a local address on a live instance — set both to the address the app is opened at (RP_ID=coach.fitpal.ma, ORIGIN=https://coach.fitpal.ma).';
        } elseif ($live && ! SessionToken::secure()) {
            $out[] = "ORIGIN ($origin) is not https — passkeys need it, and the session cookie would change name, signing everyone out.";
        }

        return $out;
    }

    /**
     * The Node API's secret signed every session and every paired phone's token, and keeps
     * signing them only as SESSION_SECRET. Compared, never printed.
     *
     * @return list<string>
     */
    public static function secret(string $dir): array
    {
        $secret = @file_get_contents(rtrim($dir, '/\\').DIRECTORY_SEPARATOR.'secret');
        if (! is_string($secret) || trim($secret) === '' || hash_equals(trim($secret), (string) config('fitpal.session_secret'))) {
            return [];
        }

        return ["SESSION_SECRET is not the secret in $dir/secret — every session and paired phone it signed is refused. Copy the file's contents into SESSION_SECRET, or remove the file if the secret was changed on purpose."];
    }

    /**
     * No VAPID pair Vapid could use — none in .env, and no readable one in DATA_DIR/vapid.json —
     * while browsers are subscribed: the first push mints a new pair, and none of them is reached
     * again. Nobody subscribed, nothing to lose.
     *
     * @return list<string>
     */
    public static function vapid(): array
    {
        $dir = rtrim((string) config('fitpal.data_dir'), '/\\');
        if ((string) config('fitpal.vapid.public') !== '' || (string) config('fitpal.vapid.private') !== ''
            || Vapid::read($dir.DIRECTORY_SEPARATOR.'vapid.json') !== null || ! self::hasSubscriptions()) {
            return [];
        }

        return ["no VAPID pair: VAPID_* are unset and DATA_DIR ($dir) holds no usable vapid.json, so a new pair would be minted and no browser already subscribed would receive a push. Point DATA_DIR at the data the subscriptions came from, or set the VAPID keys."];
    }

    private static function loopback(string $host): bool
    {
        $host = trim($host, '[]');

        return in_array($host, ['', 'localhost', '127.0.0.1', '::1'], true) || str_ends_with($host, '.localhost') || str_starts_with($host, '127.');
    }

    private static function hasSubscriptions(): bool
    {
        try {
            return PushSubscription::query()->exists();
        } catch (Throwable) {
            return false;   // no database yet: nothing subscribed to lose
        }
    }
}
