<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A follower asking to join a coach (CHW-336): their intake, the emailed code that proves the
        // address (only its hash), and once proven, the hash of the token their browser keeps. No
        // account exists until the coach accepts (spec §3.0). Unverified rows are pruned after a day,
        // declined and expired ones after 30 (fitpal:prune) — the intake holds health data.
        Schema::create('join_requests', function (Blueprint $table) {
            $table->string('id', 24)->primary();
            $table->string('coach_id', 16);
            $table->string('email', 254);
            $table->string('name', 40);
            $table->text('intake');                       // JSON: App\Coaching\Intake
            $table->string('status', 10);                 // unverified | pending | accepted | declined | expired
            $table->char('code_hash', 64)->nullable();
            $table->unsignedTinyInteger('attempts')->default(0);
            $table->bigInteger('code_expires')->nullable();
            $table->char('token_hash', 64)->nullable()->unique();
            // Epoch milliseconds, as the other coach tables keep them.
            $table->bigInteger('created');
            $table->bigInteger('decided')->nullable();
            $table->index(['coach_id', 'status']);
            $table->foreign('coach_id')->references('id')->on('users')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('join_requests');
    }
};
