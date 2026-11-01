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

function savePage(object $as, array $body)
{
    return test()->postJson('/api/coach/page/save', $body + ['bio' => '', 'whatsapp' => '', 'open' => true, 'theme' => 'dark'], bearer($as));
}

it('has no page until the coach saves one, then answers it with its link', function () {
    $this->getJson('/api/coach/page', bearer($this->f->a))->assertOk()->assertExactJson(['page' => null, 'url' => null]);
    savePage($this->f->a, ['handle' => '@Sara.Fit', 'bio' => '  Force pour femmes.  ', 'whatsapp' => '+212 612 345 678', 'theme' => 'light'])->assertOk()
        ->assertExactJson(['page' => ['handle' => 'sara.fit', 'bio' => 'Force pour femmes.', 'whatsapp' => '212612345678', 'open' => true, 'theme' => 'light'], 'url' => 'https://coach.example/c/sara.fit']);
    $this->getJson('/api/coach/page', bearer($this->f->a))->assertJsonPath('page.handle', 'sara.fit');
    expect(CoachPage::acrossCoaches()->count())->toBe(1); // across coaches: test counts every row
    $this->assertDatabaseHas('audit_events', ['ev' => 'coach.page.save', 'uid' => $this->f->a->id, 'msg' => 'sara.fit']);
});

it('saves over the same row, renames the handle, and keeps an unknown theme dark', function () {
    savePage($this->f->a, ['handle' => 'sara.fit'])->assertOk();
    savePage($this->f->a, ['handle' => 'sara.coach', 'theme' => 'neon', 'open' => 'yes'])->assertOk()
        ->assertJsonPath('page.handle', 'sara.coach')->assertJsonPath('page.theme', 'dark')->assertJsonPath('page.open', false);
    expect(CoachPage::acrossCoaches()->count())->toBe(1); // across coaches: test counts every row
});

it('refuses a handle another coach has, or the app keeps, whatever its case', function () {
    savePage($this->f->b, ['handle' => 'sara.fit'])->assertOk();
    savePage($this->f->a, ['handle' => 'SARA.fit'])->assertStatus(409)->assertExactJson(['error' => 'that handle is taken']);
    savePage($this->f->a, ['handle' => 'admin'])->assertStatus(409)->assertExactJson(['error' => 'that handle is taken']);
    // B keeps theirs, unchanged.
    $this->getJson('/api/coach/page', bearer($this->f->b))->assertJsonPath('page.handle', 'sara.fit');
});

it('says what is wrong with a handle, a bio or a number', function (array $body, int $status, string $error) {
    savePage($this->f->a, $body)->assertStatus($status)->assertExactJson(['error' => $error]);
    expect(CoachPage::acrossCoaches()->count())->toBe(0); // across coaches: test counts every row
})->with([
    'short handle' => [['handle' => 'ab'], 400, 'handles are 3–30 letters, numbers, dots or underscores'],
    'dash' => [['handle' => 'sara-fit'], 400, 'handles are 3–30 letters, numbers, dots or underscores'],
    'long bio' => [['handle' => 'sara.fit', 'bio' => str_repeat('é', 161)], 400, 'keep the bio to 160 characters'],
    'no country code' => [['handle' => 'sara.fit', 'whatsapp' => '0612345678'], 400, 'that is not a phone number — include the country code'],
]);

it('lets a client nowhere near it, and stops a read-only coach saving', function () {
    $this->getJson('/api/coach/page', bearer($this->f->a1))->assertStatus(403);
    Billing::on();   // billing on, no licence, no Free plan: read-only
    savePage($this->f->a, ['handle' => 'sara.fit'])->assertStatus(402);
    $this->getJson('/api/coach/page', bearer($this->f->a))->assertOk();
});
