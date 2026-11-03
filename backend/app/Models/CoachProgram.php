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

    /** One program in $coachId's library, for the admin panel, which acts as no coach (CHW-348). */
    public static function inLibraryOf(string $coachId, string $programId): ?self
    {
        return static::acrossCoaches()->where('coach_id', $coachId)->where('program_id', $programId)->first(); // across coaches: the panel reads one named coach's library
    }

    public static function countOf(string $coachId): int
    {
        return static::acrossCoaches()->where('coach_id', $coachId)->count(); // across coaches: the panel checks one named coach's cap
    }

    /** @return array<string, string> $coachId's programs as program_id => name, in library order */
    public static function namesOf(string $coachId): array
    {
        return static::acrossCoaches()->where('coach_id', $coachId)->orderBy('id')->pluck('name', 'program_id')->all(); // across coaches: the panel lists the owner's own library
    }
}
