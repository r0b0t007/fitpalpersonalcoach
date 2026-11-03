<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // A coach's page photo (CHW-356): the file's name under media/coach/<coach>/, or none.
        Schema::table('coach_pages', function (Blueprint $table) {
            $table->string('photo', 40)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('coach_pages', function (Blueprint $table) {
            $table->dropColumn('photo');
        });
    }
};
