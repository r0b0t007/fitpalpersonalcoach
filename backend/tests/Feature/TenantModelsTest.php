<?php

// No model can opt out of the coach boundary by forgetting the trait: every model whose table has
// a coach_id column must use OwnedByCoach. One listed exception, with its reason.

use App\Models\User;
use App\Tenancy\OwnedByCoach;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

const NOT_SCOPED = [
    // Coaches and admins are users too: /me, the acting coach's own row and the admin's user list
    // must never be filtered. Clients are read through User::clientsOf($coach) instead.
    User::class => true,
];

it('scopes every model whose table belongs to a coach', function () {
    $checked = [];
    foreach (glob(app_path('Models/*.php')) as $file) {
        $class = 'App\\Models\\'.basename($file, '.php');
        if (! is_subclass_of($class, Model::class) || (new ReflectionClass($class))->isAbstract()) {
            continue;
        }
        $table = (new $class)->getTable();
        if (! Schema::hasTable($table) || ! Schema::hasColumn($table, 'coach_id')) {
            continue;
        }
        $checked[] = $class;
        if (isset(NOT_SCOPED[$class])) {
            continue;
        }
        expect(in_array(OwnedByCoach::class, class_uses_recursive($class), true))
            ->toBeTrue("$class has a coach_id column but does not use OwnedByCoach");
    }
    // The four tenant-owned models and User, at least: an empty list would pass anything.
    expect(count($checked))->toBeGreaterThanOrEqual(5);
});

it('leaves the coach filter to the scope: no controller filters on coach_id by hand', function () {
    // A hand-written filter is exactly what the next route forgets; the scope cannot be forgotten.
    // Reading clients goes through User::clientsOf($coach), which lives on the model.
    $offenders = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path('Http'))) as $file) {
        if ($file->getExtension() !== 'php') {
            continue;
        }
        foreach (file($file->getPathname()) as $n => $line) {
            if (preg_match("/where\w*\(\s*['\"][\w.]*coach_id['\"]/", $line)) {
                $offenders[] = str_replace(base_path().DIRECTORY_SEPARATOR, '', $file->getPathname()).':'.($n + 1);
            }
        }
    }
    expect($offenders)->toBe([]);
});
