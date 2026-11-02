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
        // S.tz and S.digest out of the state, as S.reminder is: what fitpal:coach-digest reads for
        // every coach each hour (UserState::derived keeps them in step on every save), which would
        // otherwise mean reaching into states of up to 16 MB twice an hour per coach.
        Schema::table('user_states', function (Blueprint $table) {
            $table->string('tz', 64)->nullable();
            $table->boolean('digest_off')->default(false);
        });
        // The states already stored, one at a time: a state can be 16 MB.
        foreach (DB::table('user_states')->orderBy('user_id')->pluck('user_id') as $id) {
            $state = DB::table('user_states')->where('user_id', $id)->value('state');
            $derived = UserState::derived(json_decode((string) $state, false, 100_000));
            DB::table('user_states')->where('user_id', $id)->update(['tz' => $derived['tz'], 'digest_off' => $derived['digest_off']]);
        }
    }

    public function down(): void
    {
        Schema::table('user_states', function (Blueprint $table) {
            $table->dropColumn(['tz', 'digest_off']);
        });
    }
};
