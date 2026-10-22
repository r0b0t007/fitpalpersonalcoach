<?php

// A licence by hand (CHW-268, spec §6 and §11): POST /api/admin/licence/grant and /revoke, and the
// audit rows the admin's role and assignment writes now leave.

use App\Domain\Entitlement;
use App\Models\Licence;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\Billing;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    Billing::on();
});

function grantAs(?User $who, array $body): TestResponse
{
    return test()->postJson('/api/admin/licence/grant', $body, $who ? bearer($who) : []);
}

function revokeAs(?User $who, array $body): TestResponse
{
    return test()->postJson('/api/admin/licence/revoke', $body, $who ? bearer($who) : []);
}

it('grants a coach a plan by hand and revokes it, and the entitlement follows', function () {
    $f = $this->f;
    expect(Entitlement::for($f->a)->canWrite)->toBeFalse();
    $res = grantAs($f->admin, ['id' => $f->a->id, 'plan' => 'pro'])->assertOk();
    expect($res->json())->toMatchArray(['ok' => true, 'id' => $f->a->id])
        ->and($res->json('entitlement'))->toMatchArray(['status' => 'manual', 'plan' => 'pro', 'cap' => 30, 'used' => 2, 'canWrite' => true, 'canTakeClient' => true]);
    $licence = Licence::query()->find($f->a->fresh()->licence_id);
    expect($licence)->toMatchArray(['user_id' => $f->a->id, 'source' => 'manual', 'status' => 'manual', 'plan' => 'pro'])
        ->and($licence->id)->toStartWith('lic_');
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.licence.grant', 'uid' => $f->admin->id, 'tgt' => $f->a->id, 'msg' => 'pro']);
    // The coach can write now.
    $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($f->a))->assertOk();

    // Granting again changes the plan on the same row.
    grantAs($f->admin, ['id' => $f->a->id, 'plan' => 'solo'])->assertOk()->assertJsonPath('entitlement.cap', 10);
    expect(Licence::query()->count())->toBe(1)->and(Licence::query()->first()->plan)->toBe('solo');

    revokeAs($f->admin, ['id' => $f->a->id])->assertOk()
        ->assertJsonPath('entitlement.status', 'none')->assertJsonPath('entitlement.canWrite', false);
    // The row stays as history, marked; nothing points at it.
    expect($f->a->fresh()->licence_id)->toBeNull()
        ->and(Licence::query()->count())->toBe(1)
        ->and(Licence::query()->first())->toMatchArray(['status' => 'revoked', 'plan' => 'solo'])
        ->and(Licence::query()->first()->canceled_at)->not->toBeNull();
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.licence.revoke', 'uid' => $f->admin->id, 'tgt' => $f->a->id]);
    $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($f->a))->assertStatus(402);
    // Revoked twice: nothing to revoke. Granted again: a new row, the revoked one untouched.
    revokeAs($f->admin, ['id' => $f->a->id])->assertStatus(400);
    grantAs($f->admin, ['id' => $f->a->id, 'plan' => 'pro'])->assertOk();
    expect(Licence::query()->where('status', 'manual')->count())->toBe(1)
        ->and(Licence::query()->where('status', 'revoked')->count())->toBe(1);
});

it('refuses nobody, a client, a plan it does not sell, and a coach and a non-admin', function () {
    $f = $this->f;
    grantAs(null, ['id' => $f->a->id, 'plan' => 'pro'])->assertStatus(401);
    grantAs($f->a, ['id' => $f->a->id, 'plan' => 'pro'])->assertStatus(403);
    revokeAs($f->a, ['id' => $f->a->id])->assertStatus(403);
    foreach ([['nope', 'pro'], [['x'], 'pro']] as [$id, $plan]) {
        grantAs($f->admin, ['id' => $id, 'plan' => $plan])->assertStatus(404)->assertExactJson(['error' => 'no such user']);
    }
    grantAs($f->admin, ['id' => $f->a1->id, 'plan' => 'pro'])->assertStatus(400)->assertExactJson(['error' => 'that user is not a coach']);
    $f->b->forceFill(['disabled' => true])->save();
    grantAs($f->admin, ['id' => $f->b->id, 'plan' => 'pro'])->assertStatus(400)->assertExactJson(['error' => 'that coach is disabled']);
    foreach (['gold', '', null, ['pro'], 'PRO'] as $plan) {
        grantAs($f->admin, ['id' => $f->a->id, 'plan' => $plan])->assertStatus(400)->assertExactJson(['error' => 'no such plan']);
    }
    revokeAs($f->admin, ['id' => 'nope'])->assertStatus(404)->assertExactJson(['error' => 'no such user']);
    revokeAs($f->admin, ['id' => $f->a->id])->assertStatus(400)->assertExactJson(['error' => 'that account has no granted plan to revoke']);
    expect(Licence::query()->count())->toBe(0)
        ->and($f->a->fresh()->licence_id)->toBeNull();
});

it('leaves a Creem subscription that can still bill alone, whether or not it writes today', function (string $status) {
    $f = $this->f;
    $paid = Billing::licence($f->a, ['status' => $status, 'plan' => 'solo']);
    grantAs($f->admin, ['id' => $f->a->id, 'plan' => 'studio'])->assertStatus(409)
        ->assertExactJson(['error' => 'that coach has a Creem subscription — change or cancel it there first']);
    revokeAs($f->admin, ['id' => $f->a->id])->assertStatus(400);
    expect($f->a->fresh()->licence_id)->toBe($paid->id)->and($paid->fresh()->plan)->toBe('solo');
})->with(['trialing', 'active', 'past_due', 'unpaid', 'paused']);

it('takes over a Creem licence that is over, even inside its paid period, and keeps its row', function (array $over) {
    $f = $this->f;
    $paid = Billing::licence($f->a, $over + ['plan' => 'solo']);
    grantAs($f->admin, ['id' => $f->a->id, 'plan' => 'studio'])->assertOk()->assertJsonPath('entitlement.status', 'manual');
    expect($f->a->fresh()->licence_id)->not->toBe($paid->id)
        ->and($paid->fresh()->status)->toBe($over['status']);
})->with([
    'canceled, paid until next month' => [['status' => 'canceled', 'period_end' => now()->addMonth()]],
    'expired' => [['status' => 'expired']],
    'a checkout never finished' => [['status' => 'pending']],
]);

it('does not take a licence that belongs to someone else', function () {
    $f = $this->f;
    $theirs = Billing::licence($f->b, ['status' => 'manual', 'source' => 'manual', 'plan' => 'pro']);
    $f->a->forceFill(['licence_id' => $theirs->id])->save();
    revokeAs($f->admin, ['id' => $f->a->id])->assertStatus(400);
    grantAs($f->admin, ['id' => $f->a->id, 'plan' => 'solo'])->assertOk();
    expect($theirs->fresh()->plan)->toBe('pro')
        ->and($f->b->fresh()->licence_id)->toBe($theirs->id)
        ->and(Licence::query()->find($f->a->fresh()->licence_id)->user_id)->toBe($f->a->id);
});

it('grants with billing off too, so the cutover can license the coach before Creem is set up', function () {
    config(['fitpal.creem.api_key' => '']);
    grantAs($this->f->admin, ['id' => $this->f->a->id, 'plan' => 'pro'])->assertOk()->assertJsonPath('entitlement.status', 'unlicensed');
    Billing::on();
    expect(Entitlement::for($this->f->a->fresh())->status)->toBe('manual');
});

it('records the admin\'s role and assignment changes, which Node never did', function () {
    $f = $this->f;
    $post = fn (string $route, array $body) => $this->postJson("/api/admin/user/$route", $body, bearer($f->admin))->assertOk();
    $count = fn (string $ev) => DB::table('audit_events')->where('ev', $ev)->count();
    $post('coach', ['id' => $f->u1->id, 'coach' => true]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.coach', 'uid' => $f->admin->id, 'tgt' => $f->u1->id]);
    $post('coach', ['id' => $f->u1->id, 'coach' => true]);   // already one: nothing changed
    expect($count('admin.user.coach'))->toBe(1);
    $post('coach', ['id' => $f->u1->id, 'coach' => false]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.uncoach', 'tgt' => $f->u1->id]);
    // An admin's own flag: they coach without it, so nothing was taken away.
    $f->admin->forceFill(['coach' => true])->save();
    $post('coach', ['id' => $f->admin->id, 'coach' => false]);
    expect($count('admin.user.uncoach'))->toBe(1);
    $post('assign-coach', ['id' => $f->u1->id, 'coachId' => $f->b->id]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.assign', 'tgt' => $f->u1->id, 'msg' => 'Coach B']);
    $post('assign-coach', ['id' => $f->u1->id, 'coachId' => $f->b->id]);   // already theirs
    $post('assign-coach', ['id' => $f->u1->id, 'coachId' => '']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.assign', 'tgt' => $f->u1->id, 'msg' => null]);
    $post('assign-coach', ['id' => $f->u1->id, 'coachId' => '']);   // already unassigned
    // A refused write records nothing.
    $this->postJson('/api/admin/user/assign-coach', ['id' => $f->u1->id, 'coachId' => $f->a1->id], bearer($f->admin))->assertStatus(400);
    expect(DB::table('audit_events')->where('ev', 'admin.user.assign')->count())->toBe(2);
});
