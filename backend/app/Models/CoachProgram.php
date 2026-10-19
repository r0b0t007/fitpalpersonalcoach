<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;
use stdClass;

/**
 * A program in a coach's library (Node kept these in coach-<uid>.json). `program_id` is the id the
 * app made, kept as given and unique per coach; the auto-increment `id` is the library's order,
 * which Node's array kept — a re-save updates in place and keeps its position. Scoped: OwnedByCoach.
 */
class CoachProgram extends Model
{
    use OwnedByCoach;

    public $timestamps = false;

    protected $fillable = ['program_id', 'name', 'bundle', 'created', 'updated'];

    /** Epoch milliseconds, as Node's Date.now() wrote them: the app reads numbers back. */
    protected function casts(): array
    {
        return ['created' => 'integer', 'updated' => 'integer'];
    }

    /** The row as Node sent it: `{id, name, created, updated, bundle}`, the bundle's `{}` kept. */
    public function toNode(): array
    {
        $bundle = json_decode($this->bundle);

        return [
            'id' => $this->program_id, 'name' => $this->name, 'created' => $this->created, 'updated' => $this->updated,
            'bundle' => $bundle instanceof stdClass ? $bundle : new stdClass,
        ];
    }

    /** @return list<array<string, mixed>> the acting coach's library, in order */
    public static function library(): array
    {
        return static::query()->orderBy('id')->get()->map(fn (self $p) => $p->toNode())->all();
    }
}
