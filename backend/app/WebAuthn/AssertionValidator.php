<?php

namespace App\WebAuthn;

use App\WebAuthn\Pipes\CheckOriginExact;
use App\WebAuthn\Pipes\CheckUserHandle;
use Laragear\WebAuthn\Assertion\Validator\AssertionValidator as BaseValidator;
use Laragear\WebAuthn\Assertion\Validator\Pipes;

/**
 * The package's login-verification pipeline with one pipe swapped and one added: the user-handle
 * check accepts our base64url handle (and the absence of one) instead of demanding a UUID
 * (Pipes\CheckUserHandle), and the origin must be ORIGIN exactly (Pipes\CheckOriginExact).
 * Signature, counter and RP checks are the package's own.
 */
final class AssertionValidator extends BaseValidator
{
    protected $pipes = [
        Pipes\CheckTypeIsPublicKey::class,
        Pipes\CompileAuthenticatorData::class,
        Pipes\CompileClientDataJson::class,
        Pipes\CheckCredentialIsWebAuthnGet::class,
        Pipes\RetrieveChallenge::class,
        Pipes\CheckChallengeSame::class,
        Pipes\RetrievesCredentialId::class,
        CheckUserHandle::class,
        Pipes\CheckRelyingPartyIdContained::class,
        CheckOriginExact::class,
        Pipes\CheckRelyingPartyHashSame::class,
        Pipes\CheckUserInteraction::class,
        Pipes\CheckPublicKeySignature::class,
        Pipes\CheckPublicKeyCounterCorrect::class,
        Pipes\IncrementCredentialCounter::class,
        Pipes\FireCredentialAssertedEvent::class,
    ];
}
