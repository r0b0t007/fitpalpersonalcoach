<?php

// The AUDIT_* variables must mean what they meant to the Node API. env() gets in the way: it turns
// `false` into a boolean and a blank value into '', so each spelling is checked here against the
// value Node derived from it (api/server.js: AUDIT_ON, AUDIT_MAX, AUDIT_DAYS, AUDIT_IP).

function auditConfigWith(array $env): array
{
    $keys = ['AUDIT_LOG', 'AUDIT_MAX', 'AUDIT_DAYS', 'AUDIT_IP'];
    $saved = [];
    foreach ($keys as $k) {
        $saved[$k] = [$_SERVER[$k] ?? null, $_ENV[$k] ?? null, getenv($k)];
        unset($_SERVER[$k], $_ENV[$k]);
        putenv($k);
        if (array_key_exists($k, $env)) {
            $_SERVER[$k] = $_ENV[$k] = $env[$k];
            putenv("$k={$env[$k]}");
        }
    }
    try {
        return (require base_path('config/fitpal.php'))['audit'];
    } finally {
        foreach ($saved as $k => [$server, $e, $put]) {
            unset($_SERVER[$k], $_ENV[$k]);
            putenv($k);
            if ($server !== null) {
                $_SERVER[$k] = $server;
            }
            if ($e !== null) {
                $_ENV[$k] = $e;
            }
            if ($put !== false) {
                putenv("$k=$put");
            }
        }
    }
}

it('switches the log off only for 0/false/no/off, and on for blank or unset', function (?string $v, bool $on) {
    expect(auditConfigWith($v === null ? [] : ['AUDIT_LOG' => $v])['enabled'])->toBe($on);
})->with([
    'unset' => [null, true], 'blank' => ['', true], '1' => ['1', true], 'true' => ['true', true],
    'false' => ['false', false], 'FALSE' => ['FALSE', false], '(false)' => ['(false)', false],
    '0' => ['0', false], 'no' => ['no', false], 'off' => ['off', false],
]);

it('reads blank or unset counts as the default and an explicit 0 as no cap', function (?string $v, int $max, int $days) {
    $env = $v === null ? [] : ['AUDIT_MAX' => $v, 'AUDIT_DAYS' => $v];
    $c = auditConfigWith($env);
    expect([$c['max'], $c['days']])->toBe([$max, $days]);
})->with([
    'unset' => [null, 5000, 90], 'blank' => ['', 5000, 90], 'false' => ['false', 5000, 90],
    '0 = no cap' => ['0', 0, 0], '250' => ['250', 250, 250], 'negative' => ['-5', 0, 0], 'junk' => ['off', 0, 0],
]);

it('reads AUDIT_IP as Node did', function (?string $v, string $mode) {
    expect(auditConfigWith($v === null ? [] : ['AUDIT_IP' => $v])['ip'])->toBe($mode);
})->with([
    'unset' => [null, 'off'], 'full' => ['FULL', 'full'], 'net' => ['net', 'net'], 'true' => ['true', 'net'],
    '1' => ['1', 'net'], 'on' => ['on', 'net'], 'off' => ['off', 'off'], 'junk' => ['maybe', 'off'],
]);
