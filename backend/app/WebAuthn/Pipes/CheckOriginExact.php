<?php

namespace App\WebAuthn\Pipes;

use Closure;
use Laragear\WebAuthn\Assertion\Validator\AssertionValidation;
use Laragear\WebAuthn\Attestation\Validator\AttestationValidation;
use Laragear\WebAuthn\SharedPipes\ThrowsCeremonyException;

/**
 * The origin in the client data must be ORIGIN, character for character, as the Node API
 * required. The package's own check (CheckRelyingPartyIdContained) only looks at the hostname,
 * so any port and any subdomain of RP_ID would pass it. Runs after that check, so its clearer
 * messages about an insecure or foreign host come first.
 */
final class CheckOriginExact
{
    use ThrowsCeremonyException;

    public const MESSAGE = 'Response origin is not the configured ORIGIN.';

    public function handle(AttestationValidation|AssertionValidation $validation, Closure $next): mixed
    {
        $origin = rtrim((string) $validation->clientDataJson?->origin, '/');
        if ($origin === '' || ! hash_equals((string) config('fitpal.origin'), $origin)) {
            self::throw($validation, self::MESSAGE);
        }

        return $next($validation);
    }
}
