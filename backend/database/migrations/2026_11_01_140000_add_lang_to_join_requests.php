<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The follower's language (CHW-337): the coach's answer is mailed to someone with no account
        // yet, so no saved language to read — the one the form was filled in is kept with it.
        Schema::table('join_requests', function (Blueprint $table) {
            $table->string('lang', 5)->nullable()->after('name');
        });
    }

    public function down(): void
    {
        Schema::table('join_requests', function (Blueprint $table) {
            $table->dropColumn('lang');
        });
    }
};
