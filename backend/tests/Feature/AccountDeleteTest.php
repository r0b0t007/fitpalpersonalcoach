<?php

// A client deleting their own account (CHW-363, DPIA measure M7): with a session that proved the
// account just now, every record of them goes, from every coach — and nothing else does.

use App\Auth\FreshAuth;
use App\Auth\SessionToken;
use App\Media\Paths;
use App\Models\Assignment;
use App\Models\CoachNote;
use App\Models\Invite;
use App\Models\JoinRequest;
use App\Models\User;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;
use Tests\Support\Coaching;
use Tests\Support\Passkey;

beforeEach(function () {
    Mail::fake();
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173',
        'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost']);
    $this->dataDir = sys_get_temp_dir().'/fitpal-delete-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir]);
    $this->f = Coaching::twoCoaches();
    $this->f->a1->forceFill(['email' => 'a1@example.com'])->save();
});

afterEach(function () {
    (new Filesystem)->deleteDirectory($this->dataDir);
});

/** A session that signed in just now, by passkey or emailed code. */
function deleteFresh(User $user): array
{
    $token = SessionToken::make($user);
    FreshAuth::mark($token);

    return ['Authorization' => 'Bearer '.$token];
}

function deleteNote(User $coach, User $member, string $id): void
{
    Coaching::own(new CoachNote, $coach, ['id' => $id, 'member_id' => $member->id, 'ref_type' => 'checkin', 'ref_key' => '2026-11-01', 'body' => 'Nice', 'created' => 1]);
}

function deleteRequest(User $coach, string $email, ?User $member, string $status): string
{
    $id = JoinRequest::newId();
    Coaching::own(new JoinRequest, $coach, ['id' => $id, 'email' => $email, 'name' => 'Asker', 'intake' => '{"injuries":"knee"}',
        'status' => $status, 'member_id' => $member?->id, 'created' => 1, 'decided' => $member ? 1 : null]);

    return $id;
}

/**
 * Every row anywhere holding $needle in any column, but the audit log: what a deletion must leave
 * none of. Read off the schema, so a table added later is covered without anyone remembering it.
 *
 * @return list<string> table.column
 */
function deleteLeftovers(string $needle): array
{
    $found = [];
    foreach (Schema::getTableListing(schemaQualified: false) as $table) {
        if (in_array($table, ['audit_events', 'migrations'], true)) {
            continue;
        }
        foreach (Schema::getColumnListing($table) as $column) {
            if (DB::table($table)->where($column, $needle)->exists()) {
                $found[] = "$table.$column";
            }
        }
    }

    return $found;
}

it('deletes every record of a client, from every coach, and leaves everyone else alone', function () {
    $f = $this->f;
    $me = $f->a1;
    // Their training state, a progress photo with its file, a phone to push to, presence.
    $this->putJson('/api/data', ['state' => ['workouts' => [['d' => '2026-11-01']], 'checkins' => [['d' => '2026-11-01', 'weight' => 70]]]], deleteFresh($me))->assertOk();
    $dir = Paths::photoDir($me->id, create: true);
    file_put_contents($dir.'/abc.jpg', 'jpeg');
    DB::table('progress_photos')->insert(['id' => 'photo1', 'user_id' => $me->id, 'd' => '2026-11-01', 'pose' => 'front', 'file' => 'abc.jpg', 'bytes' => 4, 'mime' => 'image/jpeg', 'created' => '2026-11-01']);
    DB::table('push_subscriptions')->insert(['user_id' => $me->id, 'endpoint' => 'https://push.example/a1', 'endpoint_hash' => hash('sha256', 'https://push.example/a1'), 'p256dh' => 'k', 'auth' => 'a', 'created' => 1]);
    DB::table('presence')->insert(['user_id' => $me->id, 'payload' => '{}', 'updated_at' => 1]);
    DB::table('sessions')->insert(['id' => 'sess1', 'user_id' => $me->id, 'payload' => '', 'last_activity' => 1]);
    // A sign-in link mailed to them, and a passkey.
    $this->postJson('/api/login/email', ['email' => 'a1@example.com'])->assertOk();
    $options = $this->postJson('/api/passkeys/options', [], deleteFresh($me))->assertOk();
    $this->postJson('/api/passkeys/verify', ['cid' => $options->json('cid'), 'credential' => (new Passkey)->attest($options->json('options'))], deleteFresh($me))->assertOk();
    // What coaches hold of them: notes from both, the request that made them A's client, one
    // they sent B by address, the invite they redeemed. Offers from both are in the fixture.
    deleteNote($f->a, $me, 'noteA');
    deleteNote($f->b, $me, 'noteB');
    deleteRequest($f->a, 'a1@example.com', $me, 'accepted');
    deleteRequest($f->b, 'a1@example.com', null, 'pending');
    (new Invite)->forceFill(['code' => 'USEDBYA1000000', 'note' => '', 'created_by' => $f->a->id, 'coach_id' => $f->a->id, 'created' => '2026-11-01T00:00:00.000Z', 'used_by' => $me->id, 'used_at' => '2026-11-01T00:00:00.000Z'])->save();
    // Someone else's, which stay.
    deleteNote($f->b, $f->b1, 'noteB1');
    $theirs = deleteRequest($f->b, 'someone@example.com', null, 'pending');
    expect(deleteLeftovers($me->id))->not->toBe([]);

    $res = $this->postJson('/api/account/delete', [], deleteFresh($me))->assertOk()->assertExactJson(['ok' => true]);
    expect(implode("\n", $res->headers->all('set-cookie')))->toContain('Max-Age=0');

    expect(deleteLeftovers($me->id))->toBe([])
        ->and(deleteLeftovers('a1@example.com'))->toBe([])
        ->and(is_dir($dir))->toBeFalse();
    // Everyone else's coaching is as it was.
    expect(User::query()->whereKey([$f->a->id, $f->b->id, $f->a2->id, $f->b1->id])->count())->toBe(4)
        ->and(Assignment::acrossCoaches()->whereKey('assignB')->exists())->toBeTrue() // across coaches: the test reads B's offer
        ->and(CoachNote::acrossCoaches()->whereKey('noteB1')->exists())->toBeTrue() // across coaches: the test reads B's note
        ->and(JoinRequest::acrossCoaches()->whereKey($theirs)->exists())->toBeTrue() // across coaches: the test reads B's request
        // The spent invite they redeemed goes, rather than open again for anyone.
        ->and(Invite::acrossCoaches()->where('code', 'USEDBYA1000000')->exists())->toBeFalse(); // across coaches: the test reads A's invite
    // The security log says who, and the old session opens nothing.
    $this->assertDatabaseHas('audit_events', ['ev' => 'account.delete', 'uid' => $me->id, 'name' => 'Client A1']);
    $this->getJson('/api/me', deleteFresh($f->a2))->assertOk();
    $this->getJson('/api/me', ['Authorization' => 'Bearer '.SessionToken::make($me)])->assertUnauthorized();
});

it('wants a sign-in from just now, so a session left open cannot do it', function () {
    $this->postJson('/api/account/delete', [], bearer($this->f->a1))
        ->assertForbidden()->assertExactJson(['error' => 'sign in again to do this — it needs a recent sign-in']);
    expect(User::query()->whereKey($this->f->a1->id)->exists())->toBeTrue();
});

it("does not delete a coach's or an admin's account: it holds other people's coaching", function () {
    foreach ([$this->f->a, $this->f->admin] as $who) {
        $this->postJson('/api/account/delete', [], deleteFresh($who))
            ->assertForbidden()->assertExactJson(['error' => 'a coach account is closed on request — write to us']);
        expect(User::query()->whereKey($who->id)->exists())->toBeTrue();
    }
});

it('deletes a client with no coach and nothing else to their name', function () {
    $this->postJson('/api/account/delete', [], deleteFresh($this->f->u1))->assertOk();
    expect(deleteLeftovers($this->f->u1->id))->toBe([]);
});
