<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Who is training right now (Node's in-memory `presence` map): one row per account, written
        // by the app's 20 s heartbeat, read as `live` by the roster and the admin list, and stale
        // after 70 s. A table rather than memory because PHP keeps none between requests;
        // reads ignore stale rows, and fitpal:prune (CHW-263) deletes them.
        Schema::create('presence', function (Blueprint $table) {
            $table->string('user_id', 16)->primary();
            $table->text('payload')->nullable();       // the `live` object; null: "just left"
            $table->unsignedBigInteger('updated_at');  // epoch ms of the last heartbeat
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index('updated_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('presence');
    }
};
