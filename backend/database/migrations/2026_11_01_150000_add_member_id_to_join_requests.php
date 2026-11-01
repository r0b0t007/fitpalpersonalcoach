<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
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
    }

    public function down(): void
    {
        Schema::table('join_requests', function (Blueprint $table) {
            $table->dropIndex(['member_id']);
            $table->dropColumn('member_id');
        });
    }
};
