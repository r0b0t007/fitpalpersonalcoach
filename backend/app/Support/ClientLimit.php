<?php

namespace App\Support;

use App\Audit\ClientIp;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;

/**
 * A rate limit on an unauthenticated route, in two buckets: the client as forwarded
 * (CF-Connecting-IP — Cloudflare fronts production, so the socket peer is its edge), and the
 * connection itself, generous because every coach behind one edge shares it. The forwarded address
 * alone could be forged by a caller reaching the server directly, a new one each request.
 */
final class ClientLimit
{
    /** True when either bucket is full; otherwise the attempt is counted in both. */
    public static function over(Request $request, string $name, int $perClient, int $perConnection, int $decaySeconds): bool
    {
        $buckets = [
            "{$name}:client:".(ClientIp::for($request, 'full') ?? (string) $request->ip()) => $perClient,
            "{$name}:peer:".$request->server('REMOTE_ADDR') => $perConnection,
        ];
        foreach ($buckets as $key => $max) {
            if (RateLimiter::tooManyAttempts($key, $max)) {
                return true;
            }
        }
        foreach (array_keys($buckets) as $key) {
            RateLimiter::hit($key, $decaySeconds);
        }

        return false;
    }
}
