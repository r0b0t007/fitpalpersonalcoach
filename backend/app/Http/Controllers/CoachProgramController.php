<?php

namespace App\Http\Controllers;

use App\Audit\Audit;
use App\Coaching\PlanBundle;
use App\Models\CoachProgram;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Input;
use App\Support\Js;
use App\Support\Json;
use App\Support\Say;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * A coach's program library (api/server.js GET /api/coach/programs, POST …/save, POST …/delete;
 * domain.mjs upsertProgram). Runs in the coach's CoachContext, so every CoachProgram query is
 * their own library: another coach's program id is simply "no such program".
 */
final class CoachProgramController
{
    public const MAX = 50;

    public function index(): JsonResponse
    {
        return Json::ok(['programs' => CoachProgram::library(), 'max' => self::MAX]);
    }

    public function save(Request $request): JsonResponse
    {
        $coach = $request->user('api');
        // Only an ABSENT id is generated. A present-but-malformed one is refused below rather than
        // replaced: a fresh id would quietly append a new row on every retry.
        $id = Input::raw($request, 'id');
        if ($id === null || $id === '') {
            $id = (string) Str::uuid();
        }

        $program = DB::transaction(function () use ($request, $coach, $id): CoachProgram {
            // Serialised on the coach's row: the cap is counted and the row written as one step.
            User::query()->whereKey($coach->id)->lockForUpdate()->first();
            [$name, $bundle] = PlanBundle::program(Input::raw($request, 'name'), Input::raw($request, 'bundle'));
            // A string that could have come from crypto.randomUUID(). Anything else would be
            // stored, never match on the way back, and append a row on every re-save.
            if (! is_string($id) || ! preg_match('/^[A-Za-z0-9_-]{1,64}$/', $id)) {
                throw new ClientSafe(400, 'program id required');
            }
            $row = CoachProgram::query()->where('program_id', $id)->first();
            // Refused past the cap only when the write would ADD a row: renaming or re-saving an
            // existing program never hits the wall. 429, a state the coach can fix.
            if (! $row && CoachProgram::query()->count() >= self::MAX) {
                throw new ClientSafe(429, Say::f('you have {0} programs — delete one before saving another', self::MAX));
            }
            $now = (int) floor(microtime(true) * 1000);
            $row ??= (new CoachProgram)->forceFill(['program_id' => $id, 'created' => $now]);
            $row->forceFill(['name' => $name, 'bundle' => Js::stringify($bundle), 'updated' => $now])->save();

            return $row;
        });
        Audit::record($request, 'coach.program.save', ['user' => $coach, 'msg' => $program->name]);

        return Json::ok(['program' => $program->toNode(), 'programs' => CoachProgram::library()]);
    }

    public function delete(Request $request): JsonResponse
    {
        // `p.id === body.id`: the id as sent, and only a string can match.
        $id = Input::raw($request, 'id');
        $gone = is_string($id) ? CoachProgram::query()->where('program_id', $id)->first() : null;
        if (! $gone) {
            return Json::error(404, 'no such program');
        }
        $gone->delete();
        Audit::record($request, 'coach.program.delete', ['user' => $request->user('api'), 'msg' => $gone->name]);

        return Json::ok(['programs' => CoachProgram::library()]);
    }
}
