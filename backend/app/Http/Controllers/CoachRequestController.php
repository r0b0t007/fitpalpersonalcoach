<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\AssignmentSent;
use App\Coaching\JoinAccept;
use App\Models\JoinRequest;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Json;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A coach's requests inbox (CHW-337, spec §3, §3.0): the followers who asked to train with them
 * from their page (CHW-336), and the answer. Runs in the coach's CoachContext, so JoinRequest is
 * their own queue: another coach's request is simply "no such request". What an accept does, and
 * under which locks, is App\Coaching\JoinAccept's, shared with auto-accept (CHW-338).
 */
final class CoachRequestController
{
    /** Decided requests shown under the waiting ones. */
    private const RECENT = 50;

    public function index(): JsonResponse
    {
        return Json::ok(['requests' => self::list()]);
    }

    /** GET /api/coach/requests/count → {pending}: Today's card, without sending anyone's intake. */
    public function count(): JsonResponse
    {
        return Json::ok(['pending' => JoinRequest::query()->where('status', 'pending')->count()]);
    }

    public function decide(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        $id = Input::jsString($request, 'id');
        // A yes or a no, and nothing else: a decline cannot be taken back, so a missing or garbled
        // answer must not read as one.
        $accept = Input::raw($request, 'accept');
        if (! is_bool($accept)) {
            throw new ClientSafe(400, 'accept must be true or false');
        }
        [$refusal, $member, $join, $starter] = JoinAccept::decide($coach, $id, $accept);
        if ($refusal !== null) {
            throw $refusal;
        }
        Audit::record($request, $accept ? 'coach.request.accept' : 'coach.request.decline', ['user' => $coach, 'msg' => $accept ? $member->id : $join->id]);
        JoinAccept::tellFollower($join, $coach, $accept);
        if ($starter) {
            AssignmentSent::dispatch($coach, [$member->id]);
        }

        return Json::ok(['requests' => self::list(), 'member' => $member ? ['id' => $member->id, 'name' => $member->name] : null]);
    }

    /**
     * POST /api/coach/requests/forget {id} → {requests}: the coach deletes a request and what it
     * said — a client who withdraws their consent while still training (CHW-334, the legal page's
     * promise). Not behind RequireWriter: a lapsed plan must not keep anyone's health data.
     */
    public function forget(Request $request): JsonResponse
    {
        $id = Input::jsString($request, 'id');
        if ($id === '' || JoinRequest::query()->whereKey($id)->delete() !== 1) {
            throw new ClientSafe(404, 'no such request');
        }
        Audit::record($request, 'coach.request.forget', ['user' => $request->user('api'), 'msg' => $id]);

        return Json::ok(['requests' => self::list()]);
    }

    /** @return list<array<string, mixed>> the waiting requests, then the latest decided ones */
    private static function list(): array
    {
        return JoinRequest::query()->where('status', '!=', 'unverified')
            ->orderByRaw("CASE WHEN status = 'pending' THEN 0 ELSE 1 END")->orderByDesc('created')
            ->limit(JoinRequest::MAX_PENDING + self::RECENT)->get()
            ->map(fn (JoinRequest $r) => [
                'id' => $r->id, 'name' => $r->name, 'email' => $r->email, 'status' => $r->status,
                // A declined or lapsed request's answers were blanked when it was answered (CHW-334).
                'intake' => json_decode($r->intake, false) ?: new \stdClass,
                'created' => $r->created, 'decided' => $r->decided,
            ])->all();
    }
}
