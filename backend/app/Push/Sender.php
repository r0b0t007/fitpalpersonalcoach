<?php

namespace App\Push;

use App\Models\PushSubscription;
use GuzzleHttp\Client;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Pool;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\ContentEncoding;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;
use Psr\Http\Message\RequestInterface;
use Psr\Http\Message\ResponseInterface;
use Throwable;

/**
 * api/server.js sendPush: one payload to every browser a user subscribed. web-push encrypts and
 * signs each message; the requests go out here, through a client this class controls:
 *
 *  - the guard (Node's guardedLookup): the endpoint's host is resolved HERE, refused if any
 *    address it resolves to is private, and curl is then pinned to exactly those vetted addresses
 *    (CURLOPT_RESOLVE) — it never looks the name up itself, so a name that answers differently the
 *    second time (DNS rebinding) has no second time. A refused endpoint is never connected to, not
 *    even for a TLS hello. No redirects, no proxy, https only;
 *  - TIMEOUT 10 s per request (an endpoint that accepts and stalls), CONCURRENCY 6 at a time;
 *  - urgency high, web-push's default TTL (4 weeks, as Node's library);
 *  - a 404 or 410 means the browser dropped the subscription: the row goes.
 */
class Sender
{
    public const TIMEOUT = 10;

    public const CONCURRENCY = 6;

    /** @param  HandlerStack|null  $handler  a test's transport; production uses curl */
    public function __construct(private readonly ?HandlerStack $handler = null) {}

    /** @param  array{title: string, body: string, tag: string}  $payload */
    public function send(string $userId, array $payload): void
    {
        $subs = PushSubscription::of($userId)->get();
        if ($subs->isEmpty()) {
            return;
        }
        $body = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $builder = new class(['VAPID' => ['subject' => Vapid::subject()] + Vapid::keys()], ['urgency' => 'high'], new Client) extends WebPush
        {
            /** web-push's encrypted, signed request for one subscription. */
            public function request(Subscription $sub, string $body): RequestInterface
            {
                $this->queueNotification($sub, $body);
                $queued = $this->notifications;
                $this->notifications = [];

                return $this->prepare($queued)[0];
            }
        };
        $client = $this->client();
        $sends = [];
        foreach ($subs as $sub) {
            try {
                $pin = $this->pin($sub->endpoint);
                if ($pin === null) {
                    Log::warning('push not sent: the endpoint resolves to a private address, or to nothing', ['user' => $userId]);

                    continue;
                }
                $request = $builder->request(new Subscription($sub->endpoint, $sub->p256dh, $sub->auth, ContentEncoding::aes128gcm), $body);
                // Per request, all of it: a request's `curl` replaces the client's, it is not merged.
                $curl = [CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_NOPROXY => '*'] + ($pin === [] ? [] : [CURLOPT_RESOLVE => $pin]);
                $sends[$sub->id] = fn () => $client->sendAsync($request, ['curl' => $curl]);
            } catch (Throwable $e) {
                // Keys a browser would never have made: that one is skipped, as Node's send threw.
                Log::warning('push send failed', ['user' => $userId, 'error' => $e->getMessage()]);
            }
        }
        $gone = [];
        (new Pool($client, (fn () => yield from $sends)(), [
            'concurrency' => self::CONCURRENCY,
            'fulfilled' => function (ResponseInterface $res, int $id) use (&$gone, $userId): void {
                $status = $res->getStatusCode();
                if ($status === 404 || $status === 410) {
                    $gone[] = $id;
                }
                if ($status >= 400) {
                    Log::warning('push send failed', ['user' => $userId, 'status' => $status, 'body' => mb_substr((string) $res->getBody(), 0, 200)]);
                }
            },
            'rejected' => function (Throwable $e) use ($userId): void {
                Log::warning('push send failed', ['user' => $userId, 'error' => $e->getMessage()]);
            },
        ]))->promise()->wait();
        if ($gone) {
            PushSubscription::query()->whereKey($gone)->delete();
        }
    }

    /**
     * Where curl may connect for this endpoint: `host:port:addr,addr` for a name, [] for an address
     * literal (nothing to look up), null when it must not be sent at all — a private address, a
     * name that resolves to one (any one: an attacker's name may list a public address first), or
     * to nothing.
     *
     * @return list<string>|null
     */
    private function pin(string $endpoint): ?array
    {
        $u = parse_url($endpoint);
        $host = strtolower((string) ($u['host'] ?? ''));
        if ($host === '' || strtolower((string) ($u['scheme'] ?? '')) !== 'https') {
            return null;
        }
        $literal = trim($host, '[]');
        if (filter_var($literal, FILTER_VALIDATE_IP) !== false) {
            return Endpoint::isPrivateAddr($literal) ? null : [];
        }
        $addrs = $this->addresses($host);
        if ($addrs === [] || array_filter($addrs, Endpoint::isPrivateAddr(...)) !== []) {
            return null;
        }
        $v6 = array_map(fn (string $a) => str_contains($a, ':') ? "[$a]" : $a, $addrs);

        return [$host.':'.($u['port'] ?? 443).':'.implode(',', $v6)];
    }

    /** Every address the name resolves to, v4 and v6. A seam for tests: they have no DNS. */
    protected function addresses(string $host): array
    {
        $v4 = gethostbynamel($host) ?: [];
        $v6 = array_column(@dns_get_record($host, DNS_AAAA) ?: [], 'ipv6');

        return array_values(array_unique([...$v4, ...$v6]));
    }

    private function client(): Client
    {
        $options = [
            'timeout' => self::TIMEOUT,
            'connect_timeout' => self::TIMEOUT,
            'allow_redirects' => false,
            'http_errors' => false,
        ];

        return new Client($options + ($this->handler !== null ? ['handler' => $this->handler] : []));
    }
}
