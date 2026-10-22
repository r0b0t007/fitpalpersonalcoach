<?php

// The owner's Filament panel (CHW-273, spec §8): admins only, and every action the admin API's own
// (App\Admin\Accounts), audited as its twin is.

use App\Filament\Resources\AuditEvents\Pages\ListAuditEvents;
use App\Filament\Resources\BillingEvents\Pages\ListBillingEvents;
use App\Filament\Resources\ExerciseMedia\Pages\ListExerciseMedia;
use App\Filament\Resources\Invites\Pages\ListInvites;
use App\Filament\Resources\Licences\Pages\ListLicences;
use App\Filament\Resources\Users\Pages\ListUsers;
use App\Http\Request as AppRequest;
use App\Media\Paths;
use App\Models\ExerciseMedia;
use App\Models\Invite;
use App\Models\Licence;
use App\Models\User;
use Filament\Actions\Testing\TestAction;
use Filament\Auth\Pages\Login;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Route;
use Livewire\Livewire;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;
use Tests\Support\Billing;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    $this->f->admin->forceFill(['email' => 'owner@example.com', 'password' => 'a-long-owner-password'])->save();
    $this->dataDir = sys_get_temp_dir().'/fitpal-panel-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir]);
});

/**
 * Signed in to the panel as a browser is: the `web` guard's session key. (TestCase::call forgets
 * guards before each request, so actingAs() does not reach a page request.)
 */
function panelAs(User $user): void
{
    test()->withSession([auth('web')->getName() => $user->id]);
}

afterEach(function () {
    (new Filesystem)->deleteDirectory($this->dataDir);
});

it('sends a guest to the panel\'s sign-in, and refuses everyone who is not an admin', function () {
    $this->get('/admin-panel')->assertRedirect('/admin-panel/login');
    $this->get('/admin-panel/login')->assertOk();
    $f = $this->f;
    $f->a->forceFill(['email' => 'coach.a@example.com', 'password' => 'a-long-coach-password'])->save();
    panelAs($f->a);
    $this->get('/admin-panel')->assertForbidden();
    // A disabled admin is refused too.
    $f->admin->forceFill(['disabled' => true])->save();
    panelAs($f->admin);
    $this->get('/admin-panel')->assertForbidden();
});

it('signs the owner in with email and password, and shows every page', function () {
    // The sign-in itself: email and password, on the panel's own page.
    Livewire::test(Login::class)->fillForm(['email' => 'owner@example.com', 'password' => 'a-long-owner-password'])->call('authenticate')->assertHasNoFormErrors();
    expect(auth('web')->id())->toBe($this->f->admin->id);
    panelAs($this->f->admin);
    foreach (['', '/users', '/licences', '/billing-events', '/invites', '/audit-events', '/exercise-media'] as $page) {
        $this->get('/admin-panel'.$page)->assertOk();
    }
});

it('keeps the API\'s JSON handling off the panel and its Livewire endpoint, and on everything else', function () {
    $route = collect(Route::getRoutes()->getRoutes())->first(fn ($r) => str_ends_with((string) $r->getName(), 'livewire.update'));
    expect($route)->not->toBeNull();
    foreach (['/'.$route->uri(), '/api/'.$route->uri(), '/admin-panel', '/api/admin-panel/users', '/livewire-0123abcd/update'] as $path) {
        expect(AppRequest::isJsonApi(SymfonyRequest::create($path)))->toBeFalse($path);
    }
    foreach (['/api/me', '/me', '/api/admin/users', '/livewire-not-hex/update', '/api/livewirex'] as $path) {
        expect(AppRequest::isJsonApi(SymfonyRequest::create($path)))->toBeTrue($path);
    }
});

it('disables, re-enables and makes coaches through the admin API\'s own code, audited as the API is', function () {
    $f = $this->f;
    $this->actingAs($f->admin, 'web');
    Livewire::test(ListUsers::class)->callAction(TestAction::make('disable')->table($f->b))->assertNotified('Account disabled');
    expect($f->b->fresh()->disabled)->toBeTrue()
        ->and($f->b1->fresh()->coach_id)->toBeNull();   // a disabled coach is detached, as on the API
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.disable', 'uid' => $f->admin->id, 'tgt' => $f->b->id]);
    Livewire::test(ListUsers::class)->callAction(TestAction::make('enable')->table($f->b->fresh()));
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.enable', 'tgt' => $f->b->id]);
    Livewire::test(ListUsers::class)->callAction(TestAction::make('makeCoach')->table($f->u1));
    expect($f->u1->fresh()->coach)->toBeTrue();
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.coach', 'tgt' => $f->u1->id]);
});

it('assigns a client to a coach, and shows a refusal as the API words it', function () {
    $f = $this->f;
    $this->actingAs($f->admin, 'web');
    Livewire::test(ListUsers::class)->callAction(TestAction::make('assignCoach')->table($f->u1), ['coachId' => $f->b->id])->assertNotified('Coach updated');
    expect($f->u1->fresh()->coach_id)->toBe($f->b->id);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.assign', 'tgt' => $f->u1->id, 'msg' => $f->b->id]);
    // A refusal is shown as the API words it: a coach still paying through Creem.
    Billing::on();
    Billing::licence($f->b, ['status' => 'active', 'plan' => 'solo']);
    Livewire::test(ListUsers::class)->callAction(TestAction::make('grant')->table($f->b), ['plan' => 'pro'])
        ->assertNotified('that coach has a Creem subscription — change or cancel it there first');
    expect(Licence::query()->find($f->b->fresh()->licence_id)->source)->toBe('creem');
});

it('grants and revokes a plan by hand, from Users and from Licences', function () {
    $f = $this->f;
    Billing::on();
    $this->actingAs($f->admin, 'web');
    Livewire::test(ListUsers::class)->callAction(TestAction::make('grant')->table($f->a), ['plan' => 'pro']);
    expect(Licence::query()->find($f->a->fresh()->licence_id)?->only(['source', 'plan']))->toBe(['source' => 'manual', 'plan' => 'pro']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.licence.grant', 'tgt' => $f->a->id, 'msg' => 'pro']);
    $licence = Licence::query()->find($f->a->fresh()->licence_id);
    Livewire::test(ListLicences::class)->callAction(TestAction::make('revoke')->table($licence));
    expect($f->a->fresh()->licence_id)->toBeNull()->and($licence->fresh()->status)->toBe('revoked');
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.licence.revoke', 'tgt' => $f->a->id]);
    Livewire::test(ListLicences::class)->callAction(TestAction::make('grant')->table(), ['coach' => $f->b->id, 'plan' => 'studio']);
    expect(Licence::query()->find($f->b->fresh()->licence_id)?->plan)->toBe('studio');
});

it('mints and revokes invite codes as the admin API does', function () {
    $f = $this->f;
    $this->actingAs($f->admin, 'web');
    $before = Invite::query()->count();
    Livewire::test(ListInvites::class)->callAction(TestAction::make('mint')->table(), ['note' => 'for the gym']);
    $code = Invite::query()->where('note', 'for the gym')->sole();
    expect(Invite::query()->count())->toBe($before + 1)->and($code->coach_id)->toBeNull();
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.invite.create', 'msg' => $code->code]);
    // Any coach's code, too: no coach context here.
    $theirs = Invite::query()->find('INVB0000000000');
    Livewire::test(ListInvites::class)->callAction(TestAction::make('revoke')->table($theirs));
    expect($theirs->fresh()->revoked)->toBeTrue();
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.invite.revoke', 'msg' => 'INVB0000000000']);
});

it('deletes an exercise demo, row and file, keeping a file another row still names', function () {
    $f = $this->f;
    $this->actingAs($f->admin, 'web');
    $dir = Paths::dir('ex');
    file_put_contents($dir.'/0001-a.mp4', 'video');
    $row = ExerciseMedia::query()->find('mediaa');
    Livewire::test(ListExerciseMedia::class)->callAction(TestAction::make('delete')->table($row))->assertNotified('Demo deleted');
    expect(ExerciseMedia::query()->find('mediaa'))->toBeNull()->and(is_file($dir.'/0001-a.mp4'))->toBeFalse();
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.media.delete', 'uid' => $f->admin->id, 'msg' => 'mediaa']);

    // Two rows naming one file: the file stays for the other.
    file_put_contents($dir.'/0001-b.mp4', 'video');
    DB::table('exercise_media')->where('id', 'mediaadmin')->update(['file' => '0001-b.mp4']);
    Livewire::test(ListExerciseMedia::class)->callAction(TestAction::make('delete')->table(ExerciseMedia::query()->find('mediab')));
    expect(is_file($dir.'/0001-b.mp4'))->toBeTrue();
});

it('lists the activity log and the billing events, read-only', function () {
    $this->actingAs($this->f->admin, 'web');
    Livewire::test(ListAuditEvents::class)->assertSuccessful();
    Livewire::test(ListBillingEvents::class)->assertSuccessful();
});

it('sets the owner\'s panel sign-in on the admin account itself, and on no one else', function () {
    $f = $this->f;
    $this->artisan('fitpal:panel-login', ['id' => $f->admin->id])
        ->expectsQuestion('Email', 'Boss@Example.com')
        ->expectsQuestion('Password (at least 12 characters)', 'correct horse battery')
        ->expectsQuestion('The same again', 'correct horse battery')
        ->assertSuccessful();
    $admin = $f->admin->fresh();
    expect($admin->email)->toBe('boss@example.com')
        ->and(Hash::check('correct horse battery', $admin->password))->toBeTrue();
    $this->artisan('fitpal:panel-login', ['id' => $f->a->id])->assertFailed();
    $this->artisan('fitpal:panel-login', ['id' => $f->admin->id])
        ->expectsQuestion('Email', 'boss@example.com')
        ->expectsQuestion('Password (at least 12 characters)', 'short')
        ->assertFailed();
});
