<?php

namespace App\Console;

use App\Auth\SessionToken;
use App\Models\PushSubscription;
use App\Push\Vapid;
use Laragear\WebAuthn\Models\WebAuthnCredential;
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
     * ORIGIN is compared with the browser's origin character for character (CheckOriginExact), so
     * it must be written as a browser sends it: lower-case scheme and host, no path. RP_ID must be
     * ORIGIN's host — or, for a new registration, a parent of it (not a bare top-level label,
     * which browsers refuse). `$exact` asks for the host itself: what the import needs, since the
     * Node API registered every passkey under exactly that and the authenticator answers for
     * nothing else. On a live instance ORIGIN is also https (SessionToken::secure: the `__Host-`
     * cookie, and WebAuthn wants it) and not a loopback address.
     *
     * @return list<string>
     */
    public static function origin(bool $live, bool $exact = false): array
    {
        $rp = (string) config('fitpal.rp_id');
        $origin = (string) config('fitpal.origin');
        $parts = parse_url($origin) ?: [];
        $host = (string) ($parts['host'] ?? '');
        $out = [];
        $sent = strtolower((string) ($parts['scheme'] ?? '')).'://'.strtolower($host).(isset($parts['port']) ? ':'.$parts['port'] : '');
        if ($host === '' || $origin !== $sent) {
            $out[] = "ORIGIN ($origin) is not written as a browser sends it ($sent) — passkeys compare it character for character, so every registration and sign-in fails.";
        }
        $parent = ! $exact && str_ends_with($host, '.'.$rp) && ($rp === 'localhost' || str_contains($rp, '.'));
        if ($rp !== $host && ! $parent) {
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
     * Passkeys already here that RP_ID no longer reaches: each answers only for the RP_ID it was
     * registered or imported under, so a later change of RP_ID — even to a valid parent domain —
     * locks their owners out. Compared in PHP, not SQL: a collation must not decide it.
     *
     * @param  list<string>|null  $ids  only these accounts' passkeys (null: all)
     * @return array<string, string> account id => the rp_id one of its passkeys is bound to
     */
    public static function strandedPasskeys(?array $ids = null): array
    {
        $rp = (string) config('fitpal.rp_id');
        $out = [];
        foreach (WebAuthnCredential::query()->toBase()->select(['authenticatable_id', 'rp_id'])->distinct()->cursor() as $c) {
            if ($c->rp_id !== $rp && ($ids === null || in_array($c->authenticatable_id, $ids, true))) {
                $out[(string) $c->authenticatable_id] = (string) $c->rp_id;
            }
        }

        return $out;
    }

    /**
     * The Node API's secret signed every session and every paired phone's token, and keeps
     * signing them only as SESSION_SECRET. Compared, never printed. `$required`: the file must
     * be there and readable (the import, reading Node's own data dir) — else a secret it cannot
     * see is a secret it cannot check.
     *
     * @return list<string>
     */
    public static function secret(string $dir, bool $required = false): array
    {
        $file = rtrim($dir, '/\\').DIRECTORY_SEPARATOR.'secret';
        $secret = @file_get_contents($file);
        if (! is_string($secret) || trim($secret) === '') {
            return $required ? ["cannot read the Node API's secret ($file) — without it, SESSION_SECRET cannot be checked, and a wrong one signs everyone out. Make it readable by this user."] : [];
        }
        if (! hash_equals(trim($secret), (string) config('fitpal.session_secret'))) {
            return ["SESSION_SECRET is not the secret in $file — every session and paired phone it signed is refused. Copy the file's contents into SESSION_SECRET, or remove the file if the secret was changed on purpose."];
        }

        return [];
    }

    /**
     * No VAPID pair Vapid could use — none in .env, and no readable one in DATA_DIR/vapid.json —
     * while browsers are subscribed: the first push mints a new pair, and none of them is reached
     * again. Nobody subscribed, nothing to lose; a database that cannot be read is said as such.
     *
     * @return list<string>
     */
    public static function vapid(): array
    {
        $dir = rtrim((string) config('fitpal.data_dir'), '/\\');
        if ((string) config('fitpal.vapid.public') !== '' || (string) config('fitpal.vapid.private') !== ''
            || Vapid::read($dir.DIRECTORY_SEPARATOR.'vapid.json') !== null) {
            return [];
        }
        try {
            $subscribed = PushSubscription::query()->exists();
        } catch (Throwable $e) {
            return ['cannot read the database to check push subscriptions ('.$e->getMessage().') — and DATA_DIR holds no usable vapid.json, so if any browser is subscribed, the first push strands it.'];
        }

        return $subscribed ? ["no VAPID pair: VAPID_* are unset and DATA_DIR ($dir) holds no usable vapid.json, so a new pair would be minted and no browser already subscribed would receive a push. Point DATA_DIR at the data the subscriptions came from, or set the VAPID keys."] : [];
    }

    private static function loopback(string $host): bool
    {
        $host = strtolower(trim($host, '[]'));

        return in_array($host, ['', 'localhost', '::1'], true) || str_ends_with($host, '.localhost') || str_starts_with($host, '127.');
    }
}
