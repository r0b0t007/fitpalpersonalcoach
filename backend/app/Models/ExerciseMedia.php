<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A coach's demo media for an exercise. Scoped to the uploading coach on coach routes
 * (OwnedByCoach); what anyone else may see is App\Tenancy\Access::canSeeMedia, and visibleTo()
 * below is that same rule as a query.
 */
class ExerciseMedia extends Model
{
    use OwnedByCoach;

    /** api/server.js MEDIA_MAX_PER_EX: per exercise, counted per uploading coach (spec §5). */
    public const MAX_PER_EXERCISE = 6;

    protected $table = 'exercise_media';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['id', 'ex_id', 'file', 'label', 'bytes', 'mime', 'status', 'created'];

    /** The coach whose demo this is (the admin panel's columns and filters). */
    public function coach(): BelongsTo
    {
        return $this->belongsTo(User::class, 'coach_id');
    }

    protected function casts(): array
    {
        return ['bytes' => 'integer'];
    }

    /**
     * The rows this viewer may see, in upload order: an admin every coach's; anyone else their own
     * (a coach's uploads) and their coach's (a client's). The spec's one deliberate change from
     * Node, which listed every row to every signed-in account (§5).
     */
    public static function visibleTo(User $viewer): Builder
    {
        $query = static::acrossCoaches(); // across coaches: a client reads their coach's rows, and an admin every coach's
        if (! $viewer->isAdmin()) {
            $query->whereIn('coach_id', array_values(array_filter([$viewer->id, $viewer->coach_id])));
        }

        return $query->orderBy('created')->orderBy('id');
    }

    /** The row as GET /api/media/exercises lists it: everything but who uploaded it. */
    public function toListed(): array
    {
        return ['id' => $this->id, 'exId' => $this->ex_id, 'file' => $this->file, 'label' => $this->label,
            'mime' => $this->mime, 'bytes' => $this->bytes, 'status' => $this->status, 'created' => $this->created];
    }

    /** The row as the upload answers it, uploader included (Node's db.media row). */
    public function toNode(): array
    {
        return ['id' => $this->id, 'exId' => $this->ex_id, 'coachId' => $this->coach_id, 'file' => $this->file,
            'label' => $this->label, 'bytes' => $this->bytes, 'mime' => $this->mime, 'status' => $this->status,
            'created' => $this->created];
    }
}
