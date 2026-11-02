<?php

// The coach's morning digest (App\Coaching\Digest) ports two frontend rules: lib/checkins.js
// checkinOverdue and lib/adherence.js adherenceOf's `missed`. Neither runtime can import the
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

it('scores the week before today, as the digest says', function () {
    expect(Digest::WINDOW_DAYS)->toBe(8);
});
