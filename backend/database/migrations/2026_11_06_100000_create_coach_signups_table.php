<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A coach signing up with an emailed code (CHW-368): what they typed on the Start page, kept
        // until the code proves the address and the account is written. One per address, and only
        // the hash of the code. Pruned a day after it was started (fitpal:prune).
        Schema::create('coach_signups', function (Blueprint $table) {
            $table->string('email', 254)->primary();
            $table->string('name', 40);
            $table->string('lang', 5)->nullable();
            $table->string('terms', 10)->nullable();       // the coach terms the page showed, if current
            $table->char('code_hash', 64);
            $table->unsignedTinyInteger('attempts')->default(0);
            // Epoch milliseconds, as the join requests keep them.
            $table->bigInteger('code_expires');
            $table->bigInteger('created');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('coach_signups');
    }
};
