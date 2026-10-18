<?php

// AUDIT_IP, case for case with the Node API's clientIp (api/server.js).

use App\Audit\ClientIp;
use Illuminate\Http\Request;

it('reduces an address the way each mode says', function (string $raw, string $mode, ?string $want) {
    expect(ClientIp::reduce($raw, $mode))->toBe($want);
})->with([
    'off keeps nothing' => ['203.0.113.7', 'off', null],
    'full keeps the address' => ['203.0.113.7', 'full', '203.0.113.7'],
    'net keeps an IPv4 /24' => ['203.0.113.7', 'net', '203.0.113.0/24'],
    'net keeps an IPv6 /48' => ['2001:db8:1:2:3::7', 'net', '2001:db8:1::/48'],
    'brackets are stripped' => ['[2001:db8::1]', 'full', '2001:db8::1'],
    'a header is never stored verbatim' => ['<script>', 'full', null],
    'nor a hostname' => ['proxy.example', 'full', null],
    'too short to be an address' => ['1.', 'full', null],
]);

it('takes the address from the headers in Node\'s order, then the socket', function () {
    $req = fn (array $headers, string $remote = '10.0.0.9') => Request::create('/api/x', 'GET', server: ['REMOTE_ADDR' => $remote] + collect($headers)->mapWithKeys(fn ($v, $k) => ['HTTP_'.strtoupper(str_replace('-', '_', $k)) => $v])->all());

    expect(ClientIp::for($req(['CF-Connecting-IP' => '198.51.100.1', 'X-Forwarded-For' => '192.0.2.1']), 'full'))->toBe('198.51.100.1')
        ->and(ClientIp::for($req(['X-Forwarded-For' => '192.0.2.1, 10.0.0.1']), 'full'))->toBe('192.0.2.1')
        ->and(ClientIp::for($req(['X-Real-IP' => '192.0.2.5']), 'full'))->toBe('192.0.2.5')
        ->and(ClientIp::for($req([], '::ffff:192.0.2.9'), 'full'))->toBe('192.0.2.9')
        ->and(ClientIp::for($req(['CF-Connecting-IP' => '198.51.100.1']), 'off'))->toBeNull();
});

it('refuses an address with a trailing newline, as JavaScript\'s $ would', function () {
    expect(ClientIp::reduce("1.2.3.4\n", 'full'))->toBeNull()
        ->and(ClientIp::reduce("1.2.3.4\n", 'net'))->toBeNull();
});
