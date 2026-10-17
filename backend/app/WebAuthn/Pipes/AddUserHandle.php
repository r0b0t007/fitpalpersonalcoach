<?php

namespace App\WebAuthn\Pipes;

use App\Models\User;
use Closure;
use Laragear\WebAuthn\Attestation\Creator\AttestationCreation;

/**
 * Replaces the package's AddUserDescriptor. That pipe writes `user.id` as a hex UUID; the React
 * app base64url-decodes `user.id` into the handle bytes, and every passkey issued by the Node API
 * carries the ASCII of the 16-character account id as its handle. So the handle stays those
 * bytes, sent base64url, and new credentials match imported ones.
 */
final class AddUserHandle
{
    public function handle(AttestationCreation $attestable, Closure $next): mixed
    {
        /** @var User $user */
        $user = $attestable->user;
        $attestable->json->set('user', [
            'id' => $user->webAuthnHandle(),
            ...$user->webAuthnData()->toArray(),
        ]);

        return $next($attestable);
    }
}
