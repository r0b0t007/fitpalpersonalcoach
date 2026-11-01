<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\Handle;
use App\Models\CoachPage;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Support\Phone;
use App\Tenancy\CoachLock;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The coach's own public page (CHW-330): read it, and save it. Runs in the coach's CoachContext,
 * so CoachPage::query() is their page; only the handle's uniqueness looks across coaches.
 */
final class CoachPageController
{
    public const BIO_MAX = 160;

    public function show(): JsonResponse
    {
        return Json::ok(self::answer(CoachPage::query()->first()));
    }

    public function save(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        $handle = Handle::normalise(Input::raw($request, 'handle'));
        if (! Handle::valid($handle)) {
            throw new ClientSafe(400, 'handles are 3–30 letters, numbers, dots or underscores');
        }
        if (Handle::reserved($handle)) {
            throw new ClientSafe(409, 'that handle is taken');
        }
        $bio = Input::raw($request, 'bio');
        $bio = is_string($bio) ? trim($bio) : '';
        if (mb_strlen($bio) > self::BIO_MAX) {
            throw new ClientSafe(400, 'keep the bio to 160 characters');
        }
        $whatsapp = Phone::digits(Input::raw($request, 'whatsapp'));
        if ($whatsapp === null) {
            throw new ClientSafe(400, 'that is not a phone number — include the country code');
        }
        // Only a real `true` opens it, and only `light` is light: a page is never published by a typo.
        $open = Input::raw($request, 'open') === true;
        $theme = Input::raw($request, 'theme') === 'light' ? 'light' : 'dark';

        try {
            $page = DB::transaction(function () use ($coach, $handle, $bio, $whatsapp, $open, $theme): CoachPage {
                $me = CoachLock::take($coach->id);
                // Judged again on the locked row: a detach (role revoked, account disabled) closes the
                // page under this lock, and a save that waited behind it must not open it again.
                // Refused as RequireCoach would refuse the next request.
                if (! $me || $me->disabled) {
                    throw new ClientSafe(401, 'not signed in');
                }
                if (! $me->isCoach()) {
                    throw new ClientSafe(403, 'forbidden');
                }
                $holder = CoachPage::acrossCoaches()->where('handle', $handle)->first(); // across coaches: a handle is unique across every coach
                if ($holder !== null && $holder->coach_id !== $coach->id) {
                    throw new ClientSafe(409, 'that handle is taken');
                }
                $now = Js::nowMs();
                // The holder of the handle, when it is this coach, is already their page.
                $page = $holder ?? CoachPage::query()->first() ?? (new CoachPage)->forceFill(['created' => $now]);
                $page->forceFill(['handle' => $handle, 'bio' => $bio, 'whatsapp' => $whatsapp, 'open' => $open, 'theme' => $theme, 'updated' => $now])->save();

                return $page;
            });
        } catch (UniqueConstraintViolationException) {
            // Two coaches claiming one handle at the same moment: the index decides, and the loser hears it.
            throw new ClientSafe(409, 'that handle is taken');
        }
        Audit::record($request, 'coach.page.save', ['user' => $coach, 'msg' => $page->handle]);

        return Json::ok(self::answer($page));
    }

    /** @return array{page: array<string, mixed>|null, url: string|null} */
    private static function answer(?CoachPage $page): array
    {
        return ['page' => $page?->toCoach(), 'url' => $page ? CoachPage::url($page->handle) : null];
    }
}
