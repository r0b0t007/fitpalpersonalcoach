<?php

// The coach boundary, by construction (spec §5, CHW-232): a request acting as a coach sees only
// that coach's rows in every tenant-owned table, writes only rows for that coach, and the checks
// that are not a plain filter answer as the Node API did. Routes arriving in R2/R3 add their own
// rows to CrossTenantTest; this pins the mechanism they all stand on.

use App\Http\Middleware\RequireCoach;
use App\Models\Assignment;
use App\Models\CoachProgram;
use App\Models\ExerciseMedia;
use App\Models\Invite;
use App\Models\User;
use App\Tenancy\Access;
use App\Tenancy\CoachContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'http://localhost:5173']);
    $this->f = Coaching::twoCoaches();
    // A probe behind the real middleware stack, reporting what the request can see.
    Route::middleware(['api', 'auth:api', RequireCoach::class])->get('/api/coach/_probe', fn () => response()->json([
        'context' => app(CoachContext::class)->id(),
        'invites' => Invite::query()->pluck('code')->all(),
        'programs' => CoachProgram::query()->pluck('program_id')->all(),
        'assignments' => Assignment::query()->pluck('id')->all(),
        'media' => ExerciseMedia::query()->pluck('id')->all(),
    ]));
    Route::middleware(['api'])->get('/api/_unscoped', fn () => response()->json([
        'context' => app(CoachContext::class)->id(),
        'invites' => Invite::query()->count(),
    ]));
});

const TENANT_MODELS = [Invite::class, CoachProgram::class, Assignment::class, ExerciseMedia::class];

it('lets only a coach through a coach route: 401 anonymous, 403 a client, as requireCoach', function () {
    $this->getJson('/api/coach/_probe')->assertStatus(401)->assertExactJson(['error' => 'not signed in']);
    $this->getJson('/api/coach/_probe', bearer($this->f->a1))->assertStatus(403)->assertExactJson(['error' => 'forbidden']);
});

it('shows a coach their own rows in every tenant-owned table, and none of the other coach\'s', function () {
    $this->getJson('/api/coach/_probe', bearer($this->f->a))->assertOk()->assertExactJson([
        'context' => $this->f->a->id,
        'invites' => ['INVA0000000000'], 'programs' => ['prog-a'], 'assignments' => ['assignA'], 'media' => ['mediaa'],
    ]);
    $this->getJson('/api/coach/_probe', bearer($this->f->b))->assertOk()->assertJsonPath('programs', ['prog-b'])->assertJsonPath('assignments', ['assignB']);
});

it('scopes an admin on a coach route to their own rows, as Node did', function () {
    $this->getJson('/api/coach/_probe', bearer($this->f->admin))->assertOk()->assertExactJson([
        'context' => $this->f->admin->id,
        'invites' => ['INVADMIN0000000000'], 'programs' => ['prog-admin'], 'assignments' => [], 'media' => ['mediaadmin'],
    ]);
});

it('starts every request with no coach: the context never leaks into the next one', function () {
    $this->getJson('/api/coach/_probe', bearer($this->f->a))->assertOk();
    $this->getJson('/api/_unscoped')->assertOk()->assertExactJson(['context' => null, 'invites' => 3]);
});

it('finds another coach\'s row by its key as nothing at all — the 404 Node answered', function () {
    app(CoachContext::class)->set($this->f->a);
    expect(Invite::query()->find('INVB0000000000'))->toBeNull()
        ->and(Assignment::query()->find('assignB'))->toBeNull()
        ->and(ExerciseMedia::query()->find('mediab'))->toBeNull()
        ->and(CoachProgram::query()->where('program_id', 'prog-b')->first())->toBeNull()
        ->and(Invite::query()->find('INVA0000000000'))->not->toBeNull();
});

it('writes the acting coach onto a new row, and refuses a row for another coach', function () {
    app(CoachContext::class)->set($this->f->a);
    $p = CoachProgram::query()->create(['program_id' => 'new', 'name' => 'New', 'bundle' => '{}', 'created' => 'x', 'updated' => 'x']);
    expect($p->coach_id)->toBe($this->f->a->id);

    expect(fn () => CoachProgram::query()->create(['coach_id' => $this->f->b->id, 'program_id' => 'sneaky', 'name' => 'S', 'bundle' => '{}', 'created' => 'x', 'updated' => 'x']))
        ->toThrow(LogicException::class);
    expect(DB::table('coach_programs')->where('program_id', 'sneaky')->exists())->toBeFalse();
});

it('sees every coach\'s rows with no context — admin routes, the scheduler, the import', function () {
    foreach (TENANT_MODELS as $model) {
        expect($model::query()->count())->toBeGreaterThanOrEqual(2);
    }
    expect(Invite::query()->count())->toBe(3);
});

it('counts a coach\'s clients for the coach it is given, whatever the context', function () {
    expect(User::clientsOf($this->f->a)->count())->toBe(3)   // a1, a2 and the disabled d1
        ->and(User::clientsOf($this->f->b)->count())->toBe(1);
    app(CoachContext::class)->set($this->f->b);              // the cap is counted outside coach routes too
    expect(User::clientsOf($this->f->a)->count())->toBe(3)
        ->and(User::query()->count())->toBe(8);                // User itself is never scoped
});

it('lets a coach coach their own members only; an admin anyone; nobody themselves or the disabled', function () {
    $f = $this->f;
    expect(Access::canCoachMember($f->a, $f->a1))->toBeTrue()
        ->and(Access::canCoachMember($f->a, $f->b1))->toBeFalse()      // another coach's
        ->and(Access::canCoachMember($f->a, $f->u1))->toBeFalse()      // unassigned
        ->and(Access::canCoachMember($f->a, $f->d1))->toBeFalse()      // disabled member
        ->and(Access::canCoachMember($f->a, $f->a))->toBeFalse()       // yourself
        ->and(Access::canCoachMember($f->a, null))->toBeFalse()        // unknown id: same answer, no enumeration
        ->and(Access::canCoachMember($f->admin, $f->b1))->toBeTrue()   // the one cross-tenant read
        ->and(Access::canCoachMember($f->admin, $f->d1))->toBeFalse();
    $f->a->disabled = true;
    expect(Access::canCoachMember($f->a, $f->a1))->toBeFalse();       // a disabled coach coaches nobody
});

it('shows progress photos to the client, their coach and an admin only', function () {
    $f = $this->f;
    expect(Access::canSeePhotos($f->a1, $f->a1))->toBeTrue()
        ->and(Access::canSeePhotos($f->a, $f->a1))->toBeTrue()
        ->and(Access::canSeePhotos($f->admin, $f->a1))->toBeTrue()
        ->and(Access::canSeePhotos($f->b, $f->a1))->toBeFalse()
        ->and(Access::canSeePhotos($f->a2, $f->a1))->toBeFalse();   // a fellow client
});

it('shows demo media to its coach, that coach\'s clients and an admin — not to the whole instance', function () {
    $f = $this->f;
    $mediaA = ExerciseMedia::query()->find('mediaa');
    expect(Access::canSeeMedia($f->a, $mediaA))->toBeTrue()
        ->and(Access::canSeeMedia($f->a1, $mediaA))->toBeTrue()
        ->and(Access::canSeeMedia($f->admin, $mediaA))->toBeTrue()
        ->and(Access::canSeeMedia($f->b, $mediaA))->toBeFalse()
        ->and(Access::canSeeMedia($f->b1, $mediaA))->toBeFalse()   // Node showed them every row
        ->and(Access::canSeeMedia($f->u1, $mediaA))->toBeFalse();
});

it('deletes a coach\'s programs, assignments and media with the coach, and orphans their invites', function () {
    DB::table('users')->where('id', $this->f->b->id)->delete();
    expect(CoachProgram::query()->where('program_id', 'prog-b')->exists())->toBeFalse()
        ->and(Assignment::query()->find('assignB'))->toBeNull()
        ->and(ExerciseMedia::query()->find('mediab'))->toBeNull()
        ->and(Invite::query()->find('INVB0000000000')->coach_id)->toBeNull();
})->skip(fn () => DB::getDriverName() === 'sqlite' && ! DB::selectOne('PRAGMA foreign_keys')->foreign_keys, 'foreign keys are off on this SQLite connection');
