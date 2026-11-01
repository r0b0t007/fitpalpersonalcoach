<?php

namespace App\Models;

use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;

/**
 * A coach's public page (CHW-330), one per coach and keyed by them. Scoped: OwnedByCoach — a coach
 * route sees only its own page; the public lookup by handle reads across coaches on purpose.
 */
class CoachPage extends Model
{
    use OwnedByCoach;

    protected $primaryKey = 'coach_id';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    protected $fillable = ['handle', 'bio', 'whatsapp', 'open', 'theme', 'created', 'updated'];

    protected function casts(): array
    {
        return ['open' => 'boolean', 'created' => 'integer', 'updated' => 'integer'];
    }

    /** As the editor reads it. */
    public function toCoach(): array
    {
        return ['handle' => $this->handle, 'bio' => $this->bio, 'whatsapp' => $this->whatsapp, 'open' => $this->open, 'theme' => $this->theme];
    }

    /** As anyone with the link reads it: nothing the coach did not write for the public. */
    public function toPublic(User $coach): array
    {
        return ['name' => $coach->name, 'handle' => $this->handle, 'bio' => $this->bio, 'whatsapp' => $this->whatsapp, 'theme' => $this->theme];
    }
}
