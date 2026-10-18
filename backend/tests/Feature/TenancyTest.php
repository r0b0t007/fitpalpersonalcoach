<?php

// The coach boundary, by construction (spec §5, CHW-232): a request acting as a coach sees only
// that coach's rows in every tenant-owned table, writes only rows for that coach, and the checks
// that are not a plain filter answer as the Node API did. This pins the mechanism; the coach
// routes arriving in R2/R3 each walk themselves across tenants in a CrossTenantTest, which the
// first of them (the roster) creates.

use App\Http\Middleware\RequireCoach;
use App\Models\Assignment;
use App\Models\CoachProgram;
use App\Models\ExerciseMedia;
use App\Models\Invite;
use App\Models\User;
use App\Tenancy\Access;
use App\Tenancy\CoachContext;
use Illuminate\Database\Eloquent\MassAssignmentException;
use Illuminate\Database\QueryException;
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
    $this->getJson('/api/coach/_probe', bearer($this->f->b))->assertOk()->assertJsonPath('programs', ['prog-b'])->assertJsonPath('assignments', ['assignB', 'assignBtoA1']);
});

it('scopes an admin on a coach route to their own rows, as Node did', function () {
    $this->getJson('/api/coach/_probe', bearer($this->f->admin))->assertOk()->assertExactJson([
        'context' => $this->f->admin->id,
        'invites' => ['INVADMIN0000000000'], 'programs' => ['prog-admin'], 'assignments' => [], 'media' => ['mediaadmin'],
    ]);
});

it('binds the coach context per request (scoped), not once for the process', function () {
    // The production property, not the test harness: a scoped instance is the same object within
    // a request and a fresh one after the container forgets scoped instances, which Laravel does
    // between requests (Octane) and queue jobs. A singleton would survive that, and leak.
    $first = app(CoachContext::class);
    $first->set($this->f->a);
    expect(app(CoachContext::class))->toBe($first);
    app()->forgetScopedInstances();
    expect(app(CoachContext::class))->not->toBe($first)
        ->and(app(CoachContext::class)->id())->toBeNull();
});

it('starts every test request with no coach', function () {
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

    // Not even mass-assignable: a request body can never carry coach_id onto a row.
    expect(fn () => CoachProgram::query()->create(['coach_id' => $this->f->b->id, 'program_id' => 'sneaky', 'name' => 'S', 'bundle' => '{}', 'created' => 'x', 'updated' => 'x']))
        ->toThrow(MassAssignmentException::class);
    // Set directly, it is refused on create…
    expect(fn () => (new CoachProgram)->forceFill(['coach_id' => $this->f->b->id, 'program_id' => 'sneaky', 'name' => 'S', 'bundle' => '{}', 'created' => 'x', 'updated' => 'x'])->save())
        ->toThrow(LogicException::class);
    // …and on update: a scoped row cannot be handed to another coach.
    $mine = CoachProgram::query()->where('program_id', 'prog-a')->first();
    $mine->coach_id = $this->f->b->id;
    expect(fn () => $mine->save())->toThrow(LogicException::class);
    expect(DB::table('coach_programs')->where('coach_id', $this->f->b->id)->pluck('program_id')->all())->toBe(['prog-b']);
});

it('reads across coaches only where Node did, by name', function () {
    app(CoachContext::class)->set($this->f->a);
    // A member's offers from every coach: the per-member pending cap and the card's last decision.
    expect(Assignment::forMember($this->f->a1->id)->pluck('id')->sort()->values()->all())->toBe(['assignA', 'assignBtoA1'])
        ->and(Assignment::query()->where('member_id', $this->f->a1->id)->pluck('id')->all())->toBe(['assignA']);
    // An invite code is unique across all coaches, so minting must see B's codes too.
    expect(Invite::codeTaken('INVB0000000000'))->toBeTrue()
        ->and(Invite::query()->whereKey('INVB0000000000')->exists())->toBeFalse()
        ->and(Invite::codeTaken('FREE000000000000'))->toBeFalse();
});

it('sees every coach\'s rows with no context — admin routes, the scheduler, the import', function () {
    foreach (TENANT_MODELS as $model) {
        expect($model::query()->count())->toBeGreaterThanOrEqual(2);
    }
    expect(Invite::query()->count())->toBe(3);
});

it('counts a coach\'s clients for the coach it is given, whatever the context', function () {
    expect(User::clientsOf($this->f->a)->count())->toBe(3)         // a1, a2 and the disabled d1
        ->and(User::activeClientsOf($this->f->a)->count())->toBe(2)  // the seats the licence cap counts
        ->and(User::clientsOf($this->f->b)->count())->toBe(1);
    app(CoachContext::class)->set($this->f->b);                    // the cap is counted outside coach routes too
    expect(User::activeClientsOf($this->f->a)->count())->toBe(2)
        ->and(User::query()->count())->toBe(8);                      // User itself is never scoped
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

it('shows progress photos to the client and whoever may coach them, as Node did', function () {
    $f = $this->f;
    expect(Access::canSeePhotos($f->a1, $f->a1))->toBeTrue()
        ->and(Access::canSeePhotos($f->a, $f->a1))->toBeTrue()
        ->and(Access::canSeePhotos($f->admin, $f->a1))->toBeTrue()
        ->and(Access::canSeePhotos($f->b, $f->a1))->toBeFalse()
        ->and(Access::canSeePhotos($f->a2, $f->a1))->toBeFalse()      // a fellow client
        ->and(Access::canSeePhotos($f->admin, $f->d1))->toBeFalse();  // through canCoachMember: not a disabled member
    $f->admin->disabled = true;
    expect(Access::canSeePhotos($f->admin, $f->a1))->toBeFalse();     // nor by a disabled admin
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

it('refuses to delete a coach who still has rows: no open code turns general, no history vanishes', function () {
    // Node never deleted an account; detachCoach revoked open codes and expired offers. The
    // database holds the line so a deletion cannot skip that path.
    expect(fn () => DB::table('users')->where('id', $this->f->b->id)->delete())->toThrow(QueryException::class);
    expect(Invite::query()->find('INVB0000000000')->coach_id)->toBe($this->f->b->id)
        ->and(Assignment::query()->find('assignB'))->not->toBeNull();
})->skip(fn () => DB::getDriverName() === 'sqlite' && ! DB::selectOne('PRAGMA foreign_keys')->foreign_keys, 'foreign keys are off on this SQLite connection');

it('leaves a deleted coach\'s clients unassigned, never pointing at an account that is gone', function () {
    $c = User::query()->create(['id' => 'tLoneCoach000000', 'name' => 'Lone', 'coach' => true]);
    $client = User::query()->create(['id' => 'tLoneClient00000', 'name' => 'Theirs', 'coach_id' => $c->id]);
    DB::table('users')->where('id', $c->id)->delete();   // no coaching rows, so allowed
    expect($client->fresh()->coach_id)->toBeNull();
})->skip(fn () => DB::getDriverName() === 'sqlite' && ! DB::selectOne('PRAGMA foreign_keys')->foreign_keys, 'foreign keys are off on this SQLite connection');
