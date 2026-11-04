<?php

// The done-for-you setup (CHW-348): the owner builds a coach's program in their own library and
// copies it into the coach's from the panel, because they cannot sign in as the coach.

use App\Admin\Accounts;
use App\Filament\Resources\Users\Pages\ListUsers;
use App\Http\Controllers\CoachProgramController;
use App\Models\CoachProgram;
use App\Support\ClientSafe;
use Filament\Actions\Testing\TestAction;
use Illuminate\Http\Request;
use Livewire\Livewire;
use Tests\Support\Billing;
use Tests\Support\Coaching;

const COPY_BUNDLE = '{"opengym_plan":1,"name":"old","week":{"1":["r1"]},"routines":[{"id":"r1","name":"Push","ex":[{"id":"0025","sets":3}]}],"customEx":[]}';

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    $this->made = Coaching::own(new CoachProgram, $this->f->admin, [
        'program_id' => 'prog-made', 'name' => 'Prise de masse 12 semaines', 'bundle' => COPY_BUNDLE, 'created' => 1, 'updated' => 1,
    ]);
});

/** @return list<CoachProgram> $coach's library in order, read straight from the table */
function programsOf(string $coachId): array
{
    return CoachProgram::query()->where('coach_id', $coachId)->orderBy('id')->get()->all();
}

it('copies one of the owner\'s programs into a coach\'s library under a new id, audited', function () {
    $f = $this->f;
    $this->actingAs($f->admin, 'web');
    Livewire::test(ListUsers::class)->callAction(TestAction::make('copyProgram')->table($f->a), ['programId' => 'prog-made'])
        ->assertNotified('Program copied');

    $copy = collect(programsOf($f->a->id))->firstWhere('name', 'Prise de masse 12 semaines');
    expect($copy)->not->toBeNull()
        ->and($copy->program_id)->not->toBe('prog-made')
        ->and(json_decode($copy->bundle)->name)->toBe('Prise de masse 12 semaines')   // the row's name wins, as a save's does
        ->and(json_decode($copy->bundle)->week)->toEqual((object) ['1' => ['r1']]);
    // The owner's own row is untouched, and nothing links the two: the copy is the coach's.
    expect($this->made->fresh()->only(['coach_id', 'program_id']))->toBe(['coach_id' => $f->admin->id, 'program_id' => 'prog-made']);
    // By the copy's id: a program's name often names a person, and msg carries ids.
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.program.copy', 'uid' => $f->admin->id, 'tgt' => $f->a->id, 'msg' => $copy->program_id]);
    // A second submit, or a retry, does not add a second copy.
    Livewire::test(ListUsers::class)->callAction(TestAction::make('copyProgram')->table($f->a), ['programId' => 'prog-made'])
        ->assertNotified('that coach already has a program called Prise de masse 12 semaines');
    expect(collect(programsOf($f->a->id))->where('name', 'Prise de masse 12 semaines')->count())->toBe(1);
    // And the coach sees it in their own library, through their own route.
    expect(collect($this->getJson('/api/coach/programs', bearer($f->a))->assertOk()->json('programs'))->pluck('name'))->toContain('Prise de masse 12 semaines');
});

it('offers only the owner\'s own programs, and only on coaches other than the owner', function () {
    $f = $this->f;
    $this->actingAs($f->admin, 'web');
    Livewire::test(ListUsers::class)
        ->assertActionVisible(TestAction::make('copyProgram')->table($f->a))
        ->assertActionHidden(TestAction::make('copyProgram')->table($f->u1))
        ->assertActionHidden(TestAction::make('copyProgram')->table($f->admin));
    // Another coach's program is "no such program", not a way to move it between coaches.
    $req = Request::create('/');
    expect(fn () => Accounts::copyProgram($req, $f->admin, $f->a->id, 'prog-b'))
        ->toThrow(ClientSafe::class, 'no such program');
    expect(collect(programsOf($f->a->id))->pluck('program_id')->all())->toBe(['prog-a']);
    // Not into the owner's own library either, whoever calls it.
    expect(fn () => Accounts::copyProgram($req, $f->admin, $f->admin->id, 'prog-made'))->toThrow(ClientSafe::class, 'that is your own library');
    expect(count(programsOf($f->admin->id)))->toBe(2);
    // The list holds what the copy would take: prog-admin, from before the bundle rules, is left out.
    expect(Accounts::copyablePrograms($f->admin))->toBe(['prog-made' => 'Prise de masse 12 semaines']);
});

it('refuses a client, a disabled coach, a full library and a bundle a save would refuse', function () {
    $f = $this->f;
    $req = Request::create('/');
    expect(fn () => Accounts::copyProgram($req, $f->admin, $f->u1->id, 'prog-made'))->toThrow(ClientSafe::class, 'that user is not a coach');
    $f->b->forceFill(['disabled' => true])->save();
    expect(fn () => Accounts::copyProgram($req, $f->admin, $f->b->id, 'prog-made'))->toThrow(ClientSafe::class, 'that coach is disabled');
    // A coach whose plan does not write: their own save would be refused (RequireWriter).
    Billing::on();
    expect(fn () => Accounts::copyProgram($req, $f->admin, $f->a->id, 'prog-made'))->toThrow(ClientSafe::class, 'that coach’s plan is read-only — grant them a plan first');
    Billing::licence($f->a, ['status' => 'active', 'plan' => 'solo']);
    // A row from before a validation rule: copied, it would be a program the coach cannot send.
    expect(fn () => Accounts::copyProgram($req, $f->admin, $f->a->id, 'prog-admin'))->toThrow(ClientSafe::class, 'not a plan bundle');
    // The coach's cap holds, worded for the owner.
    for ($i = 1; $i < CoachProgramController::MAX; $i++) {
        Coaching::own(new CoachProgram, $f->a, ['program_id' => "fill-$i", 'name' => "Fill $i", 'bundle' => '{}', 'created' => 1, 'updated' => 1]);
    }
    expect(fn () => Accounts::copyProgram($req, $f->admin, $f->a->id, 'prog-made'))
        ->toThrow(ClientSafe::class, 'that coach has 50 programs — they must delete one first');
    expect(count(programsOf($f->a->id)))->toBe(CoachProgramController::MAX);
    $this->assertDatabaseMissing('audit_events', ['ev' => 'admin.program.copy']);
});

it('finds a new coach by the address they signed up with, confirmed or not', function () {
    $f = $this->f;
    $f->a->forceFill(['email' => null, 'pending_email' => 'sara@example.com'])->save();
    $f->b->forceFill(['email' => 'coachb@example.com'])->save();
    $this->actingAs($f->admin, 'web');
    Livewire::test(ListUsers::class)->searchTable('sara@example.com')
        ->assertCanSeeTableRecords([$f->a])->assertCanNotSeeTableRecords([$f->b])
        ->assertTableColumnStateSet('email', 'sara@example.com (unconfirmed)', $f->a);
    Livewire::test(ListUsers::class)->searchTable('coachb@')->assertCanSeeTableRecords([$f->b])->assertCanNotSeeTableRecords([$f->a]);
    // A change of address under way: found by the new one, and shown with both.
    $f->b->forceFill(['pending_email' => 'new-b@example.com'])->save();
    Livewire::test(ListUsers::class)->searchTable('new-b@')->assertCanSeeTableRecords([$f->b])
        ->assertTableColumnStateSet('email', 'coachb@example.com → new-b@example.com (unconfirmed)', $f->b);
});
