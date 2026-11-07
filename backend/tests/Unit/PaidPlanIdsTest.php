<?php

// fitpal.ma's pricing cards link to /#/start?plan=<tier>. When the server doesn't sell that tier,
// the sign-up screen says so (CHW-371), but only for an id frontend/src/lib/billing.js knows to be
// a paid tier. A tier added here and missing there would quietly land coaches on Free again.

use App\Domain\Plans;

it('names the same paid tiers as the app', function () {
    $js = file_get_contents(base_path('../frontend/src/lib/billing.js'));
    expect(preg_match('/export const PAID_PLAN_IDS = \\[([^\\]]*)\\]/', $js, $m))->toBe(1);
    preg_match_all("/'([a-z]+)'/", $m[1], $ids);
    expect($ids[1])->toBe(array_keys(Plans::CAPS));
});
