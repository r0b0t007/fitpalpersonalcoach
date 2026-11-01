<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A coach's reply to a client's check-in, or comment on a workout (CHW-340). Its own table,
        // not the client's state, where the last write wins and the next sync from their phone would
        // take the note away. Deleted when the link between the two ends (Unlink, Detach).
        Schema::create('coach_notes', function (Blueprint $table) {
            $table->string('id', 24)->primary();
            $table->string('coach_id', 16);
            $table->string('member_id', 16);
            $table->string('ref_type', 8);                // checkin | workout
            $table->string('ref_key', 64);                // the check-in's date, or the workout's id
            $table->text('body');
            // Epoch milliseconds, as the other coach tables keep them.
            $table->bigInteger('created');
            $table->bigInteger('read_at')->nullable();
            $table->index(['member_id', 'created']);
            $table->index(['coach_id', 'member_id']);
            $table->foreign('coach_id')->references('id')->on('users')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('coach_notes');
    }
};
