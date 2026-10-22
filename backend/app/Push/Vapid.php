<?php

namespace App\Push;

use Minishlink\WebPush\VAPID as Keys;
use RuntimeException;

/**
 * The VAPID key pair that signs every push, and the public half the app subscribes with.
 *
 * VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env when set. Otherwise DATA_DIR/vapid.json, the file
 * the Node API generated on first boot and kept beside its data — the same pair, so every browser
 * that subscribed under Node keeps receiving after the cutover (a push service refuses a message
 * signed with any other key) — and generated there the same way when neither exists, as Node did.
 */
final class Vapid
{
    /** @var array{publicKey: string, privateKey: string}|null */
    private static ?array $keys = null;

    /** @return array{publicKey: string, privateKey: string} */
    public static function keys(): array
    {
        $public = (string) config('fitpal.vapid.public');
        $private = (string) config('fitpal.vapid.private');
        if ($public !== '' && $private !== '') {
            return ['publicKey' => $public, 'privateKey' => $private];
        }
        // Half a pair is a typo, not a choice: handing out some other key would silently strand
        // every browser subscribed under the intended one. fitpal:check-config says so too.
        if ($public !== '' || $private !== '') {
            throw new RuntimeException('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set together');
        }

        return self::$keys ??= self::fromFile();
    }

    /** VAPID_SUBJECT, else the origin when it is https, else Node's mailto:admin@localhost. */
    public static function subject(): string
    {
        $subject = (string) config('fitpal.vapid.subject');
        $origin = (string) config('fitpal.origin');

        return $subject !== '' ? $subject : (preg_match('/^https:/i', $origin) ? $origin : 'mailto:admin@localhost');
    }

    /** Tests and a changed DATA_DIR start from the file again. */
    public static function forget(): void
    {
        self::$keys = null;
    }

    /** @return array{publicKey: string, privateKey: string} */
    private static function fromFile(): array
    {
        $dir = (string) config('fitpal.data_dir');
        $file = $dir.DIRECTORY_SEPARATOR.'vapid.json';
        if ($keys = self::read($file)) {
            return $keys;
        }
        if (! is_dir($dir) && ! @mkdir($dir, 0700, true) && ! is_dir($dir)) {
            throw new RuntimeException("cannot create {$dir} for vapid.json");
        }
        // Two first requests at once must not each mint a pair: the one written second would make
        // the first one's subscriptions undeliverable. One writer at a time, and a re-read under it.
        $lock = fopen($file.'.lock', 'c');
        if ($lock === false || ! flock($lock, LOCK_EX)) {
            throw new RuntimeException("cannot lock {$file}");
        }
        try {
            if ($keys = self::read($file)) {
                return $keys;
            }
            $keys = Keys::createVapidKeys();
            // 0600 before the private key is in it, as Node's mode: 0o600: never readable by the
            // other accounts of a shared host, not even for a moment.
            $tmp = $file.'.'.bin2hex(random_bytes(4)).'.tmp';
            $h = @fopen($tmp, 'x');
            $ok = $h !== false && @chmod($tmp, 0600) && fwrite($h, (string) json_encode($keys)) !== false;
            if ($h !== false) {
                fclose($h);
            }
            if (! $ok || ! @rename($tmp, $file)) {
                @unlink($tmp);
                throw new RuntimeException("cannot write {$file}");
            }

            return ['publicKey' => $keys['publicKey'], 'privateKey' => $keys['privateKey']];
        } finally {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
    }

    /** @return array{publicKey: string, privateKey: string}|null */
    private static function read(string $file): ?array
    {
        $raw = @file_get_contents($file);
        $keys = is_string($raw) ? json_decode($raw, true) : null;

        return is_array($keys) && is_string($keys['publicKey'] ?? null) && is_string($keys['privateKey'] ?? null)
            ? ['publicKey' => $keys['publicKey'], 'privateKey' => $keys['privateKey']] : null;
    }
}
