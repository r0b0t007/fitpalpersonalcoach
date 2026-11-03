<?php

namespace App\Auth;

use App\Media\Paths;
use App\Models\Assignment;
use App\Models\CoachNote;
use App\Models\Invite;
use App\Models\JoinRequest;
use App\Models\LoginLink;
use App\Models\Presence;
use App\Models\ProgressPhoto;
use App\Models\PushSubscription;
use App\Models\User;
use App\Models\UserState;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Laragear\WebAuthn\Models\WebAuthnCredential;

/**
 * A client deleting their own account (CHW-363, DPIA measure M7): every record of them, then the
 * account. What any coach knew goes with it — the offers sent them, the notes written them, what
 * they said when they asked to join (health answers included) — from every coach, not only the
 * current one.
 *
 * Kept: the audit log's lines about them, the security record retention prunes (AUDIT_DAYS), and
 * the coach's own programs, which were never theirs. Not for an account that coaches or ever did
 * (User::holdsCoaching): it holds other people's coaching.
 *
 * Their row is locked first, as a sync, a photo upload and a consent change lock it, so one in
 * flight either lands before and is deleted here, or finds the account gone and writes nothing. No
 * coach's row is taken: a release's lock order guards the coach's seats, and an account leaving
 * frees one. A deadlock with a coach's write to them is retried.
 */
final class DeleteAccount
{
    private const ATTEMPTS = 3;

    public static function run(User $user): void
    {
        DB::transaction(function () use ($user): void {
            $me = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            $id = $me->id;
            Assignment::acrossCoaches()->where('member_id', $id)->delete(); // across coaches: every coach's offers to them, which hold their id
            CoachNote::acrossCoaches()->where('member_id', $id)->delete(); // across coaches: every coach's notes to them
            JoinRequest::forgetEverywhere($me);
            // The invite they redeemed, spent: deleted, not cleared — an invite with no user is open
            // again (InviteGate::redeemable).
            Invite::acrossCoaches()->where('used_by', $id)->delete(); // across coaches: whoever's invite they redeemed
            ProgressPhoto::of($id)->delete();
            UserState::query()->whereKey($id)->delete();
            PushSubscription::query()->where('user_id', $id)->delete();
            Presence::query()->where('user_id', $id)->delete();
            LoginLink::query()->where('user_id', $id)->delete();
            WebAuthnCredential::query()->where('authenticatable_id', $id)->delete();
            DB::table('sessions')->where('user_id', $id)->delete();
            $me->delete();
        }, self::ATTEMPTS);
        // Their photos' files after the rows naming them are gone, as a photo's delete does: the
        // directory is theirs alone.
        (new Filesystem)->deleteDirectory(Paths::photoDir($user->id));
    }
}
