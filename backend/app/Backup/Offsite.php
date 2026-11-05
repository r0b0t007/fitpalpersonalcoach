<?php

namespace App\Backup;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use InvalidArgumentException;

/**
 * The nightly dump's copy off the hosting account (CHW-361, the DPIA's M2): encrypted to the owner's
 * age key (Age), then one PUT into a Cloudflare R2 bucket in the EU jurisdiction. The bucket keeps
 * it: a lifecycle rule deletes copies after 14 days, and a bucket lock refuses any delete or
 * overwrite before then. R2 has no write-only token, so the server's (Object Read & Write, this
 * bucket only) could delete: the lock is what stops someone holding it from destroying the copies
 * already there. Nothing here can see the lock (reading it takes an admin token); the runbook
 * (docs/DEPLOY_COACH_SUBDOMAIN.md, Backups) sets it up.
 *
 * R2 speaks the S3 API; the one request is signed here (AWS Signature Version 4, region `auto`)
 * rather than through the AWS SDK, a dependency far larger than the job.
 */
final class Offsite
{
    /** Everything config('fitpal.backup') needs; what the nightly copy waits for is listed by problems(). */
    private const SETTINGS = [
        'recipient' => 'BACKUP_AGE_RECIPIENT',
        'endpoint' => 'BACKUP_R2_ENDPOINT',
        'bucket' => 'BACKUP_R2_BUCKET',
        'key_id' => 'BACKUP_R2_ACCESS_KEY_ID',
        'secret' => 'BACKUP_R2_SECRET_ACCESS_KEY',
    ];

    /** Whether any of it is set: an instance that set none has chosen no copy (or not yet). */
    public static function attempted(): bool
    {
        foreach (array_keys(self::SETTINGS) as $k) {
            if ((string) config("fitpal.backup.$k") !== '') {
                return true;
            }
        }

        return false;
    }

    /**
     * What stops a copy leaving the server; empty when nothing does.
     *
     * @return list<string>
     */
    public static function problems(): array
    {
        $out = [];
        $missing = array_values(array_filter(self::SETTINGS, fn ($k) => (string) config("fitpal.backup.$k") === '', ARRAY_FILTER_USE_KEY));
        if ($missing !== []) {
            $out[] = 'the nightly backup is not copied off the server: set '.implode(', ', $missing).' (docs/DEPLOY_COACH_SUBDOMAIN.md, Backups).';
        }
        if (! extension_loaded('sodium')) {
            $out[] = "PHP's sodium extension is not loaded, and the nightly backup is encrypted with it: enable it for this PHP version (cPanel, Select PHP Version → Extensions).";
        }
        if (($why = self::recipientProblem()) !== null) {
            $out[] = $why;
        }
        $endpoint = (string) config('fitpal.backup.endpoint');
        $parts = parse_url($endpoint) ?: [];
        // No port either: the signature covers the host as written here, and an explicit port would
        // go out in the Host header beside it.
        if ($endpoint !== '' && (($parts['scheme'] ?? '') !== 'https' || ($parts['host'] ?? '') === '' || isset($parts['port']) || ($parts['path'] ?? '') !== '' || isset($parts['query']))) {
            $out[] = "BACKUP_R2_ENDPOINT ($endpoint) is not the bucket's S3 address: https://<account id>.eu.r2.cloudflarestorage.com, with no bucket, path or port after it (the dashboard shows it with the bucket on the end).";
        }

        return $out;
    }

    /** Whether the dump can be encrypted: a valid recipient, and sodium to do it with. The upload may still be unready. */
    public static function recipientUsable(): bool
    {
        return (string) config('fitpal.backup.recipient') !== '' && extension_loaded('sodium') && self::recipientProblem() === null;
    }

    /** What is wrong with BACKUP_AGE_RECIPIENT, when it is set and wrong. */
    private static function recipientProblem(): ?string
    {
        $recipient = (string) config('fitpal.backup.recipient');
        if (stripos($recipient, 'AGE-SECRET-KEY-') === 0) {
            return 'BACKUP_AGE_RECIPIENT holds a PRIVATE key (AGE-SECRET-KEY-…). Remove it from this server now: the server needs only the public age1… line age-keygen printed, and the private key stays with the owner.';
        }
        if ($recipient === '' || ! extension_loaded('sodium')) {
            return null;
        }
        try {
            Age::recipientKey($recipient);
        } catch (InvalidArgumentException $e) {
            return "BACKUP_AGE_RECIPIENT is {$e->getMessage()}: copy the whole age1… line, nothing else.";
        }

        return null;
    }

    /** Puts $body at $key in the bucket. Null when R2 stored it, otherwise why not. */
    public static function put(string $key, string $body): ?string
    {
        $c = (array) config('fitpal.backup');
        $path = '/'.rawurlencode((string) $c['bucket']).'/'.implode('/', array_map('rawurlencode', explode('/', $key)));
        $hash = hash('sha256', $body);
        $headers = [
            'host' => (string) parse_url((string) $c['endpoint'], PHP_URL_HOST),
            'x-amz-content-sha256' => $hash,
            'x-amz-date' => now()->utc()->format('Ymd\THis\Z'),
        ];
        $auth = self::sign('PUT', $path, $headers, (string) $c['key_id'], (string) $c['secret'], 'auto');
        try {
            $res = Http::withHeaders(['Authorization' => $auth, 'x-amz-content-sha256' => $hash, 'x-amz-date' => $headers['x-amz-date']])
                ->withBody($body, 'application/octet-stream')
                ->connectTimeout(15)->timeout(120)
                ->put($c['endpoint'].$path);
        } catch (ConnectionException $e) {
            return 'could not reach R2: '.$e->getMessage();
        }
        if ($res->successful()) {
            return null;
        }
        // S3 errors are XML: <Error><Code>AccessDenied</Code><Message>…</Message></Error>
        preg_match('#<Code>(.*?)</Code>#s', $res->body(), $code);
        preg_match('#<Message>(.*?)</Message>#s', $res->body(), $message);

        return 'R2 refused the copy (HTTP '.$res->status().(isset($code[1]) ? ", {$code[1]}" : '').(isset($message[1]) ? ": {$message[1]}" : '').')';
    }

    /**
     * The Authorization header of an AWS Signature Version 4 request to the S3 API, for a request
     * with no query string. $headers are the signed ones, lower-case names, with `host`,
     * `x-amz-date` and `x-amz-content-sha256` (the hex SHA-256 of the body) among them.
     *
     * @param  array<string, string>  $headers
     */
    public static function sign(string $method, string $path, array $headers, string $keyId, string $secret, string $region): string
    {
        ksort($headers);
        $canonical = implode('', array_map(fn ($k, $v) => $k.':'.trim($v)."\n", array_keys($headers), $headers));
        $signed = implode(';', array_keys($headers));
        $request = "$method\n$path\n\n$canonical\n$signed\n".$headers['x-amz-content-sha256'];
        $date = substr($headers['x-amz-date'], 0, 8);
        $scope = "$date/$region/s3/aws4_request";
        $toSign = "AWS4-HMAC-SHA256\n{$headers['x-amz-date']}\n$scope\n".hash('sha256', $request);
        $key = 'AWS4'.$secret;
        foreach ([$date, $region, 's3', 'aws4_request'] as $part) {
            $key = hash_hmac('sha256', $part, $key, true);
        }

        return "AWS4-HMAC-SHA256 Credential=$keyId/$scope, SignedHeaders=$signed, Signature=".hash_hmac('sha256', $toSign, $key);
    }
}
