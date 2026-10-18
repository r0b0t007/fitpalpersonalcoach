<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The four tenant-owned tables (spec §5): each row belongs to one coach through `coach_id`, and
// the OwnedByCoach scope keeps every query inside the acting coach's rows. Their routes arrive
// with the R2/R3 tickets; the tables come first so the boundary exists before anything reads them.
//
// Timestamps keep the Node API's own types — ISO strings ("2026-05-01T10:20:30.000Z") where Node
// wrote ISO strings, epoch milliseconds where it wrote Date.now() — because the app reads them
// back verbatim and an import must not reformat them. ISO-8601 sorts as text.
//
// Every coach_id here RESTRICTS deletion of the user. The Node API never deleted an account: losing
// the coach role or being disabled ran detachCoach, which revoked the coach's open codes (with a
// reason) and expired their offers but kept the record. A database cascade would do neither — it
// would leave open codes working as general codes, or erase the history — so deleting a coach who
// has rows must go through that explicit path, and the database refuses anything else.
return new class extends Migration
{
    public function up(): void
    {
        // A sign-up code. A coach's carries coach_id, which puts the client who redeems it on that
        // coach's roster; an admin's general code has none (and binds nobody).
        // Node's invites could also carry a requestId (an approved access request). Access requests
        // were a gym feature the port drops (spec §2), so the link has nothing left to point at.
        Schema::create('invites', function (Blueprint $table) {
            $table->string('code', 32)->primary();
            $table->string('note', 60)->default('');
            $table->string('created_by', 16)->nullable();
            $table->string('coach_id', 16)->nullable();
            $table->string('created', 30);
            $table->string('used_by', 16)->nullable();
            $table->string('used_at', 30)->nullable();
            $table->boolean('revoked')->default(false);
            $table->string('revoked_at', 30)->nullable();
            $table->string('revoked_reason', 60)->nullable();
            $table->foreign('coach_id')->references('id')->on('users')->restrictOnDelete();
            $table->index(['coach_id', 'created']);
        });

        // A coach's program library. `program_id` is the id the app made (crypto.randomUUID), kept
        // as given; it is unique per coach, not across coaches.
        Schema::create('coach_programs', function (Blueprint $table) {
            $table->id();
            $table->string('coach_id', 16);
            $table->string('program_id', 64);
            $table->string('name', 60);
            $table->longText('bundle');   // raw JSON, never round-tripped: {} must stay {}
            // Epoch milliseconds, not ISO strings: Node's upsertProgram stamps Date.now() here.
            $table->unsignedBigInteger('created');
            $table->unsignedBigInteger('updated');
            $table->foreign('coach_id')->references('id')->on('users')->restrictOnDelete();
            $table->unique(['coach_id', 'program_id']);
        });

        // A program sent to a client, pending until they accept or decline (or the coach withdraws).
        Schema::create('assignments', function (Blueprint $table) {
            $table->string('id', 16)->primary();
            $table->string('coach_id', 16);
            $table->string('coach_name', 40);
            $table->string('member_id', 16);
            $table->longText('bundle');   // raw JSON
            $table->string('note', 280)->default('');
            $table->boolean('schedule')->default(false);
            $table->string('status', 16);
            $table->string('created', 30);
            $table->string('decided_at', 30)->nullable();
            $table->foreign('coach_id')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('member_id')->references('id')->on('users')->restrictOnDelete();
            $table->index(['coach_id', 'created']);
            $table->index(['member_id', 'status']);
        });

        // A coach's demo video or image for an exercise. The file lives on the media disk.
        Schema::create('exercise_media', function (Blueprint $table) {
            $table->string('id', 16)->primary();
            $table->string('ex_id', 40);   // Node: /^[A-Za-z0-9_-]{1,40}$/
            $table->string('coach_id', 16);
            $table->string('file', 160);
            $table->string('label', 40)->default('');
            $table->unsignedBigInteger('bytes');
            $table->string('mime', 64);
            $table->string('status', 16);
            $table->string('created', 30);
            $table->foreign('coach_id')->references('id')->on('users')->restrictOnDelete();
            $table->index(['coach_id', 'ex_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('exercise_media');
        Schema::dropIfExists('assignments');
        Schema::dropIfExists('coach_programs');
        Schema::dropIfExists('invites');
    }
};
