<?php

namespace App\Console\Commands;

use App\Coaching\Terms;
use App\Models\User;
use Illuminate\Console\Command;

/**
 * Who has accepted a version of the coach terms (App\Coaching\Terms), read-only. Whether a new
 * version can bind at once or owes 30 days' notice (Part A §9) turns on this, so it is asked of
 * terms_version itself: every account that accepted, whatever its flags now (an admin through
 * ADMIN_UIDS, a coach since demoted), not the coach column (CHW-372 review).
 *
 * Before a new version: every holder but the operator's account is owed the notice. After one
 * deploys with EFFECTIVE = VERSION: `on_earlier` must be 0, or EFFECTIVE goes back to 30 days on.
 */
final class TermsHolders extends Command
{
    protected $signature = 'fitpal:terms-holders';

    protected $description = 'List every account holding a version of the coach terms (read-only)';

    public function handle(): int
    {
        $holders = User::query()->whereNotNull('terms_version')
            ->orderBy('terms_version')->orderBy('id')
            ->get(['id', 'admin', 'coach', 'terms_version', 'terms_at']);
        foreach ($holders as $u) {
            $this->line($u->id.' admin='.(int) $u->isAdmin().' coach='.(int) $u->coach
                .' terms='.$u->terms_version.' at='.($u->terms_at ?? 'null'));
        }
        $earlier = $holders->filter(fn (User $u) => $u->terms_version !== Terms::VERSION)->count();
        $this->line('version='.Terms::VERSION.' effective='.Terms::EFFECTIVE);
        $current = $holders->count() - $earlier;
        $this->line('holders='.$holders->count().' on_current='.$current.' on_earlier='.$earlier);

        return self::SUCCESS;
    }
}
