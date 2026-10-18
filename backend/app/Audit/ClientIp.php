<?php

namespace App\Audit;

use Illuminate\Http\Request;

/**
 * How much of the caller's address an audit record keeps (AUDIT_IP), as the Node API's clientIp:
 *
 *  - off  → nothing;
 *  - full → the address;
 *  - net  → an IPv4 /24 (`203.0.113.0/24`) or the first three IPv6 groups (`2001:db8:1::/48`).
 *
 * The address is the first of `CF-Connecting-IP` (Cloudflare fronts production), the first hop of
 * `X-Forwarded-For`, `X-Real-IP`, then the socket peer. Anything that does not look like an
 * address is dropped: a header is never stored verbatim.
 */
final class ClientIp
{
    public static function for(Request $request, string $mode): ?string
    {
        if ($mode === 'off') {
            return null;
        }
        $raw = trim((string) $request->headers->get('CF-Connecting-IP'))
            ?: trim(explode(',', (string) $request->headers->get('X-Forwarded-For'))[0])
            ?: trim((string) $request->headers->get('X-Real-IP'))
            ?: preg_replace('/^::ffff:/', '', trim((string) $request->server('REMOTE_ADDR')));

        return self::reduce((string) $raw, $mode);
    }

    /** The pure part, tested on its own. */
    public static function reduce(string $raw, string $mode): ?string
    {
        if ($mode === 'off') {
            return null;
        }
        // `D`: PCRE's `$` also matches before a trailing newline, JavaScript's does not. Without it
        // "1.2.3.4\n" would pass and be stored, which is exactly the verbatim header this refuses.
        $ip = substr(preg_replace('/^\[|\]$/D', '', $raw), 0, 45);
        if (! preg_match('/^[0-9a-fA-F:.]{3,45}$/D', $ip)) {
            return null;
        }
        if ($mode === 'full') {
            return $ip;
        }
        if (preg_match('/^\d{1,3}(\.\d{1,3}){3}$/D', $ip)) {
            return preg_replace('/\.\d{1,3}$/D', '.0/24', $ip);
        }
        $groups = implode(':', array_slice(array_values(array_filter(explode(':', $ip), 'strlen')), 0, 3));

        return $groups !== '' ? $groups.'::/48' : null;
    }
}
