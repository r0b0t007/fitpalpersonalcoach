<?php

// Mail through Resend (CHW-271): the transport the live instance uses can be built at all — it
// needs resend/resend-php, which Laravel names but does not ship — and fitpal:check-config says
// when the mail setup would quietly send nothing.

use App\Console\Commands\CheckConfig;
use App\Mail\ResendMailer;
use GuzzleHttp\Client;
use Illuminate\Mail\Transport\ResendTransport;
use Illuminate\Support\Facades\Mail;

/** The Guzzle client inside a Resend transport, through the SDK's private properties. */
function resendHttp(ResendTransport $transport): Client
{
    $get = fn (object $o, string $prop) => (new ReflectionProperty($o, $prop))->getValue($o);

    return $get($get($get($transport, 'resend'), 'transporter'), 'client');
}

it('builds the Resend transport, with time limits the SDK does not set', function () {
    config(['mail.default' => 'resend', 'services.resend.key' => 're_test_not_a_real_key']);
    $transport = Mail::mailer('resend')->getSymfonyTransport();
    expect($transport)->toBeInstanceOf(ResendTransport::class);

    // A stalled call to Resend must not hold a PHP worker for good.
    $http = resendHttp($transport);
    expect($http->getConfig('connect_timeout'))->toBe(ResendMailer::CONNECT_TIMEOUT)
        ->and($http->getConfig('timeout'))->toBe(ResendMailer::TIMEOUT);
});

it('says nothing about mail that is set up', function () {
    config(['mail.default' => 'resend', 'services.resend.key' => 're_test_not_a_real_key', 'mail.from.address' => 'no-reply@fitpal.ma']);
    expect(CheckConfig::mailProblems())->toBe([]);
});

it('names a Resend mailer with no key, and the example sender left in place', function () {
    config(['mail.default' => 'resend', 'services.resend.key' => '', 'mail.from.address' => 'hello@example.com']);
    $problems = CheckConfig::mailProblems();
    expect($problems)->toHaveCount(2)
        ->and($problems[0])->toContain('RESEND_API_KEY')
        ->and($problems[1])->toContain('MAIL_FROM_ADDRESS');
});

it('names a mailer config/mail.php does not define', function () {
    config(['mail.default' => 'Resend', 'services.resend.key' => 're_test_not_a_real_key', 'mail.from.address' => 'no-reply@fitpal.ma']);
    expect(CheckConfig::mailProblems())->toHaveCount(1)
        ->and(CheckConfig::mailProblems()[0])->toContain('does not define');
});

it('looks inside a failover mailer, and takes a key set on the mailer itself', function () {
    config(['mail.default' => 'failover', 'mail.mailers.failover.mailers' => ['resend', 'log'],
        'services.resend.key' => '', 'mail.from.address' => 'no-reply@fitpal.ma']);
    expect(CheckConfig::mailProblems())->toHaveCount(1)
        ->and(CheckConfig::mailProblems()[0])->toContain('RESEND_API_KEY');

    config(['mail.mailers.resend.key' => 're_test_not_a_real_key']);
    expect(CheckConfig::mailProblems())->toBe([]);
});

it('reads the placeholder sender in any case, and says when there is none', function () {
    config(['mail.default' => 'resend', 'services.resend.key' => 're_test_not_a_real_key', 'mail.from.address' => 'hello@Example.COM']);
    expect(CheckConfig::mailProblems())->toHaveCount(1);
    config(['mail.from.address' => '']);
    expect(CheckConfig::mailProblems()[0])->toContain('(empty)');
});

it('leaves a local mail catcher with the placeholder sender alone', function () {
    config(['mail.default' => 'smtp', 'mail.from.address' => 'hello@example.com']);
    expect(CheckConfig::mailProblems())->toBe([]);
    app()->detectEnvironment(fn () => 'production');
    expect(CheckConfig::mailProblems())->toHaveCount(1);
});

it('lets the log mailer be on a laptop, and not on a live instance', function () {
    config(['mail.default' => 'log']);
    expect(CheckConfig::mailProblems())->toBe([]);
    app()->detectEnvironment(fn () => 'production');
    expect(CheckConfig::mailProblems())->toHaveCount(1)
        ->and(CheckConfig::mailProblems()[0])->toContain('MAIL_MAILER is log');
});
