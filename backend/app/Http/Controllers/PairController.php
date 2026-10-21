<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Auth\SessionToken;
use App\Models\User;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Pairing the Android app with an account (api/server.js pair/create, pair/redeem). The browser,
 * signed in, asks for a short code; the phone types it and gets back the session token it keeps as
 * a Bearer header. The code is the credential: one use, five minutes, like a WebAuthn challenge.
 */
final class PairController
{
    /** Node's alphabet: no 0/O or 1/I, since the code is read off one screen and typed on another. 32 letters, so b % 32 is unbiased. */
    public const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    public const LENGTH = 8;

    public const TTL = 300;

    public function __construct(private readonly Cache $cache) {}

    public function create(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        // add() writes only if the key is free, atomically: two people can never be handed the
        // same live code (has-then-put could, under concurrency).
        do {
            $code = self::newCode();
        } while (! $this->cache->add(self::key($code), $user->id, self::TTL));
        Audit::record($request, 'auth.pair.create', ['user' => $user]);

        return Json::ok(['code' => $code]);
    }

    public function redeem(Request $request): JsonResponse
    {
        // `String(body.code || '').trim().toUpperCase()`, on the body as sent.
        $code = mb_strtoupper(Js::trim(Input::jsString($request, 'code')));
        // Taken on first sight, whatever happens next: a code works once. pull() is a get then a
        // forget, so two phones racing the same code could both read it; the lock makes the claim
        // atomic, and the loser of the race is refused like any spent code.
        $uid = $code === '' ? null : $this->cache->lock('pair:claim:'.$code, 10)->get(fn () => $this->cache->pull(self::key($code)));
        if (! is_string($uid)) {
            Audit::record($request, 'auth.pair.fail', ['ok' => false, 'msg' => 'code-invalid']);

            return Json::error(400, 'invalid or expired code');
        }
        $user = User::query()->find($uid);
        if ($user === null || $user->disabled) {
            Audit::record($request, 'auth.pair.fail', ['ok' => false, 'uid' => $uid, 'msg' => 'user-unavailable']);

            return Json::error(400, 'invalid or expired code');
        }
        Audit::record($request, 'auth.pair.ok', ['user' => $user]);

        // The whole public user, not a subset: the phone picks its shell from `coach` (frontend
        // lib/role.js) and keeps this object for every offline start after pairing.
        return Json::ok(['token' => SessionToken::make($user), 'user' => $user->toPublic()]);
    }

    public static function newCode(): string
    {
        $out = '';
        foreach (str_split(random_bytes(self::LENGTH)) as $b) {
            $out .= self::ALPHABET[ord($b) % strlen(self::ALPHABET)];
        }

        return $out;
    }

    private static function key(string $code): string
    {
        return 'pair:'.$code;
    }
}
