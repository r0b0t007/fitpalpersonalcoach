<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // state-<uid>.json, one row each. LONGTEXT: a sync may carry up to 16 MB.
        Schema::create('user_states', function (Blueprint $table) {
            $table->string('user_id', 16)->primary();
            $table->longText('state');
            $table->unsignedBigInteger('ts')->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_states');
    }
};
