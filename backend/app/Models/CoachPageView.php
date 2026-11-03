<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * How many times a coach's public page was seen, one row a day (CHW-335): the funnel's first step.
 * A count and nothing else — no address, no visitor, no row per visit — and never in audit_events:
 * anyone can open a page, and a flood of views there would prune the security events out.
 */
class CoachPageView extends Model
{
    use OwnedByCoach;

    public $incrementing = false;

    public $timestamps = false;

    protected $fillable = ['day', 'n'];

    protected function casts(): array
    {
        return ['n' => 'integer'];
    }

    /**
     * One more view of the coach's page today (UTC). An upsert, one statement: two views at once
     * both count. From the public route, which has no coach context, so the scope has nothing to
     * refuse.
     */
    public static function hit(string $coachId, string $day): void
    {
        DB::table('coach_page_views')->upsert([['coach_id' => $coachId, 'day' => $day, 'n' => 1]], ['coach_id', 'day'], ['n' => DB::raw('n + 1')]);
    }
}
