<?php

// The environment contract the Node API had (docs/SELF_HOSTING.md), kept name for name so a
// deployment moves over by copying its variables. Everything here is read through config(), never
// env(), so config:cache works in production.

$flag = static fn (string $key, bool $default): bool => match (strtolower((string) env($key, $default ? '1' : '0'))) {
    '1', 'true', 'yes', 'on' => true,
    '0', 'false', 'no', 'off', '' => false,
    default => $default,
};

// A count where blank means the default and 0 means "no cap" (env() makes `false` a bool; treat
// it as blank rather than as 0).
$count = static function (string $key, int $default): int {
    $v = env($key);

    return $v === null || $v === '' || is_bool($v) ? $default : max(0, (int) $v);
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
    // How the very first account gets in on an INVITE_ONLY instance, and becomes the admin: a long
    // random string, valid only while there are no users at all (App\Auth\Bootstrap).
    'bootstrap_code' => trim((string) env('BOOTSTRAP_CODE', '')),
    'allow_guest' => $flag('ALLOW_GUEST', true),
    'self_serve_coach' => $flag('SELF_SERVE_COACH', false),
    // Requests to join a coach from their public page (CHW-336/337). Off until the DPIA's conditions
    // are met (docs/privacy/2026-11-01-dpia-coaching-and-join-requests.md, section 6): the form
    // collects health data, and nothing may be collected before then.
    'join_requests' => $flag('JOIN_REQUESTS', false),
    // The Free plan (CHW-329): a coach with no paid plan may coach this many active clients, and
    // coach sign-up opens without Creem. 0 or unset = no Free plan: billing off then leaves every
    // coach unlimited, as a self-hosted instance and the test suite expect.
    'free_cap' => $count('FREE_CAP', 0),

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
        // Empty: the host follows the key (creem_test_… → test-api.creem.io), App\Billing\Creem.
        'api_base' => rtrim((string) env('CREEM_API_BASE', ''), '/'),
        // "solo:month=prod_x,solo:year=prod_y,pro:month=…" — parsed by App\Domain\Plans.
        'products' => env('CREEM_PRODUCTS', ''),
    ],

    // Parsed exactly as the Node API parsed them (api/server.js), which env()'s own typing gets in
    // the way of: env() turns `false` into boolean false, and a blank value into ''. So:
    //  - AUDIT_LOG is on unless it says 0/false/no/off (blank = on, as `process.env.X || ''`);
    //  - AUDIT_MAX / AUDIT_DAYS: blank or unset = the default (`process.env.X || 5000`), an explicit
    //    0 = no cap;
    //  - AUDIT_IP accepts `full`, or `net` and its truthy spellings, else off.
    //    The fitpal.ma legal pages (site-coach/, "Security log") promise no IPs and 90 days at most:
    //    turning AUDIT_IP on or raising AUDIT_DAYS means changing those pages first.
    'audit' => [
        'enabled' => ! (env('AUDIT_LOG') === false || preg_match('/^(0|false|no|off)$/i', (string) env('AUDIT_LOG', ''))),
        'max' => $count('AUDIT_MAX', 5000),
        'days' => $count('AUDIT_DAYS', 90),
        // off | net | full — how much of the caller's address a record keeps.
        'ip' => match (true) {
            (bool) preg_match('/^full$/i', (string) env('AUDIT_IP', '')) => 'full',
            (bool) preg_match('/^(1|true|yes|on|net)$/i', (string) env('AUDIT_IP', '')) => 'net',
            default => 'off',
        },
    ],
];
