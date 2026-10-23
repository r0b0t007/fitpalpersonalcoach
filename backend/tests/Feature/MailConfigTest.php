<?php

// Mail through Resend (CHW-271): the transport the live instance uses can be built at all — it
// needs resend/resend-php, which Laravel names but does not ship — and fitpal:check-config says
// when the mail setup would quietly send nothing.

use App\Console\Commands\CheckConfig;
use Illuminate\Mail\Transport\ResendTransport;
use Illuminate\Support\Facades\Mail;

it('builds the Resend transport', function () {
    config(['mail.default' => 'resend', 'services.resend.key' => 're_test_not_a_real_key']);
    expect(Mail::mailer('resend')->getSymfonyTransport())->toBeInstanceOf(ResendTransport::class);
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

it('lets the log mailer be on a laptop, and not on a live instance', function () {
    config(['mail.default' => 'log']);
    expect(CheckConfig::mailProblems())->toBe([]);
    app()->detectEnvironment(fn () => 'production');
    expect(CheckConfig::mailProblems())->toHaveCount(1)
        ->and(CheckConfig::mailProblems()[0])->toContain('MAIL_MAILER is log');
});
