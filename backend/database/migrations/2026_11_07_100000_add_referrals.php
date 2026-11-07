<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Coach referrals (CHW-350). The handle a sign-up came through, until its code is verified.
        Schema::table('coach_signups', function (Blueprint $table) {
            $table->string('ref', 30)->nullable();
        });
        // Who referred a coach. No foreign key: a coach's account is never deleted in the app
        // (DeleteAccount refuses coaches), and a referrer that can't be found is skipped.
        Schema::table('users', function (Blueprint $table) {
            $table->string('referred_by', 16)->nullable();
            $table->index('referred_by');
        });
        // A month banked for a referrer, once per referred coach ever (the unique index).
        Schema::create('referral_credits', function (Blueprint $table) {
            $table->string('id', 32)->primary();
            $table->string('referrer_id', 16);
            $table->string('referred_id', 16)->unique();
            $table->unsignedTinyInteger('months')->default(1);
            $table->bigInteger('created');              // epoch ms, as the join requests keep them
            $table->bigInteger('used_at')->nullable();  // set by the owner, from the admin panel
            $table->string('used_note', 120)->nullable();
            $table->index('referrer_id');
            $table->foreign('referrer_id')->references('id')->on('users')->cascadeOnDelete();
            $table->foreign('referred_id')->references('id')->on('users')->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('referral_credits');
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['referred_by']);
            $table->dropColumn('referred_by');
        });
        Schema::table('coach_signups', function (Blueprint $table) {
            $table->dropColumn('ref');
        });
    }
};
