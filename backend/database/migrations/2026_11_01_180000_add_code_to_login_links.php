<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A sign-in mail carries a 6-digit code beside its link (CHW-331): an HMAC of it keyed with
        // the app key and the row's id, so a copy of this table alone cannot be searched for the
        // code, and the wrong tries made against it.
        Schema::table('login_links', function (Blueprint $table) {
            $table->char('code_hash', 64)->nullable()->after('token_hash');
            $table->unsignedTinyInteger('attempts')->default(0)->after('code_hash');
        });
    }

    public function down(): void
    {
        Schema::table('login_links', function (Blueprint $table) {
            $table->dropColumn(['code_hash', 'attempts']);
        });
    }
};
