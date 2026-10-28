<?php

// DEFAULT_CHECKIN_DAY exists twice: frontend/src/lib/checkins.js decides which day the member's
// screen calls a period, App\Push\Reminders decides which day the server pushes a reminder on.
// Neither can import the other's, so nothing but this ties them together. A drift does not error:
// the Home card says a check-in is owed on a Sunday while the push arrives on a Monday, which
// reads like a reminder nobody asked for. Was api/scripts/check-checkin-day.mjs (CHW-301).

use App\Push\Reminders;

it('starts a check-in period on the same day as the app', function () {
    $js = file_get_contents(base_path('../frontend/src/lib/checkins.js'));
    // Anchored to `export const`: a comment mentioning the old value must not be what is compared.
    expect(preg_match('/export\s+const\s+DEFAULT_CHECKIN_DAY\s*=\s*(\d+)/', $js, $m))->toBe(1)
        ->and(Reminders::DEFAULT_CHECKIN_DAY)->toBe((int) $m[1])
        ->and(Reminders::DEFAULT_CHECKIN_DAY)->toBeGreaterThanOrEqual(0)->toBeLessThanOrEqual(6);
});
