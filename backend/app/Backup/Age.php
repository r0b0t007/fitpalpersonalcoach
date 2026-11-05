<?php

namespace App\Backup;

use InvalidArgumentException;

/**
 * Encryption to an age X25519 recipient (age-encryption.org/v1, https://c2sp.org/age), so the
 * server can encrypt a backup and never read one back: it holds only the owner's public key
 * (`age1…`), and the owner decrypts with the reference tool, `age -d -i key.txt` (CHW-361).
 *
 * Written on PHP's own sodium rather than a program on the host: shared hosting has no age, and
 * nothing here may depend on what the host happens to install. Only the encrypting half is here;
 * decryption is the owner's, on their own machine. tests/Unit/AgeTest.php checks each piece against
 * the C2SP test vectors, and in CI decrypts a file this class wrote with the real age.
 */
final class Age
{
    private const CHUNK = 65536;

    private const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

    /** The whole age file: header, then the payload. */
    public static function encrypt(string $plain, string $recipient): string
    {
        $key = self::recipientKey($recipient);
        $fileKey = random_bytes(16);
        [$share, $body] = self::stanza($key, $fileKey, random_bytes(32));
        $header = "age-encryption.org/v1\n-> X25519 ".self::b64($share)."\n".self::b64($body)."\n---";

        return $header.' '.self::b64(self::mac($fileKey, $header))."\n".self::payload($fileKey, random_bytes(16), $plain);
    }

    /**
     * The X25519 recipient stanza: the ephemeral share, and the file key wrapped for the recipient.
     *
     * @return array{0: string, 1: string}
     */
    public static function stanza(string $recipientKey, string $fileKey, string $ephemeralSecret): array
    {
        $share = sodium_crypto_scalarmult_base($ephemeralSecret);
        $shared = sodium_crypto_scalarmult($ephemeralSecret, $recipientKey);
        $wrap = hash_hkdf('sha256', $shared, 32, 'age-encryption.org/v1/X25519', $share.$recipientKey);

        return [$share, sodium_crypto_aead_chacha20poly1305_ietf_encrypt($fileKey, '', str_repeat("\0", 12), $wrap)];
    }

    /** HMAC-SHA-256 of the header up to and including its `---`, keyed from the file key. */
    public static function mac(string $fileKey, string $header): string
    {
        return hash_hmac('sha256', $header, hash_hkdf('sha256', $fileKey, 32, 'header'), true);
    }

    /**
     * The nonce, then 64 KiB chunks of ChaCha20-Poly1305 (STREAM): each chunk's nonce is an 11-byte
     * big-endian counter and a last byte of 1 on the final chunk. An empty file is one empty final
     * chunk; otherwise no chunk is empty, so a file of an exact multiple of 64 KiB ends on a full one.
     */
    public static function payload(string $fileKey, string $nonce, string $plain): string
    {
        $key = hash_hkdf('sha256', $fileKey, 32, 'payload', $nonce);
        $chunks = $plain === '' ? [''] : str_split($plain, self::CHUNK);
        $out = $nonce;
        foreach ($chunks as $i => $chunk) {
            $last = $i === count($chunks) - 1 ? "\1" : "\0";
            $out .= sodium_crypto_aead_chacha20poly1305_ietf_encrypt($chunk, '', "\0\0\0".pack('J', $i).$last, $key);
        }

        return $out;
    }

    /** The 32-byte public key in an `age1…` recipient. */
    public static function recipientKey(string $recipient): string
    {
        [$hrp, $key] = self::bech32(trim($recipient));
        if ($hrp !== 'age' || strlen($key) !== 32) {
            throw new InvalidArgumentException('not an age X25519 recipient (age1… from age-keygen)');
        }
        // A low-order point decodes fine but gives an all-zero shared secret, which sodium refuses:
        // found here, where check-config reports it, rather than at 03:00 in the middle of a dump.
        try {
            sodium_crypto_scalarmult(random_bytes(32), $key);
        } catch (\SodiumException) {
            throw new InvalidArgumentException('not a key anything can be encrypted to (a low-order point)');
        }

        return $key;
    }

    /**
     * A Bech32 string (BIP173, with no length limit, as age uses it): the human-readable part in
     * lower case, and the data as bytes. Throws on a bad checksum, mixed case or stray padding.
     *
     * @return array{0: string, 1: string}
     */
    public static function bech32(string $s): array
    {
        $lower = strtolower($s);
        $sep = strrpos($lower, '1');
        if (($s !== $lower && $s !== strtoupper($s)) || $sep === false || $sep < 1 || strlen($lower) - $sep < 7) {
            throw new InvalidArgumentException('not a Bech32 string');
        }
        $hrp = substr($lower, 0, $sep);
        $data = [];
        foreach (str_split(substr($lower, $sep + 1)) as $c) {
            $v = strpos(self::CHARSET, $c);
            if ($v === false) {
                throw new InvalidArgumentException('not a Bech32 string');
            }
            $data[] = $v;
        }
        $expand = [];
        foreach (str_split($hrp) as $c) {
            $expand[] = ord($c) >> 5;
        }
        $expand[] = 0;
        foreach (str_split($hrp) as $c) {
            $expand[] = ord($c) & 31;
        }
        if (self::polymod([...$expand, ...$data]) !== 1) {
            throw new InvalidArgumentException('the Bech32 checksum does not match: a character is wrong or missing');
        }
        // 5-bit groups to bytes; what is left over must be under 5 bits, and zero.
        $acc = 0;
        $bits = 0;
        $out = '';
        foreach (array_slice($data, 0, -6) as $v) {
            $acc = (($acc << 5) | $v) & 0xFFF;
            $bits += 5;
            if ($bits >= 8) {
                $bits -= 8;
                $out .= chr(($acc >> $bits) & 0xFF);
            }
        }
        if ($bits >= 5 || ($acc & ((1 << $bits) - 1)) !== 0) {
            throw new InvalidArgumentException('not a Bech32 string');
        }

        return [$hrp, $out];
    }

    /** Standard base64 without padding, as every age header field is written. */
    public static function b64(string $bytes): string
    {
        return rtrim(base64_encode($bytes), '=');
    }

    private static function polymod(array $values): int
    {
        $gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3];
        $chk = 1;
        foreach ($values as $v) {
            $top = $chk >> 25;
            $chk = (($chk & 0x1FFFFFF) << 5) ^ $v;
            for ($i = 0; $i < 5; $i++) {
                if (($top >> $i) & 1) {
                    $chk ^= $gen[$i];
                }
            }
        }

        return $chk;
    }
}
