<?php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * A model whose rows belong to one coach (`coach_id`). What follows, so a controller can forget
 * none of it:
 *
 *  - while a coach context is set (RequireCoach), every query on the model sees that coach's rows
 *    only — another coach's row is simply not found, which is the 404 the Node API answered;
 *  - a row created in that context gets the coach's id; one created or moved to ANOTHER coach
 *    throws. coach_id is also not mass-assignable on any of these models, so fill($request) can
 *    never carry it;
 *  - acrossCoaches() is the one sanctioned way past the scope, for the few reads the Node API made
 *    across coaches on purpose (a member's pending-offer cap counts every coach's offers; an
 *    invite code is unique across all coaches). Every call states why on the same line, as
 *    `// across coaches: …` — tests/Feature/TenantModelsTest.php fails otherwise.
 *
 * With no context (admin routes, scheduler, import) the model is unscoped. Inside one, builder
 * writes that skip model events (insert/upsert, an update() setting coach_id) are refused by
 * TenantBuilder. Code under app/ never writes where('coach_id', …) by hand nor reaches these
 * tables through DB::table() — TenantModelsTest checks both, and that every model whose table has
 * a coach_id column uses this trait.
 */
trait OwnedByCoach
{
    public static function bootOwnedByCoach(): void
    {
        static::addGlobalScope('coach', function (Builder $query): void {
            $coach = app(CoachContext::class)->id();
            if ($coach !== null) {
                $query->where($query->qualifyColumn('coach_id'), $coach);
            }
        });

        static::creating(function (Model $model): void {
            $coach = app(CoachContext::class)->id();
            if ($coach === null) {
                return;
            }
            $given = $model->getAttribute('coach_id');
            if ($given === null) {
                $model->setAttribute('coach_id', $coach);
            } elseif ($given !== $coach) {
                // A coach route writing a row for ANOTHER coach is a bug, never a request to honour.
                throw new LogicException(static::class." created for coach $given while acting as coach $coach");
            }
        });

        static::updating(function (Model $model): void {
            $coach = app(CoachContext::class)->id();
            if ($coach !== null && $model->isDirty('coach_id')) {
                throw new LogicException(static::class.' moved to coach '.$model->getAttribute('coach_id')." while acting as coach $coach");
            }
        });
    }

    /** Every query on the model goes through TenantBuilder, which refuses builder-level writes that skip the events above. */
    public function newEloquentBuilder($query): TenantBuilder
    {
        return new TenantBuilder($query);
    }

    /** A model's own save is allowed through TenantBuilder's insert guard: `creating` has already checked it. */
    protected function performInsert(Builder $query)
    {
        return parent::performInsert($query instanceof TenantBuilder ? $query->forModelSave() : $query);
    }

    /**
     * Past the coach scope, for a read the Node API made across coaches on purpose. State the
     * reason on the call's line: `// across coaches: <why>`.
     */
    public static function acrossCoaches(): Builder
    {
        return static::query()->withoutGlobalScope('coach');
    }
}
