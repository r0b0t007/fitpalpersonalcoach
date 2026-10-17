<?php

use App\Auth\SessionToken;
use App\Models\User;

beforeEach(fn () => config(['fitpal.session_secret' => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'fitpal.origin' => 'http://localhost:5173']));

it('parses the exact token the Node API and the smoke scripts mint', function () {
    // payload "coachA:1799956562576:0", signed with the hex text of the secret as the raw key.
    $payload = 'coachA:1799956562576:0';
    $mac = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', true)), '+/', '-_'), '=');
    expect(SessionToken::parse($payload.'.'.$mac))->toBe(['uid' => 'coachA', 'exp' => 1799956562576, 'sv' => 0]);
});

it('treats a missing session version as 0 and refuses anything else malformed', function () {
    $sign = fn (string $p) => $p.'.'.rtrim(strtr(base64_encode(hash_hmac('sha256', $p, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', true)), '+/', '-_'), '=');
    expect(SessionToken::parse($sign('u:123'))['sv'])->toBe(0)
        ->and(SessionToken::parse($sign('u:123:x')))->toBeNull()
        ->and(SessionToken::parse($sign(':123:0')))->toBeNull()
        ->and(SessionToken::parse('u:123:0.wrongmac'))->toBeNull()
        ->and(SessionToken::parse(''))->toBeNull()
        ->and(SessionToken::parse(null))->toBeNull();
});

it('names the cookie by the origin scheme', function () {
    expect(SessionToken::cookieName())->toBe('gymsid');
    config(['fitpal.origin' => 'https://coach.fitpal.ma']);
    expect(SessionToken::cookieName())->toBe('__Host-gymsid')->and(SessionToken::clearCookies())->toHaveCount(2);
});

it('signs nothing and trusts nothing without a real secret', function (string $secret) {
    config(['fitpal.session_secret' => $secret]);
    $user = new User(['id' => 'abcdefghijklmnop', 'sv' => 0]);
    // A token made under the empty key by someone who knows the format.
    $payload = 'abcdefghijklmnop:'.(time() * 1000 + 86400000).':0';
    $forged = $payload.'.'.rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, $secret, true)), '+/', '-_'), '=');
    expect(SessionToken::parse($forged))->toBeNull()
        ->and(fn () => SessionToken::make($user))->toThrow(RuntimeException::class);
})->with(['unset' => [''], 'too short' => ['hunter2']]);
