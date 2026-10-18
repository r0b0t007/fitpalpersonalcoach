<?php

namespace App\Tenancy;

use Illuminate\Database\Eloquent\Builder;
use LogicException;

/**
 * The query builder of every OwnedByCoach model. The model events that guard ownership (creating,
 * updating) do not fire for builder-level writes, so inside a coach context this builder refuses
 * the two ways round them, whatever line breaks the call is written with:
 *
 *  - an update() that sets coach_id — it would move scoped rows to another coach;
 *  - insert/insertOrIgnore/insertGetId/insertUsing/upsert — rows that never pass `creating`.
 *    Rows are created through the model on coach routes.
 *
 * With no context (admin routes, scheduler, import) both are allowed, as the import needs them.
 */
final class TenantBuilder extends Builder
{
    private const BULK = ['insert', 'insertorignore', 'insertgetid', 'insertusing', 'upsert'];

    /** Set by OwnedByCoach::performInsert: Eloquent's own save inserts through here, after `creating` ran. */
    private bool $modelSave = false;

    public function forModelSave(): static
    {
        $this->modelSave = true;

        return $this;
    }

    public function update(array $values)
    {
        if (app(CoachContext::class)->id() !== null && array_key_exists('coach_id', $values)) {
            throw new LogicException($this->model::class.' rows cannot be moved between coaches inside a coach context');
        }

        return parent::update($values);
    }

    public function upsert(array $values, $uniqueBy, $update = null)
    {
        $this->refuseBulk('upsert');

        return parent::upsert($values, $uniqueBy, $update);
    }

    /** insert* reach the base query through __call (Eloquent's passthru list). */
    public function __call($method, $parameters)
    {
        if (in_array(strtolower($method), self::BULK, true)) {
            $this->refuseBulk($method);
        }

        return parent::__call($method, $parameters);
    }

    private function refuseBulk(string $method): void
    {
        if (! $this->modelSave && app(CoachContext::class)->id() !== null) {
            throw new LogicException("$method() skips the ownership checks; create tenant rows through the model inside a coach context");
        }
    }
}
