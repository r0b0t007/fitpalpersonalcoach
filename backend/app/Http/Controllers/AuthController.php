<?php

namespace App\Http\Controllers;

use App\Auth\SessionToken;
use App\Models\User;
use App\Support\Json;
use App\Support\Say;
use App\WebAuthn\AssertionValidator;
use App\WebAuthn\AttestationCreator;
use App\WebAuthn\AttestationValidator;
use App\WebAuthn\CacheChallengeRepository;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Laragear\WebAuthn\Assertion\Creator\AssertionCreation;
use Laragear\WebAuthn\Assertion\Creator\AssertionCreator;
use Laragear\WebAuthn\Assertion\Validator\AssertionValidation;
use Laragear\WebAuthn\Attestation\Creator\AttestationCreation;
use Laragear\WebAuthn\Attestation\Validator\AttestationValidation;
use Laragear\WebAuthn\Contracts\WebAuthnException;
use Laragear\WebAuthn\Enums\ResidentKey;
use Laragear\WebAuthn\Enums\UserVerification;
use Laragear\WebAuthn\Exceptions\AttestationException;
use Laragear\WebAuthn\JsonTransport;
use Laragear\WebAuthn\Models\WebAuthnCredential;
use Throwable;

/**
 * Passkeys and the session, on the four routes the React app calls with the shapes it sends
 * (frontend/src/lib/api.js). Registration creates the account inside the ceremony: options takes
 * a name, verify writes the user and the credential together, so an account can never exist
 * without a way to sign in to it.
 *
 * Invite codes, INVITE_ONLY and coach binding land here in R2; the licence cap in R4.
 */
final class AuthController
{
    public function __construct(private readonly Cache $cache) {}

    public function registerOptions(Request $request): JsonResponse
    {
        $name = mb_substr(trim((string) $request->input('name', '')), 0, 40);
        if ($name === '') {
            return Json::error(400, 'name required');
        }
        $code = strtoupper(trim((string) $request->input('code', '')));

        // An unsaved account, so the ceremony has a user to describe and a handle to issue.
        $user = new User(['id' => User::newId(), 'name' => $name]);
        $request->attributes->set(CacheChallengeRepository::EXTRA_ATTRIBUTE, ['uid' => $user->id, 'name' => $name, 'code' => $code]);

        $creation = app(AttestationCreator::class)
            ->send(new AttestationCreation(user: $user, residentKey: ResidentKey::Required, userVerification: UserVerification::Preferred, uniqueCredentials: false))
            ->thenReturn();

        return Json::ok(['cid' => $request->attributes->get(CacheChallengeRepository::CID_ATTRIBUTE), 'options' => $creation->json->toArray()]);
    }

    public function registerVerify(Request $request, AttestationValidator $validator): JsonResponse
    {
        // Spent now, whatever the body turns out to be: one challenge, one attempt.
        $entry = CacheChallengeRepository::takeFor($this->cache, $request, self::str($request, 'cid'));
        if ($entry === null || empty($entry['extra']['uid'])) {
            return Json::error(400, 'challenge expired — try again');
        }
        $user = new User(['id' => $entry['extra']['uid'], 'name' => $entry['extra']['name']]);

        try {
            $validation = $validator->send(new AttestationValidation($user, self::transport($request, AttestationValidation::REQUEST_KEYS)))->thenReturn();
        } catch (Throwable $e) {
            if ($e instanceof AttestationException && str_contains($e->getMessage(), 'Credential ID already exists')) {
                return Json::error(409, 'credential already registered');
            }

            return Json::error(400, self::verifyError($e));
        }

        // One transaction: an account without a passkey could never be signed in to.
        DB::transaction(function () use ($user, $validation) {
            $user->save();
            $credential = $validation->credential;
            $credential->authenticatable_id = $user->id;
            $credential->save();
        });

        return Json::ok(['user' => $user->toPublic()], cookies: SessionToken::cookies($user));
    }

    public function loginOptions(Request $request, AssertionCreator $creator): JsonResponse
    {
        // Discoverable credentials: no user and no allowCredentials, the authenticator picks.
        $creation = $creator->send(new AssertionCreation(userVerification: UserVerification::Preferred))->thenReturn();

        return Json::ok(['cid' => $request->attributes->get(CacheChallengeRepository::CID_ATTRIBUTE), 'options' => $creation->json->toArray()]);
    }

    public function loginVerify(Request $request): JsonResponse
    {
        // Spent now, whatever the body turns out to be: one challenge, one attempt.
        if (CacheChallengeRepository::takeFor($this->cache, $request, self::str($request, 'cid')) === null) {
            return Json::error(400, 'challenge expired — try again');
        }
        $credential = WebAuthnCredential::query()->find(self::str($request, 'credential.id'));
        if ($credential === null) {
            return Json::error(404, 'unknown passkey — create a profile first');
        }

        try {
            $validation = app(AssertionValidator::class)
                ->send(new AssertionValidation(self::transport($request, AssertionValidation::REQUEST_KEYS)))
                ->thenReturn();
        } catch (Throwable $e) {
            return Json::error(400, self::verifyError($e));
        }

        /** @var User|null $user */
        $user = $validation->credential->authenticatable;
        if ($user === null) {
            return Json::error(500, 'user missing');
        }
        if ($user->disabled) {
            return Json::error(403, 'this account has been disabled');
        }

        return Json::ok(['user' => $user->toPublic()], cookies: SessionToken::cookies($user));
    }

    public function logout(): JsonResponse
    {
        return Json::ok(['ok' => true], cookies: SessionToken::clearCookies());
    }

    public function logoutAll(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $user->sv = (int) $user->sv + 1;
        $user->save();

        return Json::ok(['ok' => true], cookies: SessionToken::clearCookies());
    }

    public function me(Request $request): JsonResponse
    {
        return Json::ok(['user' => $request->user()->toPublic()]);
    }

    /** A string input, or '' — an array where a string belongs is a refusal, not a warning. */
    private static function str(Request $request, string $key): string
    {
        $value = $request->input($key);

        return is_string($value) ? $value : '';
    }

    /**
     * The credential the app nests under `credential`, as the transport the package's
     * validations read (fromRequest would look at the request's top level).
     */
    private static function transport(Request $request, array $keys): JsonTransport
    {
        $credential = $request->input('credential');

        return new JsonTransport(is_array($credential) ? array_intersect_key($credential, array_flip($keys)) : []);
    }

    /**
     * The package's sentences that mean RP_ID or ORIGIN is wrong for the address the app was
     * opened at (api/verify-error.js matched @simplewebauthn's three the same way). Not "empty
     * origin": that is a malformed response, not a deployment mistake.
     */
    private const MISCONFIGURED = '/different Relying Party ID hash|origin not allowed for this app|origin not made from a secure server|origin is not the configured ORIGIN/i';

    /**
     * What the app shows when a ceremony fails. An RP ID or origin mismatch is a deployment
     * mistake and says so, with the two values to check; any other refusal is the library's
     * reason. A credential so malformed that it blew up inside the package (a null field, a
     * missing id) is not a refusal with a reason: it gets one fixed word, as the Node API's
     * blanket catch answered 400 for those too. Both sentences are translation keys the app
     * already carries.
     */
    private static function verifyError(Throwable $e): string
    {
        if (! $e instanceof WebAuthnException) {
            return Say::f('verification failed: {0}', 'malformed credential');
        }
        $msg = $e->getMessage() ?: 'verification failed';
        if (preg_match(self::MISCONFIGURED, $msg)) {
            return Say::f('{0} — this server is configured with RP_ID={1} and ORIGIN={2}, and both must match the address you opened. See docs/SELF_HOSTING.md.', $msg, config('fitpal.rp_id'), config('fitpal.origin'));
        }

        return Say::f('verification failed: {0}', $msg);
    }
}
