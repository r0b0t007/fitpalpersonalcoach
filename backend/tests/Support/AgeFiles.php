<?php

namespace Tests\Support;

use App\Backup\Age;

/**
 * The other half of App\Backup\Age, for tests only: keys, and a decrypter. The server never
 * decrypts (the private key stays with the owner), so this lives here; AgeTest checks it against
 * the C2SP vectors before anything leans on it.
 */
final class AgeFiles
{
    /** A C2SP vector (tests/fixtures/age): its `key: value` lines, and the age file after the blank line. */
    public static function vector(string $name): array
    {
        [$meta, $file] = explode("\n\n", (string) file_get_contents(base_path("tests/fixtures/age/$name")), 2);
        $fields = [];
        foreach (explode("\n", $meta) as $line) {
            [$k, $v] = explode(': ', $line, 2);
            $fields[$k] = $v;
        }

        return [$fields, $file];
    }

    /** The X25519 secret in an AGE-SECRET-KEY-1… identity. */
    public static function secret(string $identity): string
    {
        [$hrp, $secret] = Age::bech32($identity);
        if ($hrp !== 'age-secret-key-') {
            throw new \InvalidArgumentException("not an identity: $hrp");
        }

        return $secret;
    }

    /** An age1… recipient for a 32-byte public key. */
    public static function recipient(string $publicKey): string
    {
        return self::bech32('age', $publicKey);
    }

    /** A fresh key pair: [the X25519 secret, its age1… recipient]. */
    public static function keyPair(): array
    {
        $secret = random_bytes(32);

        return [$secret, self::recipient(sodium_crypto_scalarmult_base($secret))];
    }

    /**
     * Decrypts an age file with one X25519 identity, as age -d does: find the stanza that unwraps,
     * check the header MAC, then the STREAM chunks, the last one flagged. Null wherever age refuses.
     *
     * @return array{plain: string, fileKey: string, header: string, mac: string, nonce: string, payload: string}|null
     */
    public static function decrypt(string $file, string $secret): ?array
    {
        $end = strpos($file, "\n--- ");
        if (! str_starts_with($file, "age-encryption.org/v1\n") || $end === false) {
            return null;
        }
        $header = substr($file, 0, $end + 4);
        $macEnd = strpos($file, "\n", $end + 5);
        $mac = base64_decode(substr($file, $end + 5, $macEnd - $end - 5));
        $rest = substr($file, $macEnd + 1);
        $mine = sodium_crypto_scalarmult_base($secret);
        $fileKey = null;
        // Stanzas: an argument line, then body lines up to the first shorter than 64 columns.
        $lines = explode("\n", substr($header, strlen("age-encryption.org/v1\n"), -4));
        for ($i = 0; $i < count($lines) - 1; $i++) {
            if (! str_starts_with($lines[$i], '-> ')) {
                continue;
            }
            $args = explode(' ', substr($lines[$i], 3));
            $body = '';
            while (++$i < count($lines)) {
                $body .= $lines[$i];
                if (strlen($lines[$i]) < 64) {
                    break;
                }
            }
            if ($args[0] !== 'X25519' || count($args) !== 2) {
                continue;
            }
            $share = base64_decode($args[1]);
            $shared = sodium_crypto_scalarmult($secret, $share);
            $wrap = hash_hkdf('sha256', $shared, 32, 'age-encryption.org/v1/X25519', $share.$mine);
            $key = sodium_crypto_aead_chacha20poly1305_ietf_decrypt(base64_decode($body), '', str_repeat("\0", 12), $wrap);
            if ($key !== false) {
                $fileKey = $key;
                break;
            }
        }
        if ($fileKey === null || ! hash_equals(Age::mac($fileKey, $header), $mac)) {
            return null;
        }
        $nonce = substr($rest, 0, 16);
        $key = hash_hkdf('sha256', $fileKey, 32, 'payload', $nonce);
        $chunks = str_split(substr($rest, 16), 65536 + 16);
        $plain = '';
        foreach ($chunks as $n => $chunk) {
            $last = $n === count($chunks) - 1 ? "\1" : "\0";
            $part = sodium_crypto_aead_chacha20poly1305_ietf_decrypt($chunk, '', "\0\0\0".pack('J', $n).$last, $key);
            if ($part === false) {
                return null;
            }
            $plain .= $part;
        }

        return ['plain' => $plain, 'fileKey' => $fileKey, 'header' => $header, 'mac' => $mac, 'nonce' => $nonce, 'payload' => $rest];
    }

    /** Bech32 (BIP173) encoding, the inverse of Age::bech32. */
    public static function bech32(string $hrp, string $bytes, bool $upper = false): string
    {
        $charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
        $data = [];
        $acc = 0;
        $bits = 0;
        foreach (str_split($bytes) as $b) {
            $acc = (($acc << 8) | ord($b)) & 0xFFF;
            $bits += 8;
            while ($bits >= 5) {
                $bits -= 5;
                $data[] = ($acc >> $bits) & 31;
            }
        }
        if ($bits > 0) {
            $data[] = ($acc << (5 - $bits)) & 31;
        }
        $values = [...array_map(fn ($c) => ord($c) >> 5, str_split($hrp)), 0, ...array_map(fn ($c) => ord($c) & 31, str_split($hrp)), ...$data, 0, 0, 0, 0, 0, 0];
        $gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3];
        $chk = 1;
        foreach ($values as $v) {
            $top = $chk >> 25;
            $chk = (($chk & 0x1FFFFFF) << 5) ^ $v;
            for ($i = 0; $i < 5; $i++) {
                $chk ^= (($top >> $i) & 1) ? $gen[$i] : 0;
            }
        }
        $chk ^= 1;
        for ($i = 0; $i < 6; $i++) {
            $data[] = ($chk >> (5 * (5 - $i))) & 31;
        }
        $s = $hrp.'1'.implode('', array_map(fn ($v) => $charset[$v], $data));

        return $upper ? strtoupper($s) : $s;
    }
}
