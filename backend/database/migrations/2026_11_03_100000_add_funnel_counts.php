<?php

use App\Models\UserState;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A coach's page views, one row a day (CHW-335): a count, with no visitor in it. Never in
        // audit_events, where an unauthenticated flood would prune real security events out.
        Schema::create('coach_page_views', function (Blueprint $table) {
            $table->string('coach_id', 16);
            $table->string('day', 10);   // YYYY-MM-DD, UTC
            $table->unsignedInteger('n')->default(0);
            $table->primary(['coach_id', 'day']);
            $table->foreign('coach_id')->references('id')->on('users')->cascadeOnDelete();
        });
        // When the server first saw a workout in this state, set once (UserState); and the date of
        // the last one, derived on every save as S.reminder is. The funnel's activation and habit.
        Schema::table('user_states', function (Blueprint $table) {
            $table->bigInteger('first_workout_at')->nullable();
            $table->string('last_workout', 10)->nullable();
        });
        // The states already stored, one at a time (a state can be 16 MB). There is no saying when
        // their first workout reached the server: its sync time stands in for it.
        foreach (DB::table('user_states')->orderBy('user_id')->pluck('user_id') as $id) {
            $row = DB::table('user_states')->where('user_id', $id)->first(['state', 'ts']);
            $last = UserState::derived(json_decode((string) $row->state, false, 100_000))['last_workout'];
            DB::table('user_states')->where('user_id', $id)->update([
                'last_workout' => $last,
                'first_workout_at' => $last === null ? null : ($row->ts ?? (int) floor(microtime(true) * 1000)),
            ]);
        }
    }

    public function down(): void
    {
        Schema::table('user_states', function (Blueprint $table) {
            $table->dropColumn(['first_workout_at', 'last_workout']);
        });
        Schema::dropIfExists('coach_page_views');
    }
};
