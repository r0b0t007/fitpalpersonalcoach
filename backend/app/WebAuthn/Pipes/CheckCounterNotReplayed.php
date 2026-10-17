<?php

namespace App\WebAuthn\Pipes;

use Closure;
use Laragear\WebAuthn\Assertion\Validator\AssertionValidation;
use Laragear\WebAuthn\Events\CredentialCloned;
use Laragear\WebAuthn\Exceptions\AssertionException;

/**
 * Replaces the package's CheckPublicKeyCounterCorrect, which refuses a counter that did not
 * advance AND disables the credential for good. The Node API refused that one attempt and
 * nothing else: a passkey restored from a backup, or imported with a counter the authenticator
 * has not reached, signs in on its next honest try. There is no route to re-enable a passkey,
 * so disabling one here would lock the account.
 */
final class CheckCounterNotReplayed
{
    public function handle(AssertionValidation $validation, Closure $next): mixed
    {
        $stored = (int) $validation->credential->counter;
        $seen = (int) $validation->authenticatorData->counter;
        if (($stored || $seen) && $seen <= $stored) {
            CredentialCloned::dispatch($validation->credential, $seen);
            throw AssertionException::make('Credential counter not over stored counter.');
        }

        return $next($validation);
    }
}
