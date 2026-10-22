<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A coach's licence (spec §6): what Creem sold them, or what the owner granted by hand
        // (`manual`). users.licence_id points at the one in force; older rows stay as history.
        // Dates in milliseconds, as everything else the app reads back.
        Schema::create('licences', function (Blueprint $table) {
            $table->string('id', 32)->primary();
            $table->string('user_id', 16)->index();
            // pending|trialing|active|past_due|unpaid|paused|canceled|expired|manual
            $table->string('status', 16);
            $table->string('plan', 16)->nullable();     // solo|pro|studio (App\Domain\Plans)
            $table->string('period', 8)->nullable();    // month|year; null for a manual licence
            $table->string('source', 8);                // creem|manual
            $table->string('creem_customer_id', 64)->nullable()->index();
            $table->string('creem_subscription_id', 64)->nullable()->index();
            $table->string('creem_product_id', 64)->nullable();
            $table->string('checkout_id', 64)->nullable()->index();
            $table->string('request_id', 64)->nullable()->index();
            $table->text('checkout_url')->nullable();
            $table->timestamp('checkout_at', 3)->nullable();
            $table->timestamp('trial_ends_at', 3)->nullable();
            $table->timestamp('period_start', 3)->nullable();
            $table->timestamp('period_end', 3)->nullable();
            $table->timestamp('cancel_at', 3)->nullable();
            $table->timestamp('canceled_at', 3)->nullable();
            $table->boolean('disputed')->default(false);
            $table->string('last_event_id', 128)->nullable();
            $table->timestamp('last_event_at', 3)->nullable();
            $table->timestamp('created_at', 3)->nullable();
            $table->timestamp('updated_at', 3)->nullable();
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
        });

        // Creem webhook events already applied, by their id: a redelivery is answered, not applied
        // twice. The newest 1000 are kept (fitpal:prune).
        Schema::create('billing_events', function (Blueprint $table) {
            $table->string('id', 128)->primary();
            $table->timestamp('at', 3)->index();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('billing_events');
        Schema::dropIfExists('licences');
    }
};
