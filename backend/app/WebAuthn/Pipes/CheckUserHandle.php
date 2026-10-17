<?php

namespace App\WebAuthn\Pipes;

use Closure;
use Laragear\WebAuthn\Assertion\Validator\AssertionValidation;
use Laragear\WebAuthn\Exceptions\AssertionException;

/**
 * Replaces the package's CheckCredentialIsForUser, which insists the user handle be a UUID. Here
 * the handle is the base64url of the account id's bytes (see AddUserHandle), stored on the
 * credential as `user_id` at registration and at import. An authenticator that returns a handle
 * must return that one; one that returns none (an old non-resident key) is accepted, as the Node
 * API never looked at the handle at all.
 */
final class CheckUserHandle
{
    public function handle(AssertionValidation $validation, Closure $next): mixed
    {
        $handle = (string) $validation->json->get('response.userHandle', '');
        if ($handle !== '') {
            $stored = (string) $validation->credential->user_id;
            if (strlen($handle) !== strlen($stored) || ! hash_equals($stored, $handle)) {
                throw AssertionException::make('User ID is not owner of the stored credential.');
            }
        }

        return $next($validation);
    }
}
