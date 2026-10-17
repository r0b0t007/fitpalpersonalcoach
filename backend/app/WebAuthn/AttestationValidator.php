<?php

namespace App\WebAuthn;

use App\WebAuthn\Pipes\CheckOriginExact;
use Laragear\WebAuthn\Attestation\Validator\AttestationValidator as BaseValidator;
use Laragear\WebAuthn\Attestation\Validator\Pipes;
use Laragear\WebAuthn\SharedPipes\RequireWebAuthnUser;

/**
 * The package's registration-verification pipeline with one pipe added: the exact-origin check
 * the Node API made (Pipes\CheckOriginExact). Everything else is the package's own code.
 */
final class AttestationValidator extends BaseValidator
{
    protected $pipes = [
        RequireWebAuthnUser::class,
        Pipes\CompileClientDataJson::class,
        Pipes\CompileAttestationObject::class,
        Pipes\AttestationIsForCreation::class,
        Pipes\RetrieveChallenge::class,
        Pipes\CheckChallengeSame::class,
        Pipes\CheckRelyingPartyIdContained::class,
        CheckOriginExact::class,
        Pipes\CheckRelyingPartyHashSame::class,
        Pipes\CheckUserInteraction::class,
        Pipes\CredentialIdShouldNotBeDuplicated::class,
        Pipes\MakeWebAuthnCredential::class,
        Pipes\FireCredentialAttestedEvent::class,
    ];
}
