<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // The account row the Node API kept in db.json's `users`, column for column, plus email
        // and password for the SaaS (coaches' email, the owner's Filament login).
        Schema::create('users', function (Blueprint $table) {
            $table->string('id', 16)->primary();
            $table->string('name', 40);
            $table->string('email')->nullable()->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password')->nullable();
            $table->boolean('admin')->default(false);
            $table->boolean('coach')->default(false);
            $table->boolean('self_serve')->default(false);
            // A client's coach. Deleting the coach leaves the client unassigned, never pointing at
            // an account that is gone (the coaching tables restrict deleting a coach who has rows).
            $table->string('coach_id', 16)->nullable()->index();
            $table->foreign('coach_id')->references('id')->on('users')->nullOnDelete();
            $table->boolean('disabled')->default(false);
            $table->unsignedInteger('sv')->default(0);
            $table->string('invited_by', 40)->nullable();
            $table->string('last_reminder', 10)->nullable();
            $table->string('last_checkin_reminder', 10)->nullable();
            $table->string('licence_id', 32)->nullable();
            $table->rememberToken();
            // Milliseconds, and nullable: Node's `created` is an ISO string with milliseconds, and
            // its oldest accounts have none. The roster sends it back verbatim, and adherence clamps
            // its window to it — a made-up date would excuse every session missed before it.
            $table->timestamp('created_at', 3)->nullable()->useCurrent();
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });

        // Laravel's own sessions table, used only by the Filament panel's web guard.
        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->string('user_id', 16)->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('sessions');
    }
};
