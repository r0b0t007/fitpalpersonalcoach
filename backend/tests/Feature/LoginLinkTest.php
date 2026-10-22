<?php

// A coach's sign-in by email link, changing the address it goes to, and a second passkey (CHW-233,
// spec §4a). Mail is faked; the link is read back from the mail, as the coach would.

use App\Mail\AccountMail;
use App\Mail\MailCopy;
use App\Models\LoginLink;
use App\Models\User;
use App\Models\UserState;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Testing\TestResponse;
use Laragear\WebAuthn\Models\WebAuthnCredential;
use Tests\Support\Coaching;
use Tests\Support\Passkey;

beforeEach(function () {
    config([
        'fitpal.rp_id' => 'localhost', 'fitpal.origin' => 'http://localhost:5173',
        'webauthn.relying_party.id' => 'localhost', 'webauthn.origins' => 'localhost',
        'fitpal.session_secret' => str_repeat('ab', 32),
    ]);
    Mail::fake();
    RateLimiter::clear('login-link:ip:127.0.0.1');
    $this->f = Coaching::twoCoaches();
    $this->f->a->forceFill(['email' => 'coach.a@example.com'])->save();
});

function askLink(string $email): TestResponse
{
    return test()->postJson('/api/login/email', ['email' => $email]);
}

function redeemLink(string $token): TestResponse
{
    return test()->postJson('/api/login/link', ['t' => $token]);
}

/** The token in the newest mail of $kind sent to $to. */
function tokenMailed(string $to, string $kind = 'signin'): string
{
    $mail = Mail::sent(AccountMail::class, fn (AccountMail $m) => $m->kind === $kind && $m->hasTo($to))->last();
    expect($mail)->not->toBeNull();
    parse_str((string) parse_url(str_replace('/#/link', '/link', $mail->url), PHP_URL_QUERY), $q);

    return $q['t'];
}

it('mails a coach a sign-in link and says the same to everyone else', function () {
    $f = $this->f;
    $f->a1->forceFill(['email' => 'client@example.com'])->save();
    $f->b->forceFill(['email' => 'coach.b@example.com', 'disabled' => true])->save();
    $f->u1->forceFill(['coach' => true, 'pending_email' => 'pending@example.com'])->save();
    foreach (['nobody@example.com', 'client@example.com', 'coach.b@example.com', 'pending@example.com', 'not an email', ''] as $email) {
        askLink($email)->assertOk()->assertExactJson(['ok' => true]);
    }
    Mail::assertNothingSent();
    expect(LoginLink::query()->count())->toBe(0);

    // Typed with capitals and spaces, it is the same address.
    askLink('  Coach.A@Example.COM ')->assertOk()->assertExactJson(['ok' => true]);
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'signin' && $m->hasTo('coach.a@example.com')
        && str_starts_with($m->url, 'http://localhost:5173/#/link?t='));
    $token = tokenMailed('coach.a@example.com');
    $row = LoginLink::query()->sole();
    expect(strlen($token))->toBe(43)
        ->and($row->token_hash)->toBe(hash('sha256', $token))
        ->and($row->only(['user_id', 'purpose']))->toBe(['user_id' => $f->a->id, 'purpose' => 'login'])
        ->and(json_encode(LoginLink::query()->first()->toArray()))->not->toContain($token);
});

it('signs the coach in with the link, once, as a passkey sign-in does', function () {
    $f = $this->f;
    askLink('coach.a@example.com');
    $token = tokenMailed('coach.a@example.com');
    $res = redeemLink($token)->assertOk()->assertJsonPath('user.id', $f->a->id);
    $cookie = $res->getCookie('gymsid', false);
    expect($cookie?->getValue())->not->toBeEmpty()
        ->and($f->a->fresh()->email_verified_at)->not->toBeNull();
    $this->assertDatabaseHas('audit_events', ['ev' => 'login.link', 'uid' => $f->a->id]);
    $this->getJson('/api/me', ['Authorization' => 'Bearer '.$cookie->getValue()])->assertOk()->assertJsonPath('user.id', $f->a->id);

    redeemLink($token)->assertStatus(400)->assertExactJson(['error' => 'this sign-in link was already used']);

    // logout/all ends a link's session as it ends any other.
    $this->postJson('/api/logout/all', [], ['Authorization' => 'Bearer '.$cookie->getValue()])->assertOk();
    $this->getJson('/api/me', ['Authorization' => 'Bearer '.$cookie->getValue()])->assertStatus(401);
});

it('refuses a link that expired, an unknown one, a disabled account, and one a newer link replaced', function () {
    $f = $this->f;
    $expired = ['error' => 'this sign-in link has expired — request a new one'];
    askLink('coach.a@example.com');
    $old = tokenMailed('coach.a@example.com');
    askLink('coach.a@example.com');
    $new = tokenMailed('coach.a@example.com');
    redeemLink($old)->assertStatus(400)->assertExactJson(['error' => 'this sign-in link was already used']);
    redeemLink('made-up-token')->assertStatus(400)->assertExactJson($expired);
    redeemLink('')->assertStatus(400)->assertExactJson($expired);

    $this->travel(LoginLink::TTL_MINUTES + 1)->minutes();
    redeemLink($new)->assertStatus(400)->assertExactJson($expired);
    $this->travelBack();

    askLink('coach.a@example.com');
    $third = tokenMailed('coach.a@example.com');
    $f->a->forceFill(['disabled' => true])->save();
    redeemLink($third)->assertStatus(403)->assertExactJson(['error' => 'this account has been disabled']);
    // Refused, not spent: re-enabled within the 15 minutes, it still works.
    $f->a->forceFill(['disabled' => false])->save();
    redeemLink($third)->assertOk();
});

it('sends at most 3 links per address per 15 minutes and serves 10 requests per IP an hour, answering the same', function () {
    foreach (range(1, 4) as $i) {
        askLink('coach.a@example.com')->assertOk()->assertExactJson(['ok' => true]);
    }
    Mail::assertSentCount(3);
    $this->assertDatabaseHas('audit_events', ['ev' => 'login.link.throttled', 'ok' => false]);
    expect(DB::table('audit_events')->where('ev', 'login.link.throttled')->value('msg'))->toBeNull();   // the address is not recorded

    RateLimiter::clear('login-link:ip:127.0.0.1');
    foreach (range(1, 10) as $i) {
        askLink("nobody{$i}@example.com");
    }
    $this->travel(16)->minutes();   // the address limit has passed; the IP's has not
    askLink('coach.a@example.com')->assertOk();
    Mail::assertSentCount(3);
});

it('changes the sign-in address only when the link to the new one is opened, and tells the old one', function () {
    $f = $this->f;
    $change = fn (User $who, string $email) => $this->postJson('/api/account/email', ['email' => $email], bearer($who));
    $change($f->a, 'new.a@example.com')->assertOk()->assertExactJson(['ok' => true, 'pendingEmail' => 'new.a@example.com']);
    expect($f->a->fresh()->only(['email', 'pending_email']))->toBe(['email' => 'coach.a@example.com', 'pending_email' => 'new.a@example.com']);
    $token = tokenMailed('new.a@example.com', 'confirm');

    // The pending address cannot be used to sign in; the old one still can.
    askLink('new.a@example.com');
    Mail::assertNotSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'signin');

    redeemLink($token)->assertOk()->assertExactJson(['ok' => true, 'email' => 'new.a@example.com']);
    $a = $f->a->fresh();
    expect($a->only(['email', 'pending_email']))->toBe(['email' => 'new.a@example.com', 'pending_email' => null])
        ->and($a->email_verified_at)->not->toBeNull();
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'changed' && $m->hasTo('coach.a@example.com') && $m->url === null
        && str_contains($m->words['body'], 'new.a@example.com'));
    $this->assertDatabaseHas('audit_events', ['ev' => 'account.email', 'uid' => $f->a->id]);
    // Sign-in links now go to the new address only.
    askLink('coach.a@example.com');
    Mail::assertNotSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'signin');
    askLink('new.a@example.com');
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'signin' && $m->hasTo('new.a@example.com'));
});

it('refuses an address change that is not one, is taken, is the same, or comes from a client', function () {
    $f = $this->f;
    $f->b->forceFill(['email' => 'coach.b@example.com'])->save();
    $change = fn (User $who, string $email) => $this->postJson('/api/account/email', ['email' => $email], bearer($who));
    $change($f->a, 'nope')->assertStatus(400)->assertExactJson(['error' => 'that is not an email address']);
    $change($f->a, ' COACH.A@example.com')->assertStatus(400)->assertExactJson(['error' => 'that is already your sign-in email']);
    $change($f->a, 'Coach.B@example.com')->assertStatus(409)->assertExactJson(['error' => 'that email address is already used by another account']);
    $change($f->a1, 'client.new@example.com')->assertStatus(403);
    $this->postJson('/api/account/email', ['email' => 'x@example.com'])->assertStatus(401);
    Mail::assertNothingSent();
    expect($f->a->fresh()->pending_email)->toBeNull();
});

it('lets a newer change replace an older one, and never swaps to an address someone took meanwhile', function () {
    $f = $this->f;
    $this->postJson('/api/account/email', ['email' => 'first@example.com'], bearer($f->a))->assertOk();
    $first = tokenMailed('first@example.com', 'confirm');
    $this->postJson('/api/account/email', ['email' => 'second@example.com'], bearer($f->a))->assertOk();
    $second = tokenMailed('second@example.com', 'confirm');
    redeemLink($first)->assertStatus(400);
    $f->b->forceFill(['email' => 'second@example.com'])->save();
    redeemLink($second)->assertStatus(409);
    expect($f->a->fresh()->email)->toBe('coach.a@example.com');
});

it('does not swap to an address the account no longer has pending', function () {
    $f = $this->f;
    $this->postJson('/api/account/email', ['email' => 'new.a@example.com'], bearer($f->a))->assertOk();
    $token = tokenMailed('new.a@example.com', 'confirm');
    // The pending address cleared some other way (by hand, or a later flow that resets it).
    $f->a->forceFill(['pending_email' => null])->save();
    redeemLink($token)->assertStatus(400)->assertExactJson(['error' => 'this sign-in link has expired — request a new one']);
    expect($f->a->fresh()->email)->toBe('coach.a@example.com');
});

it('adds a second passkey to the signed-in account, and either one signs in', function () {
    $f = $this->f;
    $options = $this->postJson('/api/passkeys/options', [], bearer($f->a))->assertOk();
    expect($options->json('options.user.name'))->toBe('Coach A');
    $pk = new Passkey;
    $this->postJson('/api/passkeys/verify', ['cid' => $options->json('cid'), 'credential' => $pk->attest($options->json('options'))], bearer($f->a))
        ->assertOk()->assertExactJson(['ok' => true]);
    expect(WebAuthnCredential::query()->where('authenticatable_id', $f->a->id)->count())->toBe(1);
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.passkey.add', 'uid' => $f->a->id]);
    $pk->login($this)->assertOk()->assertJsonPath('user.id', $f->a->id);

    // A second one, from another device: both work.
    $options = $this->postJson('/api/passkeys/options', [], bearer($f->a))->assertOk();
    expect($options->json('options.excludeCredentials'))->toHaveCount(1);
    $pk2 = new Passkey;
    $this->postJson('/api/passkeys/verify', ['cid' => $options->json('cid'), 'credential' => $pk2->attest($options->json('options'))], bearer($f->a))->assertOk();
    $pk2->login($this)->assertOk()->assertJsonPath('user.id', $f->a->id);
    $pk->login($this)->assertOk();
});

it('attaches a passkey only with a challenge made for this account\'s add', function () {
    $f = $this->f;
    $pk = new Passkey;
    // Another account's challenge.
    $theirs = $this->postJson('/api/passkeys/options', [], bearer($f->b))->assertOk();
    $this->postJson('/api/passkeys/verify', ['cid' => $theirs->json('cid'), 'credential' => $pk->attest($theirs->json('options'))], bearer($f->a))
        ->assertStatus(400)->assertExactJson(['error' => 'challenge expired — try again']);
    // A sign-up's challenge.
    $signup = $this->postJson('/api/register/options', ['name' => 'X'])->assertOk();
    $this->postJson('/api/passkeys/verify', ['cid' => $signup->json('cid'), 'credential' => $pk->attest($signup->json('options'))], bearer($f->a))
        ->assertStatus(400);
    $this->postJson('/api/passkeys/options')->assertStatus(401);
    expect(WebAuthnCredential::query()->count())->toBe(0);
});

it('prunes links older than a day', function () {
    askLink('coach.a@example.com');
    $this->travel(LoginLink::KEEP_HOURS + 1)->hours();
    askLink('coach.a@example.com');
    $this->artisan('fitpal:prune')->assertSuccessful();
    expect(LoginLink::query()->count())->toBe(1);
});

it('writes the mail in the language the app is set to, falling back to English, in both parts', function (?string $lang, string $expect, string $heading) {
    $f = $this->f;
    if ($lang !== null) {
        tap(UserState::query()->firstOrNew(['user_id' => $f->a->id]))->forceFill(['state' => json_encode(['lang' => $lang])])->save();
    }
    askLink('coach.a@example.com');
    $mail = Mail::sent(AccountMail::class)->last();
    expect($mail->lang)->toBe($expect);
    $html = $mail->render();
    $text = view('mail.account-text', ['w' => $mail->words, 'url' => $mail->url, 'lang' => $mail->lang])->render();
    expect($html)->toContain($heading)->toContain(htmlspecialchars($mail->url))
        ->and($text)->toContain($heading)->toContain($mail->url)->not->toContain('&amp;')->not->toContain('&#039;');
})->with([
    'French' => ['fr', 'fr', 'Votre lien de connexion'],
    'Spanish' => ['es', 'es', 'Tu enlace de acceso'],
    'German' => ['de', 'de', 'Dein Anmeldelink'],
    'Italian: not one of ours' => ['it', 'en', 'Your sign-in link'],
    'no state' => [null, 'en', 'Your sign-in link'],
]);

it('says everything in every language that it says in English', function () {
    foreach (['fr', 'es', 'de'] as $lang) {
        expect(MailCopy::keys($lang))->toBe(MailCopy::keys('en'));
    }
});
