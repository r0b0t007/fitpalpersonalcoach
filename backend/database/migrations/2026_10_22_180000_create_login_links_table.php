<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Sign-in links and email-change links (spec §4a). Only the SHA-256 of the token is kept;
        // rows older than 24 hours are pruned (the route is unauthenticated, and `ip` is personal
        // data that must not accumulate).
        Schema::create('login_links', function (Blueprint $table) {
            $table->string('id', 32)->primary();
            $table->string('user_id', 16)->index();
            $table->string('purpose', 8);              // login | email
            $table->string('email')->nullable();       // the new address, for an email-change link
            $table->char('token_hash', 64)->unique();
            // An explicit default: MariaDB with explicit_defaults_for_timestamp off makes a table's
            // first bare NOT NULL TIMESTAMP `ON UPDATE CURRENT_TIMESTAMP`, and spending a link
            // would then move its age — and the 24-hour retention — on.
            $table->timestamp('created_at', 3)->useCurrent()->index();
            $table->timestamp('expires_at', 3);
            $table->timestamp('used_at', 3)->nullable();
            $table->string('ip', 45)->nullable();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('login_links');
    }
};
