<?php

// The environment contract the Node API had (docs/SELF_HOSTING.md), kept name for name so a
// deployment moves over by copying its variables. Everything here is read through config(), never
// env(), so config:cache works in production.

$flag = static fn (string $key, bool $default): bool => match (strtolower((string) env($key, $default ? '1' : '0'))) {
    '1', 'true', 'yes', 'on' => true,
    '0', 'false', 'no', 'off', '' => false,
    default => $default,
};

return [
    // Passkeys are bound to exactly this hostname and origin; both must match the address the app
    // is opened at, or every registration and login fails.
    'rp_id' => env('RP_ID', 'localhost'),
    'origin' => rtrim((string) env('ORIGIN', 'http://localhost:5173'), '/'),
    'rp_name' => env('RP_NAME', 'FitPal Coach'),

    // Who may create an account at all. A coach's invite link always works; INVITE_ONLY decides
    // whether anyone WITHOUT one can register. SELF_SERVE_COACH opens the paying path
    // (/#/start): a coach account with no clients, worthless until a licence lands on it.
    // Account ids that are admins whatever their row says: how the first operator bootstraps.
    'admin_uids' => array_values(array_filter(array_map('trim', explode(',', (string) env('ADMIN_UIDS', ''))))),
    'invite_only' => $flag('INVITE_ONLY', false),
    'allow_guest' => $flag('ALLOW_GUEST', true),
    'self_serve_coach' => $flag('SELF_SERVE_COACH', false),

    // The session token: `uid:expiryMs:sv` signed with HMAC-SHA256. The secret is the 64-hex text
    // the Node API kept in DATA_DIR/secret; importing it is what keeps every signed-in browser and
    // every paired phone working across the cutover.
    'session_secret' => env('SESSION_SECRET', ''),
    'session_days' => max(1, (int) env('SESSION_DAYS', 90)),

    // Media files stay on disk, outside the document root, where the Node API wrote them.
    // `?:` not a default argument: `DATA_DIR=` left blank in .env must mean the default too.
    'data_dir' => env('DATA_DIR') ?: storage_path('app/fitpal'),
    'media_max_video_mb' => max(1, (int) env('MEDIA_MAX_VIDEO_MB', 90)),
    'media_max_photo_mb' => max(1, (int) env('MEDIA_MAX_PHOTO_MB', 12)),

    'vapid' => [
        'public' => env('VAPID_PUBLIC_KEY', ''),
        'private' => env('VAPID_PRIVATE_KEY', ''),
        'subject' => env('VAPID_SUBJECT', ''),
    ],

    // Creem. Unset means billing is off: every coach is entitled, nothing is enforced, no route
    // talks to Creem. That is the state of a self-hosted instance and of the test suite.
    'creem' => [
        'api_key' => env('CREEM_API_KEY', ''),
        'webhook_secret' => env('CREEM_WEBHOOK_SECRET', ''),
        'api_base' => rtrim((string) env('CREEM_API_BASE', 'https://api.creem.io'), '/'),
        // "solo:month=prod_x,solo:year=prod_y,pro:month=…" — parsed by App\Domain\Plans.
        'products' => env('CREEM_PRODUCTS', ''),
    ],

    'audit' => [
        'enabled' => $flag('AUDIT_LOG', true),
        'max' => max(100, (int) env('AUDIT_MAX', 5000)),
        'days' => max(1, (int) env('AUDIT_DAYS', 90)),
        // off | net | full — how much of the caller's address a record keeps.
        'ip' => in_array(env('AUDIT_IP', 'off'), ['off', 'net', 'full'], true) ? env('AUDIT_IP', 'off') : 'off',
    ],
];
