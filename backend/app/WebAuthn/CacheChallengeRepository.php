<?php

namespace App\WebAuthn;

use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Http\Request;
use Laragear\WebAuthn\Assertion\Creator\AssertionCreation;
use Laragear\WebAuthn\Assertion\Validator\AssertionValidation;
use Laragear\WebAuthn\Attestation\Creator\AttestationCreation;
use Laragear\WebAuthn\Attestation\Validator\AttestationValidation;
use Laragear\WebAuthn\Challenge\Challenge;
use Laragear\WebAuthn\Contracts\WebAuthnChallengeRepository;

/**
 * Challenges keyed by a `cid` the app carries between the two calls of a ceremony, instead of
 * the session the package assumes. The API has no session: the options call answers `{cid,
 * options}`, the verify call posts `{cid, credential}`. Each entry lives five minutes and is
 * taken on first read, so a challenge can be used once (the Node API's challenge store).
 *
 * Beside the challenge the entry keeps what the ceremony was started with (the new account's
 * name, id and invite code), so verify does not trust the client for any of it.
 */
final class CacheChallengeRepository implements WebAuthnChallengeRepository
{
    public const TTL = 300;

    public const CID_ATTRIBUTE = 'webauthn.cid';

    public const EXTRA_ATTRIBUTE = 'webauthn.extra';

    public function __construct(private readonly Cache $cache, private readonly Request $request) {}

    public function store(AttestationCreation|AssertionCreation $ceremony, Challenge $challenge): void
    {
        $cid = rtrim(strtr(base64_encode(random_bytes(16)), '+/', '-_'), '=');
        $this->cache->put(self::key($cid), [
            'challenge' => $challenge->toArray(),
            'extra' => $this->request->attributes->get(self::EXTRA_ATTRIBUTE, []),
        ], self::TTL);
        $this->request->attributes->set(self::CID_ATTRIBUTE, $cid);
    }

    public function pull(AttestationValidation|AssertionValidation $ceremony): ?Challenge
    {
        $entry = self::take($this->cache, (string) $this->request->input('cid'));
        if ($entry === null) {
            return null;
        }
        $challenge = Challenge::fromArray($entry['challenge']);

        return $challenge->isValid() ? $challenge : null;
    }

    /** Reads an entry without taking it, for the controller to know whose ceremony this is. */
    public static function peek(Cache $cache, string $cid): ?array
    {
        $entry = $cid !== '' ? $cache->get(self::key($cid)) : null;

        return is_array($entry) ? $entry : null;
    }

    public static function take(Cache $cache, string $cid): ?array
    {
        $entry = $cid !== '' ? $cache->pull(self::key($cid)) : null;

        return is_array($entry) ? $entry : null;
    }

    private static function key(string $cid): string
    {
        return 'webauthn:'.$cid;
    }
}
