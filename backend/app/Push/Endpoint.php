<?php

namespace App\Push;

use App\Support\ClientSafe;
use App\Support\Js;

/**
 * A push subscription's `endpoint` is a URL this server connects out to, chosen by whoever is
 * signed in — without a check, /api/push/* is a request-forgery lever onto the host's own network.
 * The address rule is enforced at the moment the socket is opened (Sender's guard, against the
 * address actually connected to, so DNS rebinding gains nothing); check() is the cheap check at
 * subscribe time (check()) that turns the common case into a clear refusal instead of a silent non-delivery.
 * Both are api/server.js's (isPrivateAddr, pushEndpointError).
 */
final class Endpoint
{
    /** api/server.js isPrivateAddr: loopback, private, link-local, CGNAT, multicast and reserved. */
    public static function isPrivateAddr(string $ip): bool
    {
        $v = strtolower(trim($ip, '[]'));
        // An IPv6 address judged in its canonical spelling, whoever wrote it: [::ffff:a00:1] is
        // ::ffff:10.0.0.1, and 0:0:0:0:0:0:0:1 is ::1.
        if (str_contains($v, ':') && ($bin = @inet_pton($v)) !== false) {
            $v = (string) inet_ntop($bin);
        }
        if (preg_match('/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/D', $v, $m)) {
            [$a, $b] = [(int) $m[1], (int) $m[2]];

            return $a === 0 || $a === 10 || $a === 127              // this-network, private, loopback
                || ($a === 169 && $b === 254)                       // link-local (cloud metadata)
                || ($a === 172 && $b >= 16 && $b <= 31)             // private
                || ($a === 192 && $b === 168)                       // private
                || ($a === 192 && $b === 0)                         // 192.0.0.0/24, 192.0.2.0/24
                || ($a === 100 && $b >= 64 && $b <= 127)            // CGNAT
                || $a >= 224;                                       // multicast + reserved
        }
        if (preg_match('/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/D', $v, $m)) {
            return self::isPrivateAddr($m[1]);                      // IPv4-mapped IPv6
        }

        return $v === '::' || $v === '::1'                          // unspecified, loopback
            || (bool) preg_match('/^fe[89ab]/', $v)                 // link-local
            || (bool) preg_match('/^f[cd]/', $v);                   // unique local
    }

    /**
     * api/server.js pushEndpointError: refuses an endpoint that may not be stored (400).
     *
     * @throws ClientSafe
     */
    public static function check(mixed $raw): void
    {
        $u = self::parse(Js::truthy($raw) ? Js::string($raw) : '');
        if ($u === null) {
            throw new ClientSafe(400, 'endpoint is not a valid URL');
        }
        if ($u['scheme'] !== 'https') {
            throw new ClientSafe(400, 'endpoint must be an https:// URL');
        }
        if ($u['user'] !== '' || $u['pass'] !== '') {
            throw new ClientSafe(400, 'endpoint must not carry credentials');
        }
        // A literal address is judged here; a name is left to the guard at connect time.
        $host = $u['host'];
        if ((preg_match('/^[0-9.]+$/D', $host) || str_contains($host, ':')) && self::isPrivateAddr($host)) {
            throw new ClientSafe(400, 'endpoint must not point at a private address');
        }
    }

    /**
     * Enough of `new URL(...)` for error(): the scheme, the credentials, and the host as the WHATWG
     * parser leaves it — lower-cased, brackets off an IPv6 literal, and an IPv4 address written as
     * one number, in hex or in octal (`https://2130706433/`, `https://0x7f.1/`) normalised to
     * dotted decimal, so that spelling 127.0.0.1 differently does not walk past the private check.
     * Null where `new URL` would throw.
     *
     * @return array{scheme: string, user: string, pass: string, host: string}|null
     */
    private static function parse(string $url): ?array
    {
        $url = Js::trim($url);
        if (! preg_match('/^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/sD', $url, $m)) {
            return null;
        }
        $scheme = strtolower($m[1]);
        if (! in_array($scheme, ['https', 'http', 'ws', 'wss', 'ftp', 'file'], true)) {
            // Not a special scheme: any such string is a URL (mailto:x, data:…), never https.
            return ['scheme' => $scheme, 'user' => '', 'pass' => '', 'host' => ''];
        }
        $p = parse_url(preg_replace('/^[^:]+:[\\\\\/]*/', $scheme.'://', $url));
        if (! is_array($p) || ! isset($p['host']) || $p['host'] === '') {
            return $scheme === 'file' ? ['scheme' => 'file', 'user' => '', 'pass' => '', 'host' => ''] : null;
        }
        $host = strtolower(rawurldecode($p['host']));
        if (str_starts_with($host, '[')) {
            $host = trim($host, '[]');
            if (filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
                return null;
            }
            // Canonical, as the WHATWG parser writes it: [0:0:0:0:0:0:0:1] is ::1.
            $host = (string) inet_ntop((string) inet_pton($host));
        } elseif (($v4 = self::ipv4($host)) !== false) {
            if ($v4 === null) {
                return null;   // ends in a number but is no address: `new URL` refuses it
            }
            $host = $v4;
        }

        return ['scheme' => $scheme, 'user' => $p['user'] ?? '', 'pass' => $p['pass'] ?? '', 'host' => $host];
    }

    /**
     * The WHATWG IPv4 parser: false when the host is a name (its last label is not numeric), null
     * when it looks like an address but is not one, otherwise the dotted-decimal form.
     */
    private static function ipv4(string $host): string|false|null
    {
        $parts = explode('.', $host);
        if (end($parts) === '' && count($parts) > 1) {
            array_pop($parts);
        }
        $last = end($parts);
        if (! preg_match('/^(0[xX][0-9a-fA-F]*|[0-9]+)$/D', (string) $last)) {
            return false;
        }
        if (count($parts) > 4) {
            return null;
        }
        $nums = [];
        foreach ($parts as $part) {
            if (preg_match('/^0[xX]([0-9a-fA-F]*)$/D', $part, $m)) {
                $n = $m[1] === '' ? 0 : hexdec($m[1]);
            } elseif (preg_match('/^0([0-7]+)$/D', $part, $m)) {
                $n = octdec($m[1]);
            } elseif (preg_match('/^[0-9]+$/D', $part)) {
                $n = (float) $part;
            } else {
                return null;
            }
            $nums[] = $n;
        }
        $lastN = array_pop($nums);
        foreach ($nums as $n) {
            if ($n > 255) {
                return null;
            }
        }
        if ($lastN >= 256 ** (4 - count($nums))) {
            return null;
        }
        $ip = $lastN;
        foreach ($nums as $i => $n) {
            $ip += $n * 256 ** (3 - $i);
        }
        $ip = (int) $ip;

        return implode('.', [($ip >> 24) & 255, ($ip >> 16) & 255, ($ip >> 8) & 255, $ip & 255]);
    }
}
