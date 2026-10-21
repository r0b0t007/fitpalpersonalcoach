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

    public const TAKEN_ATTRIBUTE = 'webauthn.taken';

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
        // The controller took the entry before starting the pipeline (takeFor), reading the cid
        // where Node read the body. Nothing is read here: without that entry there is no
        // challenge, and the request body is not this pipe's to parse (a ClientSafe thrown inside
        // the package would surface as a malformed credential, not as `bad json`).
        $entry = $this->request->attributes->get(self::TAKEN_ATTRIBUTE);
        if (! is_array($entry)) {
            return null;
        }
        $challenge = Challenge::fromArray($entry['challenge']);

        return $challenge->isValid() ? $challenge : null;
    }

    /**
     * Takes the entry out of the cache for this request's ceremony, so the challenge is spent on
     * first use whatever happens next: a body too malformed to reach the pipeline's own
     * RetrieveChallenge must not leave it replayable (the Node API's takeChallenge).
     */
    public static function takeFor(Cache $cache, Request $request, string $cid): ?array
    {
        $entry = self::take($cache, $cid);
        if ($entry !== null) {
            $request->attributes->set(self::TAKEN_ATTRIBUTE, $entry);
        }

        return $entry;
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
