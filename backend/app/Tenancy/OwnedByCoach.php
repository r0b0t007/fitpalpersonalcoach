<?php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * A model whose rows belong to one coach (`coach_id`). Two things follow, so a controller can
 * forget neither:
 *
 *  - while a coach context is set (RequireCoach), every query on the model sees that coach's rows
 *    only — another coach's row is simply not found, which is the 404 the Node API answered;
 *  - a row created in that context gets the coach's id.
 *
 * With no context (admin routes, scheduler, import) the model is unscoped. Controllers never
 * write where('coach_id', …) by hand. tests/Unit/TenantModelsTest.php fails if a model whose table
 * has a coach_id column does not use this trait.
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
    }
}
