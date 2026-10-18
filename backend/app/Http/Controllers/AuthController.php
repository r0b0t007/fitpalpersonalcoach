<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Auth\Bootstrap;
use App\Auth\InviteGate;
use App\Auth\SessionToken;
use App\Auth\TokenGuard;
use App\Models\User;
use App\Support\Input;
use App\Support\Json;
use App\Support\Say;
use App\WebAuthn\AssertionValidator;
use App\WebAuthn\AttestationCreator;
use App\WebAuthn\AttestationValidator;
use App\WebAuthn\CacheChallengeRepository;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
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
 * The sign-up gate is here: INVITE_ONLY and the bootstrap code (R1). Invite codes themselves and
 * coach binding arrive in R2 (InviteGate::redeemable is where that lookup lands); the licence cap
 * in R4.
 */
final class AuthController
{
    /**
     * How long the browser shows the passkey prompt: 60 s, as the Node API sent (the
     *
     * @simplewebauthn default). Laragear derives it from the challenge lifetime, which stays at
     * five minutes (CacheChallengeRepository::TTL, Node's challenge store) — the two are different
     * things, and the contract diff caught them sharing one number.
     */
    public const PROMPT_TIMEOUT_MS = 60_000;

    public function __construct(private readonly Cache $cache) {}

    public function registerOptions(Request $request): JsonResponse
    {
        $name = mb_substr(trim((string) $request->input('name', '')), 0, 40);
        if ($name === '') {
            return Json::error(400, 'name required');
        }
        $code = strtoupper(trim(Input::str($request, 'code')));
        // A code is looked up whenever one is SUPPLIED, and REQUIRED only when INVITE_ONLY is on:
        // a coach's invite link works on an open instance too. Who may create an account at all is
        // a separate question from taking a client on.
        if (config('fitpal.invite_only') && ! Bootstrap::matches($code, User::query()->count()) && ! InviteGate::redeemable($code)) {
            // The rejected code itself is never recorded: a near-miss guess in the log is a liability.
            Audit::record($request, 'auth.register.denied', ['ok' => false, 'name' => $name, 'msg' => 'invite-rejected']);

            return Json::error(403, 'a valid invite code is required');
        }

        // An unsaved account, so the ceremony has a user to describe and a handle to issue.
        $user = new User(['id' => User::newId(), 'name' => $name]);
        $request->attributes->set(CacheChallengeRepository::EXTRA_ATTRIBUTE, ['uid' => $user->id, 'name' => $name, 'code' => $code]);

        $creation = app(AttestationCreator::class)
            ->send(new AttestationCreation(user: $user, residentKey: ResidentKey::Required, userVerification: UserVerification::Preferred, uniqueCredentials: false))
            ->thenReturn();

        $creation->json->set('timeout', self::PROMPT_TIMEOUT_MS);

        return Json::ok(['cid' => $request->attributes->get(CacheChallengeRepository::CID_ATTRIBUTE), 'options' => $creation->json->toArray()]);
    }

    public function registerVerify(Request $request, AttestationValidator $validator): JsonResponse
    {
        // Spent now, whatever the body turns out to be: one challenge, one attempt.
        $entry = CacheChallengeRepository::takeFor($this->cache, $request, Input::str($request, 'cid'));
        if ($entry === null || empty($entry['extra']['uid'])) {
            Audit::record($request, 'auth.register.fail', ['ok' => false, 'msg' => 'challenge-expired']);

            return Json::error(400, 'challenge expired — try again');
        }
        $user = new User(['id' => $entry['extra']['uid'], 'name' => $entry['extra']['name']]);

        try {
            $validation = $validator->send(new AttestationValidation($user, self::transport($request, AttestationValidation::REQUEST_KEYS)))->thenReturn();
        } catch (Throwable $e) {
            if ($e instanceof AttestationException && str_contains($e->getMessage(), 'Credential ID already exists')) {
                Audit::record($request, 'auth.register.fail', ['ok' => false, 'name' => $user->name, 'msg' => 'credential-exists']);

                return Json::error(409, 'credential already registered');
            }
            Audit::record($request, 'auth.register.fail', ['ok' => false, 'name' => $user->name, 'msg' => 'verify-error']);

            return Json::error(400, self::verifyError($e));
        }

        // The code is re-checked now rather than trusted from options: an invite may have been used
        // or revoked since, and the bootstrap code dies the moment any account exists. The check
        // and the insert are one critical section, so two people finishing at once cannot both
        // pass "no users yet" and both become admin (Node relied on having no await in between).
        // Only a sign-up that SUPPLIED a code has anything to race over; one without a code is
        // never admin and never spends an invite, so it does not queue behind the lock.
        $code = (string) ($entry['extra']['code'] ?? '');
        $gate = function () use ($request, $user, $validation, $code) {
            $bootstrap = Bootstrap::matches($code, User::query()->count());
            $invite = $bootstrap ? null : InviteGate::redeemable($code);
            if (config('fitpal.invite_only') && ! $bootstrap && ! $invite) {
                Audit::record($request, 'auth.register.fail', ['ok' => false, 'name' => $user->name, 'msg' => 'invite-invalid']);

                return Json::error(403, 'invite code is no longer valid — ask for a new one');
            }
            // Stored on the row, which isAdmin() honours: the code is inert from here on.
            if ($bootstrap) {
                $user->admin = true;
                // json_encode, not raw: the name is caller-supplied and could forge log lines.
                Log::notice('[bootstrap] first account '.json_encode($user->name)." ({$user->id}) created via BOOTSTRAP_CODE and granted admin — clear BOOTSTRAP_CODE now.");
            }
            // One transaction: an account without a passkey could never be signed in to.
            DB::transaction(function () use ($user, $validation) {
                $user->save();
                $credential = $validation->credential;
                $credential->authenticatable_id = $user->id;
                $credential->save();
            });

            return null;
        };
        try {
            $refused = $code === '' ? $gate() : $this->cache->lock('register:gate', 10)->block(5, $gate);
        } catch (LockTimeoutException) {
            // Five seconds behind other sign-ups. The challenge is spent, so starting over is
            // exactly what the person has to do — and this is a sentence the app already translates.
            Audit::record($request, 'auth.register.fail', ['ok' => false, 'name' => $user->name, 'msg' => 'busy']);

            return Json::error(503, 'challenge expired — try again');
        }
        if ($refused !== null) {
            return $refused;
        }
        // Node put the invite code the account came in with in msg; invites arrive in R2.
        Audit::record($request, 'auth.register.ok', ['user' => $user]);

        return Json::ok(['user' => $user->toPublic()], cookies: SessionToken::cookies($user));
    }

    public function loginOptions(Request $request, AssertionCreator $creator): JsonResponse
    {
        // Discoverable credentials: no user and no allowCredentials, the authenticator picks.
        $creation = $creator->send(new AssertionCreation(userVerification: UserVerification::Preferred))->thenReturn();

        $creation->json->set('timeout', self::PROMPT_TIMEOUT_MS);

        return Json::ok(['cid' => $request->attributes->get(CacheChallengeRepository::CID_ATTRIBUTE), 'options' => $creation->json->toArray()]);
    }

    public function loginVerify(Request $request): JsonResponse
    {
        // Spent now, whatever the body turns out to be: one challenge, one attempt.
        if (CacheChallengeRepository::takeFor($this->cache, $request, Input::str($request, 'cid')) === null) {
            Audit::record($request, 'auth.login.fail', ['ok' => false, 'msg' => 'challenge-expired']);

            return Json::error(400, 'challenge expired — try again');
        }
        $credential = WebAuthnCredential::query()->find(Input::str($request, 'credential.id'));
        if ($credential === null) {
            Audit::record($request, 'auth.login.fail', ['ok' => false, 'msg' => 'unknown-credential']);

            return Json::error(404, 'unknown passkey — create a profile first');
        }

        try {
            $validation = app(AssertionValidator::class)
                ->send(new AssertionValidation(self::transport($request, AssertionValidation::REQUEST_KEYS)))
                ->thenReturn();
        } catch (Throwable $e) {
            $owner = User::query()->find($credential->authenticatable_id);
            Audit::record($request, 'auth.login.fail', ['ok' => false, 'user' => $owner, 'uid' => $credential->authenticatable_id, 'msg' => 'verify-error']);

            return Json::error(400, self::verifyError($e));
        }

        /** @var User|null $user */
        $user = $validation->credential->authenticatable;
        if ($user === null) {
            Audit::record($request, 'auth.login.fail', ['ok' => false, 'uid' => $credential->authenticatable_id, 'msg' => 'user-missing']);

            return Json::error(500, 'user missing');
        }
        if ($user->disabled) {
            Audit::record($request, 'auth.login.fail', ['ok' => false, 'user' => $user, 'msg' => 'account-disabled']);

            return Json::error(403, 'this account has been disabled');
        }
        Audit::record($request, 'auth.login.ok', ['user' => $user]);

        return Json::ok(['user' => $user->toPublic()], cookies: SessionToken::cookies($user));
    }

    public function logout(Request $request): JsonResponse
    {
        // Signing out needs no session, but who signed out is worth recording when there is one.
        if ($user = TokenGuard::resolve($request)) {
            Audit::record($request, 'auth.logout', ['user' => $user]);
        }

        return Json::ok(['ok' => true], cookies: SessionToken::clearCookies());
    }

    public function logoutAll(Request $request): JsonResponse
    {
        /** @var User $user */
        $user = $request->user();
        $user->sv = (int) $user->sv + 1;
        $user->save();
        Audit::record($request, 'auth.logout.all', ['user' => $user]);

        return Json::ok(['ok' => true], cookies: SessionToken::clearCookies());
    }

    public function me(Request $request): JsonResponse
    {
        return Json::ok(['user' => $request->user()->toPublic()]);
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
