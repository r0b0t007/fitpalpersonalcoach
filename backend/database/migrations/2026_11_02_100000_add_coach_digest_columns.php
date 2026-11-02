<?php

use App\Coaching\MemberCard;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The newest check-in date any sync has carried, only ever raised (DataController): a sync
        // above it carries a check-in just filed, which the client's coach is told about (CHW-339).
        Schema::table('user_states', function (Blueprint $table) {
            $table->string('checkin_seen', 10)->nullable();
        });
        // The coach's local date of their last morning digest (fitpal:coach-digest): one a day.
        Schema::table('users', function (Blueprint $table) {
            $table->string('last_digest', 10)->nullable();
        });
        // The states already stored, one at a time (a state can be 16 MB): without this, each
        // client's first sync after the deploy would read as a check-in just filed.
        foreach (DB::table('user_states')->orderBy('user_id')->pluck('user_id') as $id) {
            $state = DB::table('user_states')->where('user_id', $id)->value('state');
            $decoded = json_decode((string) $state, false, 100_000);
            DB::table('user_states')->where('user_id', $id)->update(['checkin_seen' => $decoded instanceof stdClass ? MemberCard::lastCheckin($decoded) : null]);
        }
    }

    public function down(): void
    {
        Schema::table('user_states', function (Blueprint $table) {
            $table->dropColumn('checkin_seen');
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('last_digest');
        });
    }
};
