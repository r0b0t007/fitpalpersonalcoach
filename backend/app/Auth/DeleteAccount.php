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
use App\Tenancy\CoachLock;
use App\Tenancy\Unlink;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Laragear\WebAuthn\Models\WebAuthnCredential;

/**
 * A client deleting their own account (CHW-363, DPIA measure M7): every record of them, then the
 * account. What their coach knew goes with it — the offers sent them, the notes written them,
 * what they said when they asked to join (health answers included) — as a release forgets it
 * (Unlink), and from every coach, not only the current one.
 *
 * Kept: the audit log's lines about them, the security record retention prunes (AUDIT_DAYS), and
 * the coach's own programs, which were never theirs. A coach's or an admin's account is not
 * deleted here: it holds other people's coaching.
 */
final class DeleteAccount
{
    public static function run(User $user): void
    {
        DB::transaction(function () use ($user): void {
            // The coach's row first, as every write to a coach's roster takes them, then theirs.
            if ($user->coach_id !== null) {
                CoachLock::take($user->coach_id);
            }
            $me = User::query()->whereKey($user->id)->lockForUpdate()->firstOrFail();
            Unlink::member($me, $me->coach_id);
            $id = $me->id;
            Assignment::acrossCoaches()->where('member_id', $id)->delete(); // across coaches: every coach's offers to them, which hold their id
            CoachNote::acrossCoaches()->where('member_id', $id)->delete(); // across coaches: every coach's notes to them
            // Their requests to anyone: by the account accept recorded, and by the address for one
            // no account was recorded on (JoinRequest::forgetMember's rule, for every coach).
            JoinRequest::acrossCoaches() // across coaches: every request they made, to anyone
                ->where(fn ($q) => $q->where('member_id', $id)->orWhere(fn ($q) => $q->whereNull('member_id')->where('email', $me->email ?? '')))
                ->delete();
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
        });
        // Their photos' files after the rows naming them are gone, as a photo's delete does: the
        // directory is theirs alone.
        (new Filesystem)->deleteDirectory(Paths::photoDir($user->id));
    }
}
