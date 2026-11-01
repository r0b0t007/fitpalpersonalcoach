<?php

// The coach's public page (CHW-330, spec §3.1): one handle per coach, the link page with its
// preview tags, the public card the app draws, and the editor's save.

use App\Coaching\Handle;
use App\Models\CoachPage;
use App\Support\Phone;
use Tests\Support\Billing;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'https://coach.example', 'fitpal.free_cap' => 0]);
    $this->f = Coaching::twoCoaches();
});

it('reads a handle as Instagram writes it, and keeps it to what a URL can carry', function () {
    expect(Handle::normalise(' @Sara.Fit '))->toBe('sara.fit')
        ->and(Handle::normalise(['x']))->toBe('')
        ->and(Handle::valid('sara.fit'))->toBeTrue()
        ->and(Handle::valid('sa'))->toBeFalse()
        ->and(Handle::valid(str_repeat('a', 31)))->toBeFalse()
        ->and(Handle::valid('sara-fit'))->toBeFalse()
        ->and(Handle::valid('.sara'))->toBeFalse()
        ->and(Handle::valid('sara.'))->toBeFalse()
        ->and(Handle::valid('sa..ra'))->toBeFalse()
        ->and(Handle::reserved('admin'))->toBeTrue()
        ->and(Handle::reserved('sara.fit'))->toBeFalse();
});

it('keeps a WhatsApp number as the digits wa.me wants, with its country code', function () {
    expect(Phone::digits(''))->toBe('')
        ->and(Phone::digits(null))->toBe('')
        ->and(Phone::digits('+212 6 12-34-56-78'))->toBe('212612345678')
        ->and(Phone::digits('00 34 612 345 678'))->toBe('34612345678')
        ->and(Phone::digits('(+33) 6 12 34 56 78'))->toBe('33612345678')
        ->and(Phone::digits('0612345678'))->toBeNull()        // no country code: wa.me cannot dial it
        ->and(Phone::digits('12345'))->toBeNull()
        ->and(Phone::digits('+212 6 12 34 abc'))->toBeNull();
});
