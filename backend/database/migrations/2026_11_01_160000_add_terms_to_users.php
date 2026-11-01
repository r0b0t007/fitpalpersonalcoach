<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The coach terms a coach accepted (CHW-357): the version (App\Coaching\Terms::VERSION) and
        // when, in ms. Null for clients, and for a coach who has not accepted any yet.
        Schema::table('users', function (Blueprint $table) {
            $table->string('terms_version', 32)->nullable();
            $table->bigInteger('terms_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn(['terms_version', 'terms_at']);
        });
    }
};
