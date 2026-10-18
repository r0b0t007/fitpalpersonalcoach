<?php

// The PHP limits the contract needs are written three times because each server reads its own
// file: public/.htaccess (LiteSpeed block, mod_php block) and public/.user.ini (PHP-FPM). The
// cPanel host is LiteSpeed and ignores .user.ini, so a value changed in only one place silently
// does nothing in production. This keeps all three, and the README table, saying the same thing.

const PHP_LIMIT_KEYS = ['post_max_size', 'upload_max_filesize', 'memory_limit', 'max_execution_time', 'max_input_time'];

function htaccessBlock(string $htaccess, string $module): array
{
    preg_match('/<IfModule '.preg_quote($module, '/').'>(.*?)<\/IfModule>/s', $htaccess, $m);
    preg_match_all('/php_value\s+(\S+)\s+(\S+)/', $m[1] ?? '', $pairs, PREG_SET_ORDER);

    return collect($pairs)->mapWithKeys(fn ($p) => [$p[1] => $p[2]])->sortKeys()->all();
}

it('sets the same limits for LiteSpeed, mod_php and PHP-FPM, and documents them', function () {
    $htaccess = file_get_contents(base_path('public/.htaccess'));
    $userIni = collect(parse_ini_file(base_path('public/.user.ini')))->sortKeys()->all();
    $litespeed = htaccessBlock($htaccess, 'Litespeed');
    $modPhp = htaccessBlock($htaccess, 'mod_php.c');

    expect(array_keys($litespeed))->toEqualCanonicalizing(PHP_LIMIT_KEYS)
        ->and($modPhp)->toBe($litespeed)
        ->and($userIni)->toBe($litespeed);

    $readme = file_get_contents(base_path('README.md'));
    foreach ($litespeed as $key => $value) {
        expect($readme)->toMatch('/\|\s*`'.preg_quote($key, '/').'`\s*\|\s*`'.preg_quote($value, '/').'`\s*\|/');
    }
});
