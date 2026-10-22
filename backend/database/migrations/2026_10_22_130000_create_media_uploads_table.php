<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A chunked demo upload in flight (CHW-259): the file is assembled at media/ex/.up-<id>
        // chunk by chunk, each request small enough to cross Cloudflare's 100 MB / ~100 s limits.
        // Laravel's alone — the Node API takes one request per file. fitpal:prune removes sessions
        // left idle (an upload abandoned half way) with their partial files.
        Schema::create('media_uploads', function (Blueprint $table) {
            $table->string('id', 16)->primary();
            $table->string('coach_id', 16);
            $table->string('ex_id', 40);
            $table->string('label', 40)->default('');
            $table->unsignedBigInteger('size');
            $table->unsignedBigInteger('received')->default(0);
            $table->string('created', 30);
            $table->unsignedBigInteger('touched');   // epoch ms of the last chunk
            // Set once the finish stored it: a finish sent again answers this demo.
            $table->string('media_id', 16)->nullable();
            $table->foreign('coach_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index(['coach_id', 'touched']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('media_uploads');
    }
};
