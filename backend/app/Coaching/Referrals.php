<?php

namespace App\Coaching;

use App\Audit\Audit;
use App\Models\CoachPage;
use App\Models\JoinRequest;
use App\Models\ReferralCredit;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Js;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Coach referrals (CHW-350, docs/superpowers/specs/2026-11-07-coach-referrals-design.md). A coach
 * shares fitpal.ma/?ref=<their page's handle>, and the ref rides the URLs to the sign-up. A coach
 * who signs up through it, and whose join-request client trains, banks the referrer one month.
 * Banked only: no licence changes here. The owner applies a month when the coach pays.
 */
final class Referrals
{
    /** A ref as a link carries it, or null for one that is no public page's handle. */
    public static function normaliseRef(mixed $raw): ?string
    {
        $handle = Handle::normalise($raw);

        return Handle::valid($handle) && ! Handle::reserved($handle) ? $handle : null;
    }

    /**
     * The coach a new coach's ref names, while they coach (an enabled coach with that page), and
     * never one whose own address is the new coach's. Null otherwise: the sign-up goes ahead
     * without one.
     */
    public static function referrerFor(?string $ref, string $email): ?User
    {
        $handle = self::normaliseRef($ref);
        if ($handle === null) {
            return null;
        }
        [, $coach] = CoachPage::findPublic($handle);
        if ($coach === null || in_array(mb_strtolower($email), self::addressesOf($coach), true)) {
            return null;
        }

        return $coach;
    }

    /**
     * Every address a coach holds, confirmed or not (a new coach's is pending until their first
     * link), lower-cased.
     *
     * @return list<string>
     */
    private static function addressesOf(User $coach): array
    {
        return array_values(array_filter([
            $coach->email === null ? null : mb_strtolower($coach->email),
            $coach->pending_email === null ? null : mb_strtolower($coach->pending_email),
        ]));
    }

    /** Referred coaches looked at per run: one run stays well inside the host's 50 s. */
    public const BATCH = 500;

    /**
     * The first coach terms whose Part B §2 makes the activation check the referred coach's own
     * instruction (CHW-372). The check reads that coach's client data, so a coach who accepted no
     * terms, or only earlier ones, is never looked at. Versions are dates, so later ones compare
     * above it; a later version that drops the instruction must raise this.
     */
    public const TERMS_FROM = '2026-11-07';

    /**
     * Whether $coach has activated, for the referral: a client who came through their page (a
     * join request they accepted) is still on their roster and has trained since, and asked with
     * an address that is neither coach's. Trained since goes by the last workout's date, because
     * an account can sync history it logged elsewhere and the server's time of the first save
     * proves nothing alone: a later UTC day than the acceptance, or the acceptance's own day
     * with the first save at or after the acceptance.
     */
    public static function activated(User $coach, User $referrer): bool
    {
        $coachEmails = [...self::addressesOf($coach), ...self::addressesOf($referrer)];
        $rows = JoinRequest::acceptedClientActivity($coach);
        foreach ($rows as $r) {
            if (in_array(mb_strtolower(trim((string) $r->email)), $coachEmails, true)) {
                continue;
            }
            $decided = (int) $r->decided;
            if ($r->last_workout === null) {
                continue;
            }
            $day = gmdate('Y-m-d', intdiv($decided, 1000));
            if ($r->last_workout > $day || ($r->last_workout === $day && $r->first_workout_at !== null && (int) $r->first_workout_at >= $decided)) {
                return true;
            }
        }

        return false;
    }

    /**
     * The hourly pass (fitpal:referral-credits): one month for the referrer of each referred
     * coach who has activated and has no credit yet. The unique index on referred_id makes a
     * second run, or two at once, insert nothing. Returns how many were banked. Most referred
     * coaches never activate, so a fixed first $batch would starve the rest: a cursor in the cache
     * (referrals:cursor) moves each run past the last id looked at, and wraps to the start once a
     * run finds fewer than $batch.
     */
    public static function creditDue(Request $request, int $batch = self::BATCH): int
    {
        // Without join requests no referral can activate, and none has to be looked at.
        if (! config('fitpal.join_requests')) {
            return 0;
        }
        $cursor = (string) Cache::get('referrals:cursor', '');
        // Only coaches with an accepted client can have activated.
        $referred = User::query()
            ->whereNotNull('referred_by')->where('coach', true)->where('disabled', false)
            ->where('terms_version', '>=', self::TERMS_FROM)
            ->whereIn('id', JoinRequest::coachIdsWithAccepted())
            ->whereNotExists(fn ($q) => $q->from('referral_credits')->whereColumn('referral_credits.referred_id', 'users.id'))
            ->where('id', '>', $cursor)
            ->orderBy('id')->limit($batch)->get();
        Cache::forever('referrals:cursor', $referred->count() < $batch ? '' : $referred->last()->id);
        $referrers = User::query()->whereIn('id', $referred->pluck('referred_by'))->get()->keyBy('id');
        $banked = 0;
        foreach ($referred as $coach) {
            $referrer = $referrers->get($coach->referred_by);
            if ($referrer === null || ! $referrer->isCoach() || $referrer->disabled || ! self::activated($coach, $referrer)) {
                continue;
            }
            try {
                ReferralCredit::query()->create([
                    'id' => ReferralCredit::newId(), 'referrer_id' => $referrer->id, 'referred_id' => $coach->id,
                    'months' => 1, 'created' => Js::nowMs(),
                ]);
            } catch (UniqueConstraintViolationException) {
                continue;   // another run banked it first
            }
            Audit::record($request, 'coach.referral.credit', ['user' => $referrer, 'target' => $coach]);
            $banked++;
        }

        return $banked;
    }

    /**
     * A coach's own referral counts, for their Account (GET /api/coach/referrals): coaches signed
     * up through their link and coaches who have activated. Counts only: never who.
     *
     * @return array{signedUp: int, activated: int}
     */
    public static function summary(User $coach): array
    {
        return [
            'signedUp' => User::query()->where('referred_by', $coach->id)->count(),
            'activated' => ReferralCredit::query()->where('referrer_id', $coach->id)->count(),
        ];
    }

    /**
     * An objection (fitpal:referral-forget): the coach is no longer recorded as referred, and the
     * credit their activation banked stays the referrer's but no longer names them. One
     * transaction, and the only path: with referred_by null the coach is never looked at again,
     * so no second credit can follow.
     */
    public static function forget(User $coach): void
    {
        DB::transaction(function () use ($coach): void {
            User::query()->whereKey($coach->id)->update(['referred_by' => null]);
            ReferralCredit::query()->where('referred_id', $coach->id)->update(['referred_id' => null]);
        });
    }

    public static function monthsUnused(User $coach): int
    {
        return (int) ReferralCredit::query()->where('referrer_id', $coach->id)->whereNull('used_at')->sum('months');
    }

    /**
     * The owner used one of a coach's months (the admin panel): the oldest unused one is marked,
     * with a note of how. Banked only, so this changes no licence; the owner has applied the
     * month however the coach pays.
     */
    public static function markUsed(Request $request, User $admin, string $coachId, string $note): void
    {
        $note = Js::slice(Js::trim($note), 120);
        $credit = DB::transaction(function () use ($coachId, $note): ?ReferralCredit {
            $c = ReferralCredit::query()->where('referrer_id', $coachId)->whereNull('used_at')
                ->orderBy('created')->lockForUpdate()->first();
            $c?->forceFill(['used_at' => Js::nowMs(), 'used_note' => $note])->save();

            return $c;
        });
        if ($credit === null) {
            throw new ClientSafe(409, 'this coach has no unused referral month');
        }
        Audit::record($request, 'admin.referral.use', ['user' => $admin, 'target' => User::query()->find($coachId), 'msg' => $note]);
    }
}
