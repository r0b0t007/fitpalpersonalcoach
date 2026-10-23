<?php

namespace App\Mail;

use GuzzleHttp\Client as GuzzleClient;
use Illuminate\Mail\Transport\ResendTransport;
use Resend\Client;
use Resend\Transporters\HttpTransporter;
use Resend\ValueObjects\ApiKey;
use Resend\ValueObjects\Transporter\BaseUri;
use Resend\ValueObjects\Transporter\Headers;

/**
 * Laravel's `resend` transport, built as the SDK builds it (Resend::client) but with time limits.
 * The SDK's Guzzle client has none — Guzzle's default is to wait forever — so one stalled call to
 * Resend would hold a PHP worker until max_execution_time, and on a shared host a few of those use
 * up the account's processes and take the app down with them. A mail that cannot leave in time is
 * logged and dropped (SendAfterResponse); the coach asks for another link.
 */
final class ResendMailer
{
    public const CONNECT_TIMEOUT = 5;

    public const TIMEOUT = 15;

    /** @param array<string, mixed> $config the mailer's entry in config/mail.php */
    public static function transport(array $config): ResendTransport
    {
        $http = new GuzzleClient(['connect_timeout' => self::CONNECT_TIMEOUT, 'timeout' => self::TIMEOUT]);
        $key = (string) ($config['key'] ?? config('services.resend.key'));

        return new ResendTransport(new Client(new HttpTransporter(
            $http,
            BaseUri::from(getenv('RESEND_BASE_URL') ?: 'api.resend.com'),
            Headers::withAuthorization(ApiKey::from($key)),
        )));
    }
}
