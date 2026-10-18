<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;

/** A program in a coach's library; `program_id` is the app's own id. Scoped: OwnedByCoach. */
class CoachProgram extends Model
{
    use OwnedByCoach;

    public $timestamps = false;

    protected $fillable = ['coach_id', 'program_id', 'name', 'bundle', 'created', 'updated'];
}
