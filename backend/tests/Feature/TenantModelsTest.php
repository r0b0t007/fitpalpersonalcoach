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

/**
 * Every PHP line under app/, minus the two places allowed to talk about coach_id directly: the
 * models (clientsOf, the scoped helpers) and app/Tenancy (the scope itself).
 *
 * @return iterable<array{string, int, string}> [file, line number, code]
 */
function appLines(): iterable
{
    $allowed = [app_path('Models'), app_path('Tenancy')];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path())) as $file) {
        $path = $file->getPathname();
        if ($file->getExtension() !== 'php' || array_filter($allowed, fn ($a) => str_starts_with($path, $a))) {
            continue;
        }
        foreach (file($path) as $n => $line) {
            yield [str_replace(base_path().DIRECTORY_SEPARATOR, '', $path), $n + 1, $line];
        }
    }
}

it('leaves the coach filter to the scope: nothing under app/ filters on coach_id by hand', function () {
    // where/orWhere/whereIn/firstWhere…('coach_id'…), the array form where(['coach_id' => …]), and
    // the dynamic whereCoachId(): a hand-written filter is what the next route forgets.
    $filter = "/(?:where\w*|firstwhere)\s*\(\s*\[?\s*['\"](?:\w+\.)?coach_id['\"]|wherecoachid\s*\(/i";
    $offenders = [];
    foreach (appLines() as [$file, $n, $line]) {
        // Console commands (the import) run with no coach context, where filtering by hand is the job.
        if (! str_contains($file, 'Console') && preg_match($filter, $line)) {
            $offenders[] = "$file:$n";
        }
    }
    expect($offenders)->toBe([]);
});

it('never reaches a tenant table through DB::table() outside console commands', function () {
    // DB::table() is not Eloquent: no scope, no ownership checks, no TenantBuilder. Model writes
    // that skip events are refused at runtime by TenantBuilder; this is the one way round it.
    // Console commands (the import) run with no coach context and are exempt.
    $raw = "/DB::table\(\s*['\"](?:invites|coach_programs|assignments|exercise_media)['\"]/";
    $offenders = [];
    foreach (appLines() as [$file, $n, $line]) {
        if (! str_contains($file, 'Console') && preg_match($raw, $line)) {
            $offenders[] = "$file:$n";
        }
    }
    expect($offenders)->toBe([]);
});

it('says why, on the line, every time a read goes across coaches', function () {
    $unexplained = [];
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(app_path())) as $file) {
        if ($file->getExtension() !== 'php' || str_starts_with($file->getPathname(), app_path('Tenancy'))) {
            continue;
        }
        foreach (file($file->getPathname()) as $n => $line) {
            if (str_contains($line, 'acrossCoaches()') && ! preg_match('#// across coaches: \S#', $line)) {
                $unexplained[] = str_replace(base_path().DIRECTORY_SEPARATOR, '', $file->getPathname()).':'.($n + 1);
            }
        }
    }
    expect($unexplained)->toBe([]);
});
