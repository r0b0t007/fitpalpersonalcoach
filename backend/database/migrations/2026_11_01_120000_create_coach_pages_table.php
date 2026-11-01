<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A coach's public page (CHW-330): the one link in their Instagram bio. One row per coach,
        // keyed by the coach; the handle is unique across every coach, stored lowercase.
        Schema::create('coach_pages', function (Blueprint $table) {
            $table->string('coach_id', 16)->primary();
            $table->string('handle', 30)->unique();
            $table->string('bio', 160)->default('');
            $table->string('whatsapp', 20)->default('');   // digits with the country code, for wa.me
            $table->boolean('open')->default(false);
            $table->string('theme', 5)->default('dark');    // dark | light — the coach picks (CHW-323)
            // Epoch milliseconds, as every other coach table keeps them.
            $table->bigInteger('created');
            $table->bigInteger('updated');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('coach_pages');
    }
};
