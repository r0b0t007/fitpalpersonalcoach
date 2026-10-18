<?php

namespace Tests\Support;

use App\Models\Assignment;
use App\Models\CoachProgram;
use App\Models\ExerciseMedia;
use App\Models\Invite;
use App\Models\User;

/**
 * The shared coaching fixture (spec §5): two coaches with their own clients and their own rows in
 * every tenant-owned table, plus the people a boundary has to get right — an unassigned member, a
 * disabled one, and an admin. Every coaching feature test starts from it.
 *
 *   A (coach): a1, a2, d1 (disabled)      B (coach): b1      u1: no coach      admin
 */
final class Coaching
{
    public static function twoCoaches(): object
    {
        $u = fn (string $id, string $name, array $more = []) => User::query()->create(['id' => $id, 'name' => $name] + $more);
        $f = (object) [
            'admin' => $u('tAdmin0000000000', 'Owner', ['admin' => true]),
            'a' => $u('tCoachA000000000', 'Coach A', ['coach' => true]),
            'b' => $u('tCoachB000000000', 'Coach B', ['coach' => true]),
        ];
        $f->a1 = $u('tA1000000000000x', 'Client A1', ['coach_id' => $f->a->id]);
        $f->a2 = $u('tA2000000000000x', 'Client A2', ['coach_id' => $f->a->id]);
        $f->d1 = $u('tD1000000000000x', 'Disabled A', ['coach_id' => $f->a->id, 'disabled' => true]);
        $f->b1 = $u('tB1000000000000x', 'Client B1', ['coach_id' => $f->b->id]);
        $f->u1 = $u('tU1000000000000x', 'Unassigned');

        // One row per coach in every tenant-owned table, written with no context (as the import does).
        foreach (['a' => $f->a, 'b' => $f->b, 'admin' => $f->admin] as $k => $coach) {
            Invite::query()->create(['code' => strtoupper("INV{$k}0000000000"), 'coach_id' => $coach->id, 'created_by' => $coach->id, 'created' => '2026-05-01T00:00:00.000Z']);
            CoachProgram::query()->create(['coach_id' => $coach->id, 'program_id' => "prog-$k", 'name' => "Program $k", 'bundle' => '{"week":{}}', 'created' => '2026-05-01T00:00:00.000Z', 'updated' => '2026-05-01T00:00:00.000Z']);
            ExerciseMedia::query()->create(['id' => "media$k", 'ex_id' => '0001', 'coach_id' => $coach->id, 'file' => "0001-$k.mp4", 'bytes' => 10, 'mime' => 'video/mp4', 'status' => 'ready', 'created' => '2026-05-01T00:00:00.000Z']);
        }
        Assignment::query()->create(['id' => 'assignA', 'coach_id' => $f->a->id, 'coach_name' => 'Coach A', 'member_id' => $f->a1->id, 'bundle' => '{}', 'status' => 'pending', 'created' => '2026-05-01T00:00:00.000Z']);
        Assignment::query()->create(['id' => 'assignB', 'coach_id' => $f->b->id, 'coach_name' => 'Coach B', 'member_id' => $f->b1->id, 'bundle' => '{}', 'status' => 'pending', 'created' => '2026-05-01T00:00:00.000Z']);

        return $f;
    }
}
