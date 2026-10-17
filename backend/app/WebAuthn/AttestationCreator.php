<?php

namespace App\WebAuthn;

use App\WebAuthn\Pipes\AddUserHandle;
use App\WebAuthn\Pipes\SetResidentKeyRequired;
use Laragear\WebAuthn\Attestation\Creator\AttestationCreator as BaseCreator;
use Laragear\WebAuthn\Attestation\Creator\Pipes;
use Laragear\WebAuthn\SharedPipes\RequireWebAuthnUser;

/**
 * The package's registration-options pipeline with two pipes swapped: the resident-key pipe
 * leaves user verification at "preferred" (Pipes\SetResidentKeyRequired), and the user descriptor
 * emits our base64url handle instead of a hex UUID (Pipes\AddUserHandle). Everything else is the
 * package's own code.
 */
final class AttestationCreator extends BaseCreator
{
    protected $pipes = [
        RequireWebAuthnUser::class,
        Pipes\AddRelyingParty::class,
        SetResidentKeyRequired::class,
        Pipes\MayRequireUserVerification::class,
        AddUserHandle::class,
        Pipes\AddAcceptedAlgorithms::class,
        Pipes\MayPreventDuplicateCredentials::class,
        Pipes\CreateAttestationChallenge::class,
    ];
}
