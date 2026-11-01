<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // CHW-338: the program a coach's page gives every client it brings in, and whether a
        // request is accepted the moment its code is checked. An offer made that way is `auto`:
        // the client's app takes it in by itself, so workout 1 is there the day they join.
        Schema::table('coach_pages', function (Blueprint $table) {
            $table->string('starter_program_id', 64)->nullable();
            $table->boolean('auto_accept')->default(false);
        });
        Schema::table('assignments', function (Blueprint $table) {
            $table->boolean('auto')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('coach_pages', function (Blueprint $table) {
            $table->dropColumn(['starter_program_id', 'auto_accept']);
        });
        Schema::table('assignments', function (Blueprint $table) {
            $table->dropColumn('auto');
        });
    }
};
