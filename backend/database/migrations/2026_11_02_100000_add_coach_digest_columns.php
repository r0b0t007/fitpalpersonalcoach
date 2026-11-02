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
        // The newest check-in date in the state (UserState::derived): a save that raises it is a
        // check-in just filed, which the client's coach is told about (CHW-339, CheckinAlert).
        Schema::table('user_states', function (Blueprint $table) {
            $table->string('last_checkin', 10)->nullable();
        });
        // The coach's local date of their last morning digest (fitpal:coach-digest): one a day.
        Schema::table('users', function (Blueprint $table) {
            $table->string('last_digest', 10)->nullable();
        });
        // The states already stored, one at a time (a state can be 16 MB): without this, each
        // client's first sync after the deploy would read as a check-in just filed.
        foreach (DB::table('user_states')->orderBy('user_id')->pluck('user_id') as $id) {
            $state = DB::table('user_states')->where('user_id', $id)->value('state');
            $derived = UserState::derived(json_decode((string) $state, false, 100_000));
            DB::table('user_states')->where('user_id', $id)->update(['last_checkin' => $derived['last_checkin']]);
        }
    }

    public function down(): void
    {
        Schema::table('user_states', function (Blueprint $table) {
            $table->dropColumn('last_checkin');
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('last_digest');
        });
    }
};
