<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A client's progress photo (Node kept these in media-<uid>.json). The slot is (d, pose):
        // `d` is the check-in period the client filed it under, and a retake replaces the slot.
        // Owned by the CLIENT, not a coach: who may read the bytes is Access::canSeePhotos.
        Schema::create('progress_photos', function (Blueprint $table) {
            // The order Node's sidecar kept within a date, which a timestamp cannot settle.
            $table->id('seq');
            $table->string('id', 16)->unique();
            $table->string('user_id', 16);
            $table->string('d', 10);
            $table->string('pose', 8);
            $table->string('file', 64);   // random base64url + extension, never content-addressed
            $table->unsignedBigInteger('bytes');
            $table->string('mime', 64);
            $table->string('created', 30);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->unique(['user_id', 'd', 'pose']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('progress_photos');
    }
};
