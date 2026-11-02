<?php

// A phone number as typed (App\Support\Phone) is read in two places: here, which stores it, and
// frontend/src/lib/whatsapp.js, which turns it into what it sends (CHW-341). Neither runtime can
// import the other's, so both run the same cases — frontend/src/lib/phone-parity.json, which
// whatsapp.test.js runs against waDigits with no country to assume. Add a case there, not here.

use App\Support\Phone;

it('reads a typed number as the app does', function () {
    $cases = json_decode(file_get_contents(base_path('../frontend/src/lib/phone-parity.json')), false, 512, JSON_THROW_ON_ERROR)->cases;
    expect($cases)->not->toBeEmpty();
    foreach ($cases as $c) {
        expect(Phone::digits($c->raw))->toBe($c->want, json_encode($c));
    }
});
