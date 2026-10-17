<?php

use App\WebAuthn\CacheChallengeRepository;

// Laragear WebAuthn's own keys, fed from the same variables as config/fitpal.php so one set
// (RP_ID, ORIGIN, RP_NAME) drives everything, as it did for the Node API. The package's
// WEBAUTHN_* variables are not read.

$origin = rtrim((string) env('ORIGIN', 'http://localhost:5173'), '/');

return [
    'relying_party' => [
        'name' => env('RP_NAME', 'FitPal Coach'),
        'id' => env('RP_ID', 'localhost'),
    ],

    // The package compares HOSTNAMES here (the origin's host must equal an entry or be a
    // subdomain of it); the exact-origin check the Node API made is App\WebAuthn\Pipes\CheckOriginExact.
    'origins' => parse_url($origin, PHP_URL_HOST) ?: 'localhost',

    'challenge' => [
        'bytes' => 16,
        // Seconds. The same figure as the cache entry's TTL, so the two never disagree.
        'timeout' => CacheChallengeRepository::TTL,
        'key' => '_webauthn',
    ],
];
