<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // When a coached client agreed to their coach seeing the health data they log (CHW-360,
        // App\Coaching\HealthConsent), in ms; null until then, and again once withdrawn or once the
        // link to that coach ends.
        Schema::table('users', function (Blueprint $table) {
            $table->bigInteger('health_consent_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropColumn('health_consent_at');
        });
    }
};
