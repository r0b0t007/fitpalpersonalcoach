<?php

namespace App\Billing;

use App\Support\ClientSafe;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Creem's REST API (https://docs.creem.io/api-reference), the two calls the app makes: a checkout
 * session for a plan, and a customer-portal link. On Laravel's Http client, so tests fake it.
 *
 * The key goes in the `x-api-key` header and nowhere else: never logged, never in an error. Test
 * and live are separate stores with separate keys and hosts — a `creem_test_` key against the
 * live host is a 401 — so the host follows the key unless CREEM_API_BASE says otherwise.
 *
 * Anything but a 2xx carrying what the caller needs is the one 502 the app shows: the coach can
 * only try again, and what went wrong is logged for the owner (status and Creem's error, no key).
 */
final class Creem
{
    public const TEST_BASE = 'https://test-api.creem.io';

    public const LIVE_BASE = 'https://api.creem.io';

    /** Seconds. A checkout is a click the coach is waiting on; Creem answers in well under this. */
    public const TIMEOUT = 15;

    public static function base(): string
    {
        $base = (string) config('fitpal.creem.api_base');
        if ($base !== '') {
            return $base;
        }

        return str_starts_with((string) config('fitpal.creem.api_key'), 'creem_test_') ? self::TEST_BASE : self::LIVE_BASE;
    }

    /** For fitpal:check-config: a CREEM_API_BASE pointing at the other store from the key's. */
    public static function problems(): array
    {
        $key = (string) config('fitpal.creem.api_key');
        $base = (string) config('fitpal.creem.api_base');
        $test = str_starts_with($key, 'creem_test_');
        if ($key === '' || $base === '' || $base === ($test ? self::TEST_BASE : self::LIVE_BASE)) {
            return [];
        }
        if ($base === ($test ? self::LIVE_BASE : self::TEST_BASE)) {
            return ['CREEM_API_BASE is '.$base.' but CREEM_API_KEY is a '.($test ? 'test' : 'live').' key — every Creem call will be refused (401). Leave CREEM_API_BASE empty: the host follows the key.'];
        }

        return [];
    }

    /**
     * POST /v1/checkouts. $body is Creem's request as documented (product_id, request_id,
     * success_url, metadata, customer). Returns the session's id and the URL to send the coach to.
     *
     * @return array{id: string, url: string}
     */
    public static function checkout(array $body): array
    {
        $json = self::send('checkout', fn (PendingRequest $http) => $http->post('/v1/checkouts', $body));
        if (! is_string($json['id'] ?? null) || ! is_string($json['checkout_url'] ?? null) || ! str_starts_with($json['checkout_url'], 'https://')) {
            self::fail('checkout', 'no id or checkout_url in the answer');
        }

        return ['id' => $json['id'], 'url' => $json['checkout_url']];
    }

    /** POST /v1/customers/billing — the portal where the coach changes plan, card, or cancels. */
    public static function portal(string $customerId): string
    {
        $json = self::send('portal', fn (PendingRequest $http) => $http->post('/v1/customers/billing', ['customer_id' => $customerId]));
        $url = $json['customer_portal_link'] ?? null;
        if (! is_string($url) || ! str_starts_with($url, 'https://')) {
            self::fail('portal', 'no customer_portal_link in the answer');
        }

        return $url;
    }

    /** @param  callable(PendingRequest): Response  $call */
    private static function send(string $what, callable $call): array
    {
        $http = Http::baseUrl(self::base())
            ->withHeaders(['x-api-key' => (string) config('fitpal.creem.api_key')])
            ->acceptJson()->asJson()
            ->timeout(self::TIMEOUT)->connectTimeout(5)
            // A redirect would carry the key to wherever it points.
            ->withOptions(['allow_redirects' => false]);
        try {
            $response = $call($http);
        } catch (ConnectionException $e) {
            self::fail($what, 'no connection: '.$e->getMessage());
        }
        if (! $response->successful()) {
            // Creem's own error, for the log: a short JSON body, never the request (it has no key,
            // but there is nothing in it the owner needs either).
            self::fail($what, 'HTTP '.$response->status().' '.mb_substr($response->body(), 0, 300));
        }
        $json = $response->json();

        return is_array($json) ? $json : self::fail($what, 'not JSON');
    }

    private static function fail(string $what, string $why): never
    {
        Log::warning("creem {$what} failed", ['why' => $why, 'base' => self::base()]);

        throw new ClientSafe(502, 'the payment service did not answer — try again in a moment');
    }
}
