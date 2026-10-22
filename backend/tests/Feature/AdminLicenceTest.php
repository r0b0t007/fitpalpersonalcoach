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
    expect($f->a->fresh()->licence_id)->toBeNull()->and(Licence::query()->count())->toBe(0);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.licence.revoke', 'uid' => $f->admin->id, 'tgt' => $f->a->id]);
    $this->postJson('/api/coach/invites/new', ['note' => 'x'], bearer($f->a))->assertStatus(402);
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
    foreach (['gold', '', null, ['pro'], 'PRO'] as $plan) {
        grantAs($f->admin, ['id' => $f->a->id, 'plan' => $plan])->assertStatus(400)->assertExactJson(['error' => 'no such plan']);
    }
    revokeAs($f->admin, ['id' => 'nope'])->assertStatus(404)->assertExactJson(['error' => 'no such user']);
    revokeAs($f->admin, ['id' => $f->a->id])->assertStatus(400)->assertExactJson(['error' => 'that account has no granted plan to revoke']);
    expect(Licence::query()->count())->toBe(0)
        ->and($f->a->fresh()->licence_id)->toBeNull();
});

it('leaves a coach who pays through Creem alone, and replaces a Creem licence that has ended', function () {
    $f = $this->f;
    $paid = Billing::licence($f->a, ['status' => 'active', 'plan' => 'solo']);
    grantAs($f->admin, ['id' => $f->a->id, 'plan' => 'studio'])->assertStatus(409)
        ->assertExactJson(['error' => 'that coach pays through Creem — change their plan there']);
    revokeAs($f->admin, ['id' => $f->a->id])->assertStatus(400);
    expect($f->a->fresh()->licence_id)->toBe($paid->id)->and($paid->fresh()->plan)->toBe('solo');

    // Past due is still paying (Creem is retrying): refused too.
    $paid->forceFill(['status' => 'past_due'])->save();
    grantAs($f->admin, ['id' => $f->a->id, 'plan' => 'studio'])->assertStatus(409);

    // Ended: the grant takes over; the Creem row stays, as the record of what was paid.
    $paid->forceFill(['status' => 'expired'])->save();
    grantAs($f->admin, ['id' => $f->a->id, 'plan' => 'studio'])->assertOk()->assertJsonPath('entitlement.status', 'manual');
    expect($f->a->fresh()->licence_id)->not->toBe($paid->id)
        ->and($paid->fresh())->not->toBeNull();
});

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
    $post('coach', ['id' => $f->u1->id, 'coach' => true]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.coach', 'uid' => $f->admin->id, 'tgt' => $f->u1->id]);
    $post('coach', ['id' => $f->u1->id, 'coach' => false]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.uncoach', 'tgt' => $f->u1->id]);
    $post('assign-coach', ['id' => $f->u1->id, 'coachId' => $f->b->id]);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.assign', 'tgt' => $f->u1->id, 'msg' => $f->b->id]);
    $post('assign-coach', ['id' => $f->u1->id, 'coachId' => '']);
    $this->assertDatabaseHas('audit_events', ['ev' => 'admin.user.assign', 'tgt' => $f->u1->id, 'msg' => null]);
    // A refused write records nothing.
    $this->postJson('/api/admin/user/assign-coach', ['id' => $f->u1->id, 'coachId' => $f->a1->id], bearer($f->admin))->assertStatus(400);
    expect(DB::table('audit_events')->where('ev', 'admin.user.assign')->count())->toBe(2);
});
