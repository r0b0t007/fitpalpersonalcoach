<?php

// Web Push (CHW-260): GET /api/push/public-key, POST /api/push/subscribe, /unsubscribe, /test,
// the push for a program sent, and the guard on where a push may connect (api/server.js 443-562,
// 1386-1430).

use App\Jobs\SendPush;
use App\Models\PushSubscription;
use App\Models\User;
use App\Models\UserState;
use App\Push\Endpoint;
use App\Push\Messages;
use App\Push\Sender;
use App\Push\Vapid;
use GuzzleHttp\Client;
use GuzzleHttp\Exception\ConnectException;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Middleware;
use GuzzleHttp\Psr7\Request;
use GuzzleHttp\Psr7\Response;
use Illuminate\Filesystem\Filesystem;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Testing\TestResponse;
use Tests\Support\Coaching;

beforeEach(function () {
    $this->f = Coaching::twoCoaches();
    $this->dataDir = sys_get_temp_dir().'/fitpal-push-'.bin2hex(random_bytes(4));
    config(['fitpal.data_dir' => $this->dataDir, 'fitpal.vapid.public' => '', 'fitpal.vapid.private' => '']);
    Vapid::forget();
});

afterEach(function () {
    Vapid::forget();
    (new Filesystem)->deleteDirectory($this->dataDir);
});

const SUB = ['endpoint' => 'https://push.example.com/send/abc', 'keys' => [
    // A real browser's P-256 public key and auth secret, as PushSubscription.toJSON() gives them.
    'p256dh' => 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
    'auth' => 'tBHItJI5svbpez7KI4CCXg',
]];

function subscribe(?User $who, mixed $subscription): TestResponse
{
    return test()->postJson('/api/push/subscribe', ['subscription' => $subscription], $who ? bearer($who) : []);
}

function withEndpoint(string $endpoint): array
{
    return ['endpoint' => $endpoint] + SUB;
}

/**
 * A Sender whose transport is scripted and whose DNS answers from $dns (a test has none);
 * $sent collects every request it makes, with its options.
 */
function fakeSender(array $responses, array &$sent, array $dns = [], float $dnsBudget = Sender::DNS_BUDGET): Sender
{
    $stack = HandlerStack::create(new MockHandler($responses));
    $stack->push(Middleware::history($sent));
    $sender = new class($stack, $dns, $dnsBudget) extends Sender
    {
        public array $lookups = [];

        public function __construct(HandlerStack $stack, private array $dns, float $dnsBudget)
        {
            parent::__construct($stack);
            $this->dnsBudget = $dnsBudget;
        }

        protected function addresses(string $host): array
        {
            $this->lookups[] = $host;

            return $this->dns[$host] ?? ['93.184.215.14'];
        }
    };
    app()->instance(Sender::class, $sender);

    return $sender;
}

it('hands out one key, the one Node minted in DATA_DIR/vapid.json — or mints it there', function () {
    $key = $this->getJson('/api/push/public-key')->assertOk()->json('key');
    expect($key)->toMatch('/^[A-Za-z0-9_-]{87}$/')
        ->and(json_decode(file_get_contents($this->dataDir.'/vapid.json'), true)['publicKey'])->toBe($key);
    Vapid::forget();
    $this->getJson('/api/push/public-key')->assertExactJson(['key' => $key]);
    // Node's file, as Node wrote it, is the one used.
    file_put_contents($this->dataDir.'/vapid.json', json_encode(['publicKey' => 'nodePublic', 'privateKey' => 'nodePrivate']));
    Vapid::forget();
    $this->getJson('/api/push/public-key')->assertExactJson(['key' => 'nodePublic']);
    // .env wins over the file.
    config(['fitpal.vapid.public' => 'envPublic', 'fitpal.vapid.private' => 'envPrivate']);
    $this->getJson('/api/push/public-key')->assertExactJson(['key' => 'envPublic']);
});

it('refuses a subscription in Node\'s words', function () {
    $a1 = $this->f->a1;
    subscribe(null, SUB)->assertStatus(401)->assertExactJson(['error' => 'not signed in']);
    foreach ([null, [], 'https://push.example.com', ['endpoint' => SUB['endpoint']], ['endpoint' => SUB['endpoint'], 'keys' => ['p256dh' => 'x']],
        ['endpoint' => '', 'keys' => SUB['keys']], [SUB]] as $bad) {
        subscribe($a1, $bad)->assertStatus(400)->assertExactJson(['error' => 'invalid subscription']);
    }
    $refusals = [
        'not a url' => 'endpoint is not a valid URL',
        'https://' => 'endpoint is not a valid URL',
        'http://push.example.com/x' => 'endpoint must be an https:// URL',
        'mailto:a@b.c' => 'endpoint must be an https:// URL',
        'https://u:p@push.example.com/x' => 'endpoint must not carry credentials',
        'https://127.0.0.1/x' => 'endpoint must not point at a private address',
        'https://10.1.2.3/x' => 'endpoint must not point at a private address',
        'https://169.254.169.254/latest' => 'endpoint must not point at a private address',
        'https://2130706433/x' => 'endpoint must not point at a private address',
        'https://0x7f.1/x' => 'endpoint must not point at a private address',
        'https://017700000001/x' => 'endpoint must not point at a private address',
        'https://[::1]/x' => 'endpoint must not point at a private address',
        'https://[0:0:0:0:0:0:0:1]/x' => 'endpoint must not point at a private address',
        'https://[fd00::1]/x' => 'endpoint must not point at a private address',
        'https://[::ffff:10.0.0.1]/x' => 'endpoint must not point at a private address',
        'HTTPS://LOCALHOST.:8443/x' => null,   // a name: the guard judges it when it connects
        'https://8.8.8.8/x' => null,
    ];
    foreach ($refusals as $endpoint => $error) {
        $r = subscribe($a1, withEndpoint($endpoint));
        $error === null ? $r->assertOk() : $r->assertStatus(400)->assertExactJson(['error' => $error]);
    }
    expect(PushSubscription::query()->count())->toBe(2);
});

it('keeps one row per browser, moves it between accounts, and holds each account to 20', function () {
    $f = $this->f;
    subscribe($f->a1, SUB + ['extra' => 'ignored'])->assertOk()->assertExactJson(['ok' => true]);
    $row = PushSubscription::query()->sole();
    expect($row->only(['user_id', 'endpoint', 'p256dh', 'auth']))->toBe(['user_id' => $f->a1->id, 'endpoint' => SUB['endpoint']] + SUB['keys']);
    // The same browser, now signed in as someone else: the subscription follows them.
    subscribe($f->a2, SUB)->assertOk();
    expect(PushSubscription::query()->pluck('user_id')->all())->toBe([$f->a2->id]);
    foreach (range(1, 22) as $i) {
        subscribe($f->a1, withEndpoint("https://push.example.com/$i"))->assertOk();
    }
    expect(PushSubscription::of($f->a1->id)->pluck('endpoint')->all())->toBe(array_map(fn ($i) => "https://push.example.com/$i", range(3, 22)));
    // Unsubscribing names an exact endpoint, and only the caller's own.
    $this->postJson('/api/push/unsubscribe', ['endpoint' => SUB['endpoint']], bearer($f->a1))->assertExactJson(['ok' => true]);
    $this->postJson('/api/push/unsubscribe', ['endpoint' => [SUB['endpoint']]], bearer($f->a2))->assertExactJson(['ok' => true]);
    expect(PushSubscription::of($f->a2->id)->count())->toBe(1);
    $this->postJson('/api/push/unsubscribe', ['endpoint' => SUB['endpoint']], bearer($f->a2))->assertOk();
    expect(PushSubscription::of($f->a2->id)->count())->toBe(0);
});

it('sends a test push to every browser, signed and encrypted, and forgets the ones that are gone', function () {
    $a1 = $this->f->a1;
    subscribe($a1, SUB)->assertOk();
    subscribe($a1, withEndpoint('https://push.example.com/gone'))->assertOk();
    subscribe($a1, withEndpoint('https://push.example.com/broken'))->assertOk();
    $sent = [];
    fakeSender([new Response(201), new Response(410), new Response(500)], $sent);
    $this->postJson('/api/push/test', [], bearer($a1))->assertExactJson(['ok' => true]);
    expect($sent)->toHaveCount(3);
    $req = $sent[0]['request'];
    expect((string) $req->getUri())->toBe(SUB['endpoint'])
        ->and($req->getMethod())->toBe('POST')
        ->and($req->getHeaderLine('Urgency'))->toBe('high')
        ->and($req->getHeaderLine('TTL'))->toBe('2419200')
        ->and($req->getHeaderLine('Content-Encoding'))->toBe('aes128gcm')
        ->and($req->getHeaderLine('Authorization'))->toStartWith('vapid t=')
        ->and((string) $req->getBody())->not->toContain('Test notification')   // encrypted
        // Pinned to the address vetted here: curl never resolves the name itself.
        ->and($sent[0]['options']['curl'][CURLOPT_RESOLVE])->toBe(['push.example.com:443:93.184.215.14'])
        ->and($sent[0]['options']['protocols'])->toBe(['https'])
        ->and($sent[0]['options']['proxy'])->toBe(['no' => ['*']])
        ->and($sent[0]['options']['allow_redirects'])->toBeFalse();
    // 410: that browser unsubscribed; 500: a bad moment, kept.
    expect(PushSubscription::of($a1->id)->pluck('endpoint')->all())->toBe([SUB['endpoint'], 'https://push.example.com/broken']);
    // Nobody subscribed: nothing sent, still ok.
    $sent = [];
    fakeSender([], $sent);
    $this->postJson('/api/push/test', [], bearer($this->f->a2))->assertExactJson(['ok' => true]);
    expect($sent)->toBe([]);
    $this->postJson('/api/push/test')->assertStatus(401);
});

it('tells each member of a program sent, in their own language, through the queue', function () {
    $f = $this->f;
    Queue::fake();
    $this->postJson('/api/coach/assign', ['memberIds' => [$f->a1->id, $f->a2->id], 'bundle' => ['opengym_plan' => 1, 'name' => 'Block A', 'week' => ['1' => ['r1']], 'routines' => [['id' => 'r1', 'name' => 'Push', 'ex' => [['id' => '0025', 'sets' => 3]]]], 'customEx' => []], 'note' => ''], bearer($f->a))->assertOk();
    Queue::assertPushed(SendPush::class, 2);
    Queue::assertPushed(SendPush::class, fn (SendPush $j) => $j->userId === $f->a1->id && $j->kind === 'assignment' && $j->args === ['Coach A']);

    // The job: the member's language, read from their state when it runs.
    $sent = [];
    $spy = new class extends Sender
    {
        public array $sent = [];

        public function send(string $userId, array $payload): void
        {
            $this->sent[] = [$userId, $payload];
        }
    };
    (new UserState)->forceFill(['user_id' => $f->a1->id, 'state' => json_encode(['lang' => 'fr'])])->save();
    subscribe($f->a1, SUB)->assertOk();
    (new SendPush($f->a1->id, 'assignment', ['Coach A']))->handle($spy);
    (new SendPush($f->a2->id, 'assignment', ['Coach A']))->handle($spy);   // no browser: nothing
    expect($spy->sent)->toBe([[$f->a1->id, ['title' => 'FitPal Coach', 'body' => 'Coach A vous a envoyé un programme', 'tag' => 'assignment']]]);
});

it('says in the admin list who can be reached by push', function () {
    subscribe($this->f->a1, SUB)->assertOk();
    $users = collect($this->getJson('/api/admin/users', bearer($this->f->admin))->assertOk()->json('users'))->keyBy('id');
    expect($users[$this->f->a1->id]['hasPush'])->toBeTrue()->and($users[$this->f->a2->id]['hasPush'])->toBeFalse();
});

it('words every push as api/push-messages.js does, in every language', function () {
    $node = trim((string) shell_exec('node --version'));
    if (! str_starts_with($node, 'v')) {
        $this->markTestSkipped('node is not on the PATH');
    }
    $file = realpath(base_path('../api/push-messages.js'));
    // A script file, not `node -e`: no shell quoting to get wrong on either OS.
    $script = $this->dataDir.'/copy.cjs';
    @mkdir($this->dataDir, 0777, true);
    file_put_contents($script, 'import(require("url").pathToFileURL(process.argv[2]).href).then(m => process.stdout.write(JSON.stringify(m.COPY)))');
    $copy = json_decode((string) shell_exec('node '.escapeshellarg($script).' '.escapeshellarg($file)), true);
    expect(Messages::COPY)->toBe($copy);
    // The builders, against Node's: the fallback per key, the routine title, the coach's name.
    expect(Messages::restTimer('xx'))->toBe(['title' => 'Rest over 💪', 'body' => 'Time for your next set.', 'tag' => 'rest-timer'])
        ->and(Messages::dayReminder('de', (object) ['name' => 'Push', 'emoji' => '']))->toMatchArray(['title' => '🏋️ Push heute'])
        ->and(Messages::dayReminder('es', null)['title'])->toBe('Entrenamiento previsto para hoy')
        ->and(Messages::assignment(['fr'], '$0 {0}', 'App')['body'])->toBe('$0 {0} sent you a program')
        ->and(Messages::test('es', 'App'))->toBe(['title' => 'App', 'body' => 'Notificación de prueba ✅ — así se ven los avisos.', 'tag' => 'test']);
});

it('never connects a push to a private address, whatever the name resolves to', function () {
    $a1 = $this->f->a1;
    // Names pass the subscribe check; where they lead is judged when the push is sent.
    foreach (['https://rebind.example/x', 'https://mixed.example/x', 'https://nowhere.example/x', 'https://v6.example:8443/x'] as $e) {
        subscribe($a1, withEndpoint($e))->assertOk();
    }
    $sent = [];
    fakeSender([new Response(201)], $sent, [
        'rebind.example' => ['10.0.0.7'],
        'mixed.example' => ['93.184.215.14', '127.0.0.1'],   // one private address is enough
        'nowhere.example' => [],
        'v6.example' => ['2606:2800:220:1::1'],
    ])->send($a1->id, Messages::test(null, 'App'));
    expect($sent)->toHaveCount(1)
        ->and($sent[0]['options']['curl'][CURLOPT_RESOLVE])->toBe(['v6.example:8443:[2606:2800:220:1::1]'])
        ->and(PushSubscription::of($a1->id)->count())->toBe(4);   // refused here, not gone there

    // For real: a name that resolves to loopback, and a listener there that is never connected to.
    $server = stream_socket_server('tcp://127.0.0.1:0');
    $port = (int) substr(strrchr(stream_socket_get_name($server, false), ':'), 1);
    PushSubscription::query()->delete();
    subscribe($a1, withEndpoint("https://localhost:$port/x"))->assertOk();
    (new Sender)->send($a1->id, Messages::test(null, 'App'));
    expect(@stream_socket_accept($server, 1))->toBeFalse();

    expect(Endpoint::isPrivateAddr('100.64.0.1'))->toBeTrue()
        ->and(Endpoint::isPrivateAddr('100.128.0.1'))->toBeFalse()
        ->and(Endpoint::isPrivateAddr('::ffff:192.168.1.1'))->toBeTrue()
        ->and(Endpoint::isPrivateAddr('fe80::1'))->toBeTrue()
        ->and(Endpoint::isPrivateAddr('2a00:1450::1'))->toBeFalse();
});

it('connects to no private address however it is spelled, even on a row the subscribe check never saw', function () {
    $a1 = $this->f->a1;
    // As an import of Node's rows would bring them: Node let [::ffff:a00:1] through.
    foreach (['https://[::ffff:a00:1]/x', 'https://[0:0:0:0:0:0:0:1]/x', 'https://[::ffff:7f00:1]:8443/x'] as $i => $e) {
        (new PushSubscription)->forceFill(['user_id' => $a1->id, 'endpoint' => $e, 'endpoint_hash' => PushSubscription::hashOf($e),
            'p256dh' => SUB['keys']['p256dh'], 'auth' => SUB['keys']['auth'], 'created' => 'x'])->save();
    }
    $sent = [];
    fakeSender([], $sent)->send($a1->id, Messages::test(null, 'App'));
    expect($sent)->toBe([])
        ->and(Endpoint::isPrivateAddr('::ffff:a00:1'))->toBeTrue()
        ->and(Endpoint::isPrivateAddr('[::1]'))->toBeTrue();
});

it('signs for the push service own origin: scheme and host as `new URL` writes them', function () {
    $a1 = $this->f->a1;
    subscribe($a1, withEndpoint('HTTPS://Push.Example.COM/Send/AbC'))->assertOk();
    $sent = [];
    fakeSender([new Response(201)], $sent)->send($a1->id, Messages::test(null, 'App'));
    expect((string) $sent[0]['request']->getUri())->toBe('https://push.example.com/Send/AbC')
        ->and($sent[0]['options']['curl'][CURLOPT_RESOLVE])->toBe(['push.example.com:443:93.184.215.14']);
});

it('looks each host up once, and stops looking once the time for it is spent', function () {
    $a1 = $this->f->a1;
    foreach (range(1, 3) as $i) {
        subscribe($a1, withEndpoint("https://push.example.com/$i"))->assertOk();
    }
    $sent = [];
    $sender = fakeSender([new Response(201), new Response(201), new Response(201)], $sent);
    $sender->send($a1->id, Messages::test(null, 'App'));
    expect($sent)->toHaveCount(3)->and($sender->lookups)->toBe(['push.example.com']);
    // No time at all: nothing is looked up, nothing is sent, nothing is dropped.
    $sent = [];
    $sender = fakeSender([], $sent, [], 0.0);
    $sender->send($a1->id, Messages::test(null, 'App'));
    expect($sent)->toBe([])->and($sender->lookups)->toBe([])
        ->and(PushSubscription::of($a1->id)->count())->toBe(3);
});

it('moves a browser two accounts subscribe at the same moment, instead of failing', function () {
    $f = $this->f;
    $raced = false;
    DB::connection()->beforeExecuting(function (string $sql) use (&$raced, $f) {
        if (! $raced && str_starts_with($sql, 'insert into "push_subscriptions"')) {
            $raced = true;   // the other account's insert lands first
            (new PushSubscription)->forceFill(['user_id' => $f->a2->id, 'endpoint' => SUB['endpoint'], 'endpoint_hash' => PushSubscription::hashOf(SUB['endpoint']),
                'p256dh' => 'k', 'auth' => 'a', 'created' => 'x'])->save();
        }
    });
    subscribe($f->a1, SUB)->assertOk();
    expect($raced)->toBeTrue()
        ->and(PushSubscription::query()->pluck('user_id')->all())->toBe([$f->a1->id]);
});

it('refuses half a VAPID pair rather than handing out some other key', function () {
    config(['fitpal.vapid.public' => 'envPublic', 'fitpal.vapid.private' => '']);
    $this->getJson('/api/push/public-key')->assertStatus(500);
    expect(is_file($this->dataDir.'/vapid.json'))->toBeFalse();
    $this->artisan('fitpal:check-config')->expectsOutputToContain('only one of VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY is set')->assertFailed();
});

it('writes a routine with no name as Node did', function () {
    expect(Messages::dayReminder('en', (object) ['emoji' => '💪'])['title'])->toBe('💪 undefined today')
        ->and(Messages::dayReminder('en', (object) ['name' => null])['title'])->toBe('🏋️ null today');
});

it('sends through the real curl handler with these options — what the scripted transport cannot show', function () {
    // The lab trial (2026-10-22): Guzzle refuses CURLOPT_PROTOCOLS in `curl` and every push failed
    // before a byte went out, while every test here passed on a MockHandler that never reads them.
    // A closed local port: the request must get as far as connecting (and be refused there), not
    // be rejected as a request Guzzle will not build.
    $client = new Client(['timeout' => 5, 'connect_timeout' => 5, 'http_errors' => false]);
    $error = null;
    try {
        $client->sendAsync(new Request('POST', 'https://localhost:1/push'), Sender::options(['localhost:1:127.0.0.1']))->wait();
    } catch (Throwable $e) {
        $error = $e;
    }
    expect($error)->toBeInstanceOf(ConnectException::class);
    // And plain http is refused by the protocols option, as the raw curl option did.
    $error = null;
    try {
        $client->sendAsync(new Request('POST', 'http://localhost:1/push'), Sender::options([]))->wait();
    } catch (Throwable $e) {
        $error = $e;
    }
    expect($error)->not->toBeNull()->and($error)->not->toBeInstanceOf(ConnectException::class);
});
