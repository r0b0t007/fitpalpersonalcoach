<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Node's db.subs: one row per browser that allowed notifications. An endpoint belongs to
        // one account at a time (subscribing it again moves it), so it is unique — by its hash,
        // since an endpoint is a URL of any length and an index on it would not fit MariaDB's key.
        Schema::create('push_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->string('user_id', 16);
            $table->text('endpoint');
            $table->char('endpoint_hash', 64)->unique();
            $table->text('p256dh');
            $table->text('auth');
            $table->string('created', 30);
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('push_subscriptions');
    }
};
