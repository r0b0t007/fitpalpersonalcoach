<?php

// The coach's morning digest (App\Coaching\Digest) ports three frontend rules: lib/checkins.js
// checkinOverdue, lib/adherence.js adherenceOf's `missed`, and which of lib/roster-attention.js
// reasonFor's rows ranks first. Neither runtime can import the
// other's, so both run the same cases — frontend/src/lib/digest-parity.json, which
// digest-parity.test.js runs against the originals. Add a case there, not here.

use App\Coaching\Digest;

function digestCases(): stdClass
{
    return json_decode(file_get_contents(base_path('../frontend/src/lib/digest-parity.json')), false, 512, JSON_THROW_ON_ERROR);
}

it('says who is overdue on a check-in as the app does', function () {
    $cases = digestCases()->checkinOverdue;
    expect($cases)->not->toBeEmpty();
    foreach ($cases as $c) {
        expect(Digest::checkinOverdue($c->checkinDay, $c->lastCheckin, $c->today))->toBe($c->overdue, json_encode($c));
    }
});

it('counts missed sessions as the app does', function () {
    $cases = digestCases()->missed;
    expect($cases)->not->toBeEmpty();
    foreach ($cases as $c) {
        expect(Digest::missed(get_object_vars($c->parts), $c->today, $c->days))->toBe($c->missed, $c->name);
    }
});

it('counts a client as overdue only when that is their one row on Today', function () {
    $cases = digestCases()->todayRow;
    expect($cases)->not->toBeEmpty();
    foreach ($cases as $c) {
        expect(Digest::checkinRow(json_decode(json_encode($c->member), true), $c->today))->toBe($c->row, $c->name);
    }
});

it('scores the week before today, as the digest says, and keeps a decline as long as Today does', function () {
    $js = file_get_contents(base_path('../frontend/src/lib/roster-attention.js'));
    expect(Digest::WINDOW_DAYS)->toBe(8)
        ->and(preg_match('/export\s+const\s+DECLINE_DAYS\s*=\s*(\d+)/', $js, $m))->toBe(1)
        ->and(Digest::DECLINE_DAYS)->toBe((int) $m[1]);
});
