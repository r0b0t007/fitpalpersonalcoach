<?php

// The coach's public page (CHW-330, spec §3.1): one handle per coach, the link page with its
// preview tags, the public card the app draws, and the editor's save.

use App\Coaching\Handle;
use App\Http\Controllers\CoachPageController;
use App\Models\CoachPage;
use App\Models\User;
use App\Support\ClientSafe;
use App\Support\Phone;
use App\Tenancy\CoachContext;
use App\Tenancy\Detach;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
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

function openPage(object $coach, array $fields = []): CoachPage
{
    return Coaching::own(new CoachPage, $coach, $fields + ['handle' => 'sara.fit', 'bio' => 'Force <b>& co</b>', 'whatsapp' => '212612345678', 'open' => true, 'theme' => 'light', 'created' => 1, 'updated' => 1]);
}

it('answers the public card for an open page, by any spelling of its handle', function () {
    openPage($this->f->a);
    $this->getJson('/api/public/coach?h=@Sara.FIT')->assertOk()->assertExactJson(['coach' => [
        'name' => 'Coach A', 'handle' => 'sara.fit', 'bio' => 'Force <b>& co</b>', 'whatsapp' => '212612345678', 'theme' => 'light',
    ]]);
});

it('tells a closed page from a missing one, and hides the page of a coach who is gone', function () {
    $this->getJson('/api/public/coach?h=nobody')->assertStatus(404)->assertExactJson(['error' => 'no such coach page']);
    $page = openPage($this->f->a, ['open' => false]);
    $this->getJson('/api/public/coach?h=sara.fit')->assertStatus(404)->assertExactJson(['error' => 'this coach is not taking requests right now']);
    $page->forceFill(['open' => true])->save();
    $this->f->a->forceFill(['disabled' => true])->save();
    $this->getJson('/api/public/coach?h=sara.fit')->assertStatus(404)->assertExactJson(['error' => 'no such coach page']);
});

it('serves the link page with escaped preview tags, and sends the visitor on to the app', function () {
    openPage($this->f->a);
    $html = $this->get('/api/c/SARA.fit')->assertOk()->assertHeader('Content-Type', 'text/html; charset=UTF-8')->getContent();
    expect($html)->toContain('<meta property="og:title" content="Coach A · FitPal Coach">')
        ->toContain('<meta property="og:description" content="Force &lt;b&gt;&amp; co&lt;/b&gt;">')
        ->toContain('<meta property="og:url" content="https://coach.example/c/sara.fit">')
        ->toContain('<meta property="og:image" content="https://coach.example/icon-512.png">')
        ->toContain('location.replace("\/#\/c\/sara.fit")')
        ->not->toContain('<b>& co</b>');
    // Served at both mounts, as every route here is.
    $this->get('/c/sara.fit')->assertOk();
    // Sent on from Instagram's browser mid-form (CHW-332): into the join form, not the page.
    expect($this->get('/api/c/sara.fit?join=1')->assertOk()->getContent())->toContain('location.replace("\/#\/join\/sara.fit")');
});

it('answers 404 with no preview for a closed or unknown page, and still hands the visitor to the app', function () {
    openPage($this->f->a, ['open' => false]);
    foreach (['/api/c/sara.fit', '/api/c/nobody'] as $path) {
        $html = $this->get($path)->assertStatus(404)->getContent();
        expect($html)->not->toContain('og:title')->toContain('<meta name="robots" content="noindex">')->toContain('location.replace(');
    }
});

it('closes the page of a coach who loses the role', function () {
    openPage($this->f->a);
    Detach::coach($this->f->a);
    expect(CoachPage::acrossCoaches()->find($this->f->a->id)->open)->toBeFalse(); // across coaches: test reads A's page with no context
});

it('judges the coach again on the locked row: a save that waited behind a detach does not reopen the page', function () {
    // The request was let through as an enabled coach; the detach committed while the save waited
    // for the coach's lock. The row it then locks is the truth, and it says no.
    $stale = User::query()->find($this->f->a->id);
    User::query()->whereKey($stale->id)->update(['disabled' => true]);
    app(CoachContext::class)->set($stale);
    $request = Request::create('/api/coach/page/save', 'POST', server: ['CONTENT_TYPE' => 'application/json'], content: json_encode(['handle' => 'sara.fit', 'open' => true]));
    $request->setUserResolver(fn () => $stale);
    // Called past the HTTP layer, so the refusal arrives as the exception the handler renders as 401.
    expect(fn () => app(CoachPageController::class)->save($request))->toThrow(ClientSafe::class, 'not signed in')
        ->and(CoachPage::acrossCoaches()->count())->toBe(0); // across coaches: test counts every row
});

it('keeps a page with its coach: a coach with a page cannot be deleted out from under it', function () {
    // A coach with nothing else to their name, so only the page's key can stop the delete.
    $lone = tap((new User)->forceFill(['id' => 'tCoachLone000000', 'name' => 'Lone', 'coach' => true]))->save();
    openPage($lone, ['handle' => 'lone.coach']);
    expect(fn () => $lone->delete())->toThrow(QueryException::class);
});
