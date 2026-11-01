<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The account an accept put on the roster (CHW-334): ending the link forgets the intake, and
        // the request must be found by the account, since the address can change after the accept.
        // No foreign key: accounts are never deleted, and the row goes before the link does.
        Schema::table('join_requests', function (Blueprint $table) {
            $table->string('member_id', 16)->nullable()->after('email');
            $table->index('member_id');
        });
        // Requests accepted before this column existed: the account is the one on that coach's roster
        // with the address. One no longer there has nobody to name, and goes by address as before.
        foreach (DB::table('join_requests')->where('status', 'accepted')->whereNull('member_id')->get(['id', 'coach_id', 'email']) as $r) {
            $member = DB::table('users')->where('coach_id', $r->coach_id)->where('email', $r->email)->value('id');
            if ($member !== null) {
                DB::table('join_requests')->where('id', $r->id)->update(['member_id' => $member]);
            }
        }
        // And the answers of requests already declined or lapsed, which are now blanked when answered.
        DB::table('join_requests')->whereIn('status', ['declined', 'expired'])->update(['intake' => '{}']);
    }

    public function down(): void
    {
        Schema::table('join_requests', function (Blueprint $table) {
            $table->dropIndex(['member_id']);
            $table->dropColumn('member_id');
        });
    }
};
