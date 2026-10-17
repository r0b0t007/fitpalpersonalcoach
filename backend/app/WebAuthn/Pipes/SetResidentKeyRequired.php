<?php

namespace App\WebAuthn\Pipes;

use Closure;
use Laragear\WebAuthn\Attestation\Creator\AttestationCreation;

/**
 * Replaces the package's SetResidentKeyConfiguration, which turns user verification to
 * "required" whenever a resident key is required. The Node API asked for a resident key with
 * verification "preferred" and never insisted on the UV bit, so a security key without a PIN
 * or a biometric still registers; that stays the same here.
 */
final class SetResidentKeyRequired
{
    public function handle(AttestationCreation $attestable, Closure $next): mixed
    {
        $attestable->json->set('authenticatorSelection.residentKey', $attestable->residentKey->value);
        $attestable->json->set('authenticatorSelection.requireResidentKey', $attestable->residentKey->value === 'required');

        return $next($attestable);
    }
}
