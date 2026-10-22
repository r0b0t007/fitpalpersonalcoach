<?php

namespace App\Auth;

use App\Domain\Entitlement;
use App\Models\User;
use App\Support\Json;
use App\Support\Say;
use Illuminate\Http\JsonResponse;

/**
 * Whether a coach can take one more client under their licence (spec §6), asked everywhere a
 * client joins by a coach's code: registration (before the passkey prompt and again when the
 * account is written) and redeeming from an existing account. A coach whose plan is read-only
 * takes nobody either, with a sentence of its own: "full (30)" would be untrue of a coach with
 * two clients, and the client is not told why — only that the coach has something to sort out.
 *
 * Judged when called. The callers that write call it with the coach's row locked (CoachLock,
 * through InviteGate::redeemable) and $lock, so two joins racing for the last seat are serialised
 * and the second one's locking count sees the first (Entitlement::for).
 */
final class CoachSeat
{
    /** Entitlement::seatRefusal for $coach, null when there is no coach to join: no response built. */
    public static function reason(?User $coach): ?string
    {
        return $coach !== null ? Entitlement::for($coach)->seatRefusal() : null;
    }

    /** Null when $coach can take one more client (or there is no coach to join); else the 409. */
    public static function refusal(?User $coach, bool $lock = false): ?JsonResponse
    {
        if ($coach === null) {
            return null;
        }
        $entitlement = Entitlement::for($coach, $lock);

        return match ($entitlement->seatRefusal()) {
            null => null,
            'at_cap' => Json::error(409, Say::f('this coach\'s client list is full ({0}) — ask them to upgrade', (int) $entitlement->cap)),
            default => Json::error(409, 'this coach cannot take new clients right now — ask them to check their plan'),
        };
    }
}
