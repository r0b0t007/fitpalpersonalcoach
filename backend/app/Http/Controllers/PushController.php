<?php

namespace App\Http\Controllers;

use App\Coaching\MemberCard;
use App\Models\PushSubscription;
use App\Models\User;
use App\Push\Endpoint;
use App\Push\Messages;
use App\Push\Sender;
use App\Push\Vapid;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * Web Push subscriptions (api/server.js /api/push/*): the key the app subscribes with, a browser
 * subscribed or unsubscribed, and a test push. Any signed-in account, coach or client.
 */
final class PushController
{
    /** Public: the app asks before anyone signs in, as it did of Node. */
    public function publicKey(): JsonResponse
    {
        return Json::ok(['key' => Vapid::keys()['publicKey']]);
    }

    public function subscribe(Request $request): JsonResponse
    {
        $user = $request->user('api');
        // `!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth`: only an object has fields.
        $sub = Input::raw($request, 'subscription');
        $keys = $sub instanceof stdClass ? ($sub->keys ?? null) : null;
        if (! $sub instanceof stdClass || ! Js::truthy($sub->endpoint ?? null) || ! $keys instanceof stdClass
            || ! Js::truthy($keys->p256dh ?? null) || ! Js::truthy($keys->auth ?? null)) {
            return Json::error(400, 'invalid subscription');
        }
        Endpoint::check($sub->endpoint);
        $endpoint = Js::string($sub->endpoint);
        // Only the two keys the push protocol needs are kept, as text: the rest of `sub` is the
        // caller's, and nothing reads it.
        $store = fn () => DB::transaction(function () use ($user, $endpoint, $keys): void {
            // The account's row, locked: two subscribes at once cannot both slip under the cap.
            User::query()->whereKey($user->id)->lockForUpdate()->first();
            $hash = PushSubscription::hashOf($endpoint);
            // The same browser subscribed again — by this account or another one on the same
            // device — moves to this account, as one row.
            PushSubscription::query()->where('endpoint_hash', $hash)->delete();
            $mine = PushSubscription::of($user->id)->pluck('id');
            if ($mine->count() >= PushSubscription::MAX_PER_USER) {
                PushSubscription::query()->whereKey($mine->take($mine->count() - PushSubscription::MAX_PER_USER + 1)->all())->delete();
            }
            (new PushSubscription)->forceFill([
                'user_id' => $user->id, 'endpoint' => $endpoint, 'endpoint_hash' => $hash,
                'p256dh' => Js::string($keys->p256dh), 'auth' => Js::string($keys->auth), 'created' => Js::isoNow(),
            ])->save();
        });
        try {
            $store();
        } catch (UniqueConstraintViolationException) {
            // The same browser subscribed by two accounts at the same moment: each locked only its
            // own account, so both inserted. Once more, now that the other row is there to move.
            $store();
        }

        return Json::ok(['ok' => true]);
    }

    /** `s.endpoint === body.endpoint`: only an exact string names a subscription. */
    public function unsubscribe(Request $request): JsonResponse
    {
        $endpoint = Input::raw($request, 'endpoint');
        if (is_string($endpoint)) {
            PushSubscription::query()->where('user_id', $request->user('api')->id)
                ->where('endpoint_hash', PushSubscription::hashOf($endpoint))->delete();
        }

        return Json::ok(['ok' => true]);
    }

    /** Sent now, not queued: the person pressed "test" and is looking at their phone. */
    public function test(Request $request, Sender $sender): JsonResponse
    {
        $user = $request->user('api');
        if (PushSubscription::query()->where('user_id', $user->id)->exists()) {
            $sender->send($user->id, Messages::test(MemberCard::lang($user->id), (string) config('fitpal.rp_name')));
        }

        return Json::ok(['ok' => true]);
    }
}
