<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;

/**
 * A coach's demo media for an exercise. Scoped to the uploading coach on coach routes
 * (OwnedByCoach); what a client may see is App\Tenancy\Access::canSeeMedia.
 */
class ExerciseMedia extends Model
{
    use OwnedByCoach;

    protected $table = 'exercise_media';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['id', 'ex_id', 'coach_id', 'file', 'label', 'bytes', 'mime', 'status', 'created'];

    protected function casts(): array
    {
        return ['bytes' => 'integer'];
    }
}
