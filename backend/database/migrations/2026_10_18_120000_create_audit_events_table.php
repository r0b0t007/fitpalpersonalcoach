<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// The audit log, one row per event, in the shape the Node API wrote to DATA_DIR/audit.log. The id
// is not reused after a clear: a wiped log leaves a visible gap (Node's auditSeq), because a DELETE
// does not reset the autoincrement — persistently on InnoDB since MariaDB 10.2.4 / MySQL 8 and on
// SQLite AUTOINCREMENT. (With AUDIT_LOG off nothing is written at all, Node included.) ts is
// milliseconds, as the app reads it.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_events', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('ts');
            $table->string('ev', 64);
            $table->boolean('ok')->default(true);
            $table->string('uid', 16)->nullable();
            $table->string('name', 40)->nullable();
            $table->string('tgt', 16)->nullable();
            $table->string('tname', 40)->nullable();
            $table->string('msg', 120)->nullable();
            $table->string('ip', 45)->nullable();
            $table->index('ts');
            $table->index('ev');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_events');
    }
};
