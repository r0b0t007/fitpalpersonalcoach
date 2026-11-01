<?php

namespace App\Models;

use App\Coaching\Handle;
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
        return ['open' => 'boolean', 'auto_accept' => 'boolean', 'created' => 'integer', 'updated' => 'integer'];
    }

    /**
     * A page as the public finds it, by handle: the page, and its coach while they still coach
     * (an enabled coach). Whether it is open is the caller's to judge — the public card and the
     * join form say "closed" and "missing" apart.
     *
     * @return array{0: CoachPage|null, 1: User|null}
     */
    public static function findPublic(string $handle): array
    {
        if (! Handle::valid($handle)) {
            return [null, null];
        }
        $page = self::acrossCoaches()->where('handle', $handle)->first(); // across coaches: the public looks a page up by its handle
        $coach = $page ? User::query()->find($page->coach_id) : null;

        return [$page, $coach !== null && $coach->isCoach() && ! $coach->disabled ? $coach : null];
    }

    /** The link for the bio: ORIGIN/c/<handle>, which the docroot .htaccess hands to the API. */
    public static function url(string $handle): string
    {
        return rtrim((string) config('fitpal.origin'), '/').'/c/'.$handle;
    }

    /** As the editor reads it. */
    public function toCoach(): array
    {
        return ['handle' => $this->handle, 'bio' => $this->bio, 'whatsapp' => $this->whatsapp, 'open' => $this->open, 'theme' => $this->theme,
            // CHW-338: what a new client is given, and whether requests wait for the coach at all.
            'starterProgramId' => $this->starter_program_id, 'autoAccept' => (bool) $this->auto_accept];
    }

    /** As anyone with the link reads it: nothing the coach did not write for the public. */
    public function toPublic(User $coach): array
    {
        return ['name' => $coach->name, 'handle' => $this->handle, 'bio' => $this->bio, 'whatsapp' => $this->whatsapp, 'theme' => $this->theme];
    }
}
