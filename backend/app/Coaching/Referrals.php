<?php

namespace App\Coaching;

use App\Audit\Audit;
use App\Models\CoachPage;
use App\Models\JoinRequest;
use App\Models\ReferralCredit;
use App\Models\User;
use App\Support\Js;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;

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
        if ($coach === null || ($coach->email !== null && mb_strtolower($coach->email) === mb_strtolower($email))) {
            return null;
        }

        return $coach;
    }

    /** Referred coaches looked at per run: one run stays well inside the host's 50 s. */
    public const BATCH = 500;

    /**
     * Whether $coach has activated, for the referral: a client who came through their page (a
     * join request they accepted) is still on their roster and has trained since, and asked with
     * an address that is neither coach's. A new account's first workout counts from the
     * acceptance; an account that trained before it joined counts from the next UTC day.
     */
    public static function activated(User $coach, User $referrer): bool
    {
        $coachEmails = array_filter([mb_strtolower((string) $coach->email), mb_strtolower((string) $referrer->email)]);
        $rows = JoinRequest::acceptedClientActivity($coach);
        foreach ($rows as $r) {
            if (in_array(mb_strtolower(trim((string) $r->email)), $coachEmails, true)) {
                continue;
            }
            $decided = (int) $r->decided;
            if ($r->first_workout_at !== null && (int) $r->first_workout_at >= $decided) {
                return true;
            }
            if ($r->last_workout !== null && $r->last_workout > gmdate('Y-m-d', intdiv($decided, 1000))) {
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
        $cursor = (string) Cache::get('referrals:cursor', '');
        $referred = User::query()
            ->whereNotNull('referred_by')->where('coach', true)->where('disabled', false)
            ->whereNotExists(fn ($q) => $q->from('referral_credits')->whereColumn('referral_credits.referred_id', 'users.id'))
            ->where('id', '>', $cursor)
            ->orderBy('id')->limit($batch)->get();
        Cache::forever('referrals:cursor', $referred->count() < $batch ? '' : $referred->last()->id);
        $banked = 0;
        foreach ($referred as $coach) {
            $referrer = User::query()->find($coach->referred_by);
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
}
