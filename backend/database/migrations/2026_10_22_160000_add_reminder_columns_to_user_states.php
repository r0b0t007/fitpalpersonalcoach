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
        // S.reminder and S.checkinDay, out of the state: what fitpal:remind reads every minute
        // (UserState::derived keeps them in step on every save).
        Schema::table('user_states', function (Blueprint $table) {
            $table->text('reminder')->nullable();
            $table->unsignedTinyInteger('checkin_day')->nullable();
        });
        // The states already stored, one at a time: a state can be 16 MB.
        foreach (DB::table('user_states')->orderBy('user_id')->pluck('user_id') as $id) {
            $state = DB::table('user_states')->where('user_id', $id)->value('state');
            DB::table('user_states')->where('user_id', $id)->update(UserState::derived(json_decode((string) $state, false, 100_000)));
        }
    }

    public function down(): void
    {
        Schema::table('user_states', function (Blueprint $table) {
            $table->dropColumn(['reminder', 'checkin_day']);
        });
    }
};
