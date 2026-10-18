<?php

namespace App\Tenancy;

use App\Models\User;

/**
 * The coach a request acts as. Set by RequireCoach on every /api/coach/* request — for an admin
 * on a coach route too, since the Node API scoped an admin's invites, programs, assignments and
 * media to the admin's own id. Left empty everywhere else: admin routes, the Filament panel, the
 * scheduler and the import see every coach's rows.
 *
 * Bound as a scoped singleton (AppServiceProvider), so it lives exactly one request.
 */
final class CoachContext
{
    private ?User $coach = null;

    public function set(User $coach): void
    {
        $this->coach = $coach;
    }

    public function coach(): ?User
    {
        return $this->coach;
    }

    public function id(): ?string
    {
        return $this->coach?->id;
    }
}
