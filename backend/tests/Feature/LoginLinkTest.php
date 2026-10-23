<?php

// A coach's sign-in by email link, changing the address it goes to, and a second passkey (CHW-233,
// spec §4a). Mail is faked; the link is read back from the mail, as the coach would.

use App\Auth\FreshAuth;
use App\Auth\SessionToken;
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

/** A session that signed in just now (a passkey or a link), which the address change and a new passkey need. */
function freshBearer(User $user): array
{
    $token = SessionToken::make($user);
    FreshAuth::mark($token);

    return ['Authorization' => 'Bearer '.$token];
}

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

it('refuses a link that expired, an unknown one, a disabled account, and the others once one is used', function () {
    $f = $this->f;
    $expired = ['error' => 'this sign-in link has expired — request a new one'];
    // Two links asked for (by the coach, or by a stranger typing their address): both work until
    // one is used, so asking again never spends the one the coach is about to open.
    askLink('coach.a@example.com');
    $old = tokenMailed('coach.a@example.com');
    askLink('coach.a@example.com');
    $new = tokenMailed('coach.a@example.com');
    redeemLink($old)->assertOk();
    redeemLink($new)->assertStatus(400)->assertExactJson(['error' => 'this sign-in link was already used']);
    redeemLink('made-up-token')->assertStatus(400)->assertExactJson($expired);
    redeemLink('')->assertStatus(400)->assertExactJson($expired);

    askLink('coach.a@example.com');
    $late = tokenMailed('coach.a@example.com');
    $this->travel(LoginLink::TTL_MINUTES + 1)->minutes();
    redeemLink($late)->assertStatus(400)->assertExactJson($expired);
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
    $change = fn (User $who, string $email) => $this->postJson('/api/account/email', ['email' => $email], freshBearer($who));
    $change($f->a, 'new.a@example.com')->assertOk()->assertExactJson(['ok' => true, 'pendingEmail' => 'new.a@example.com']);
    expect($f->a->fresh()->only(['email', 'pending_email']))->toBe(['email' => 'coach.a@example.com', 'pending_email' => 'new.a@example.com']);
    $token = tokenMailed('new.a@example.com', 'confirm');

    // The pending address cannot be used to sign in; the old one still can.
    askLink('new.a@example.com');
    Mail::assertNotSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'signin');

    // A sign-in link sent to the old address before the change...
    askLink('coach.a@example.com');
    $before = tokenMailed('coach.a@example.com');
    redeemLink($token)->assertOk()->assertExactJson(['ok' => true, 'email' => 'new.a@example.com']);
    // ...stops working once the address has moved.
    redeemLink($before)->assertStatus(400)->assertExactJson(['error' => 'this sign-in link was already used']);
    $a = $f->a->fresh();
    expect($a->only(['email', 'pending_email']))->toBe(['email' => 'new.a@example.com', 'pending_email' => null])
        ->and($a->email_verified_at)->not->toBeNull();
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'changed' && $m->hasTo('coach.a@example.com') && $m->url === null
        && str_contains($m->words['body'], 'new.a@example.com'));
    $this->assertDatabaseHas('audit_events', ['ev' => 'account.email', 'uid' => $f->a->id]);
    // Sign-in links now go to the new address only: nothing more to the old one than before.
    $toOld = fn () => Mail::sent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'signin' && $m->hasTo('coach.a@example.com'))->count();
    $sent = $toOld();
    askLink('coach.a@example.com');
    expect($toOld())->toBe($sent);
    askLink('new.a@example.com');
    Mail::assertSent(AccountMail::class, fn (AccountMail $m) => $m->kind === 'signin' && $m->hasTo('new.a@example.com'));
});

it('refuses an address change that is not one, is the same, or comes from a client — and says nothing of who has an address', function () {
    $f = $this->f;
    $f->b->forceFill(['email' => 'coach.b@example.com'])->save();
    $change = fn (User $who, string $email) => $this->postJson('/api/account/email', ['email' => $email], freshBearer($who));
    $change($f->a, 'nope')->assertStatus(400)->assertExactJson(['error' => 'that is not an email address']);
    $change($f->a, ' COACH.A@example.com')->assertStatus(400)->assertExactJson(['error' => 'that is already your sign-in email']);
    // Another account's address: answered like any other, so this is no way to look addresses up;
    // whoever holds that inbox and opens the link is the one told it is taken.
    $change($f->a, 'Coach.B@example.com')->assertOk();
    redeemLink(tokenMailed('coach.b@example.com', 'confirm'))->assertStatus(409)->assertExactJson(['error' => 'that email address is already used by another account']);
    expect($f->a->fresh()->email)->toBe('coach.a@example.com');
    $change($f->a1, 'client.new@example.com')->assertStatus(403);
    // Another account's address that was only asked for, never confirmed, blocks nobody.
    $f->b->forceFill(['email' => 'coach.b2@example.com', 'pending_email' => 'squatted@example.com'])->save();
    $change($f->a, 'squatted@example.com')->assertOk();
    Mail::fake();
    // A session that did not sign in just now (a paired phone, a laptop left signed in) cannot.
    $this->postJson('/api/account/email', ['email' => 'other@example.com'], bearer($f->a))
        ->assertStatus(403)->assertExactJson(['error' => 'sign in again to do this — it needs a recent sign-in']);
    $this->postJson('/api/account/email', ['email' => 'x@example.com'])->assertStatus(401);
    Mail::assertNothingSent();
    expect($f->a->fresh()->pending_email)->toBe('squatted@example.com');
});

it('lets a newer change replace an older one, and never swaps to an address someone took meanwhile', function () {
    $f = $this->f;
    $this->postJson('/api/account/email', ['email' => 'first@example.com'], freshBearer($f->a))->assertOk();
    $first = tokenMailed('first@example.com', 'confirm');
    $this->postJson('/api/account/email', ['email' => 'second@example.com'], freshBearer($f->a))->assertOk();
    $second = tokenMailed('second@example.com', 'confirm');
    redeemLink($first)->assertStatus(400);
    $f->b->forceFill(['email' => 'second@example.com'])->save();
    redeemLink($second)->assertStatus(409);
    expect($f->a->fresh()->email)->toBe('coach.a@example.com');
});

it('does not swap to an address the account no longer has pending', function () {
    $f = $this->f;
    $this->postJson('/api/account/email', ['email' => 'new.a@example.com'], freshBearer($f->a))->assertOk();
    $token = tokenMailed('new.a@example.com', 'confirm');
    // The pending address cleared some other way (by hand, or a later flow that resets it).
    $f->a->forceFill(['pending_email' => null])->save();
    redeemLink($token)->assertStatus(400)->assertExactJson(['error' => 'this sign-in link has expired — request a new one']);
    expect($f->a->fresh()->email)->toBe('coach.a@example.com');
});

it('adds a second passkey to the signed-in account, and either one signs in', function () {
    $f = $this->f;
    $options = $this->postJson('/api/passkeys/options', [], freshBearer($f->a))->assertOk();
    expect($options->json('options.user.name'))->toBe('Coach A');
    $pk = new Passkey;
    $this->postJson('/api/passkeys/verify', ['cid' => $options->json('cid'), 'credential' => $pk->attest($options->json('options'))], freshBearer($f->a))
        ->assertOk()->assertExactJson(['ok' => true]);
    expect(WebAuthnCredential::query()->where('authenticatable_id', $f->a->id)->count())->toBe(1);
    $this->assertDatabaseHas('audit_events', ['ev' => 'auth.passkey.add', 'uid' => $f->a->id]);
    $pk->login($this)->assertOk()->assertJsonPath('user.id', $f->a->id);

    // A second one, from another device: both work.
    $options = $this->postJson('/api/passkeys/options', [], freshBearer($f->a))->assertOk();
    expect($options->json('options.excludeCredentials'))->toHaveCount(1);
    $pk2 = new Passkey;
    $this->postJson('/api/passkeys/verify', ['cid' => $options->json('cid'), 'credential' => $pk2->attest($options->json('options'))], freshBearer($f->a))->assertOk();
    $pk2->login($this)->assertOk()->assertJsonPath('user.id', $f->a->id);
    $pk->login($this)->assertOk();
});

it('attaches a passkey only with a challenge made for this account\'s add', function () {
    $f = $this->f;
    $pk = new Passkey;
    // Another account's challenge.
    $theirs = $this->postJson('/api/passkeys/options', [], freshBearer($f->b))->assertOk();
    $this->postJson('/api/passkeys/verify', ['cid' => $theirs->json('cid'), 'credential' => $pk->attest($theirs->json('options'))], freshBearer($f->a))
        ->assertStatus(400)->assertExactJson(['error' => 'challenge expired — try again']);
    // A sign-up's challenge.
    $signup = $this->postJson('/api/register/options', ['name' => 'X'])->assertOk();
    $this->postJson('/api/passkeys/verify', ['cid' => $signup->json('cid'), 'credential' => $pk->attest($signup->json('options'))], freshBearer($f->a))
        ->assertStatus(400);
    $this->postJson('/api/passkeys/options')->assertStatus(401);
    // A session alone, not just signed in, cannot plant a passkey.
    $this->postJson('/api/passkeys/options', [], bearer($f->a))->assertStatus(403)
        ->assertExactJson(['error' => 'sign in again to do this — it needs a recent sign-in']);
    // An add-a-passkey challenge is never a sign-up's.
    $add = $this->postJson('/api/passkeys/options', [], freshBearer($f->a))->assertOk();
    $this->postJson('/api/register/verify', ['cid' => $add->json('cid'), 'credential' => $pk->attest($add->json('options'))])
        ->assertStatus(400)->assertExactJson(['error' => 'challenge expired — try again']);
    expect(WebAuthnCredential::query()->count())->toBe(0);
});

it('counts a link sign-in as just signed in: the coach can add a passkey right after, not 15 minutes later', function () {
    askLink('coach.a@example.com');
    $cookie = redeemLink(tokenMailed('coach.a@example.com'))->assertOk()->getCookie('gymsid', false)->getValue();
    $this->postJson('/api/passkeys/options', [], ['Authorization' => 'Bearer '.$cookie])->assertOk();
    $this->travel(FreshAuth::MINUTES + 1)->minutes();
    $this->postJson('/api/passkeys/options', [], ['Authorization' => 'Bearer '.$cookie])->assertStatus(403);
});

it('keys the per-IP limit on the client behind Cloudflare, not on Cloudflare', function () {
    $this->postJson('/api/login/email', ['email' => 'x@example.com'], ['CF-Connecting-IP' => '203.0.113.9'])->assertOk();
    expect(RateLimiter::attempts('login-link:ip:203.0.113.9'))->toBe(1)
        ->and(RateLimiter::attempts('login-link:ip:127.0.0.1'))->toBe(0);
});

it('refuses a sign-in link redeemed from another site: no signing a visitor in to someone else\'s account', function () {
    askLink('coach.a@example.com');
    $token = tokenMailed('coach.a@example.com');
    $this->postJson('/api/login/link', ['t' => $token], ['Origin' => 'https://evil.example'])->assertStatus(403);
    $this->call('POST', '/api/login/link', [], [], [], ['HTTP_SEC_FETCH_SITE' => 'cross-site', 'CONTENT_TYPE' => 'text/plain'], json_encode(['t' => $token]))->assertStatus(403);
    // Asking for a link stays open to the phone app's WebView, whose origin is not the site's.
    $this->postJson('/api/login/email', ['email' => 'coach.a@example.com'], ['Origin' => 'capacitor://localhost'])->assertOk();
    redeemLink($token)->assertOk();
});

it('caps the audit rows a flood of throttled requests can write', function () {
    foreach (range(1, 40) as $i) {
        askLink('coach.a@example.com');
    }
    expect(DB::table('audit_events')->where('ev', 'login.link.throttled')->count())->toBe(20);
});

it('limits a caller that varies the forwarded address, by the connection itself', function () {
    // A new forwarded address each time (its own 10-an-hour bucket never fills), a new email each
    // time: only the connection's own bucket holds, at 300.
    foreach (range(1, 300) as $i) {
        $this->postJson('/api/login/email', ['email' => "x{$i}@example.com"], ['CF-Connecting-IP' => '198.51.100.'.($i % 250)]);
    }
    expect(RateLimiter::attempts('login-link:peer:127.0.0.1'))->toBe(300);
    $this->postJson('/api/login/email', ['email' => 'coach.a@example.com'], ['CF-Connecting-IP' => '203.0.113.77'])->assertOk();
    Mail::assertNothingSent();
    $this->assertDatabaseHas('audit_events', ['ev' => 'login.link.throttled']);
});

it('keeps on the link row only as much of the address as AUDIT_IP allows', function (string $mode, ?string $stored) {
    config(['fitpal.audit.ip' => $mode]);
    askLink('coach.a@example.com');
    expect(LoginLink::query()->sole()->ip)->toBe($stored);
})->with([
    'off' => ['off', null],
    'net' => ['net', '127.0.0.0/24'],
    'full' => ['full', '127.0.0.1'],
]);

it('tells the second of two accounts confirming one address at once that it is taken, not a server error', function () {
    $f = $this->f;
    $this->postJson('/api/account/email', ['email' => 'shared@example.com'], freshBearer($f->a))->assertOk();
    $token = tokenMailed('shared@example.com', 'confirm');
    // The other account's confirmation commits between this one's check and its write.
    $raced = false;
    DB::connection()->beforeExecuting(function (string $sql) use (&$raced, $f) {
        if (! $raced && str_starts_with($sql, 'update "users" set "email"')) {
            $raced = true;
            DB::table('users')->where('id', $f->b->id)->update(['email' => 'shared@example.com']);
        }
    });
    redeemLink($token)->assertStatus(409)->assertExactJson(['error' => 'that email address is already used by another account']);
    expect($raced)->toBeTrue()->and($f->a->fresh()->email)->toBe('coach.a@example.com');
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

it('tells the caller their own sign-in address and whether it is confirmed, through each stage', function () {
    $f = $this->f;
    $account = fn (User $who) => $this->getJson('/api/account', bearer($who));
    // An older account: the address was set by hand and never confirmed by a link.
    $account($f->a)->assertOk()->assertExactJson(['email' => 'coach.a@example.com', 'pendingEmail' => null, 'verified' => false]);
    // A change asked for: still the old address until the link is opened.
    $this->postJson('/api/account/email', ['email' => 'new.a@example.com'], freshBearer($f->a))->assertOk();
    $account($f->a)->assertExactJson(['email' => 'coach.a@example.com', 'pendingEmail' => 'new.a@example.com', 'verified' => false]);
    redeemLink(tokenMailed('new.a@example.com', 'confirm'))->assertOk();
    $account($f->a)->assertExactJson(['email' => 'new.a@example.com', 'pendingEmail' => null, 'verified' => true]);
    // No address at all (a client, or a coach from before R4).
    $account($f->a1)->assertExactJson(['email' => null, 'pendingEmail' => null, 'verified' => false]);
    $this->getJson('/api/account')->assertStatus(401);
});
