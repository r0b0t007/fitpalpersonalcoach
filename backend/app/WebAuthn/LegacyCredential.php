<?php

namespace App\WebAuthn;

use App\Models\User;
use InvalidArgumentException;
use Laragear\WebAuthn\ByteBuffer;
use Laragear\WebAuthn\CborDecoder;
use Laragear\WebAuthn\Models\WebAuthnCredential;

/**
 * A passkey the Node API registered, carried over. db.json kept `{id, userId, publicKey, counter,
 * transports}` with the public key as the base64url COSE bytes; the package stores a PEM, so the
 * COSE map is decoded and wrapped in the same SubjectPublicKeyInfo DER the package itself writes
 * at registration. Three key types, because the Node API offered three algorithms (its
 *
 * @simplewebauthn default: EdDSA first, then ES256, then RS256): Ed25519 (OKP), P-256 (EC2) and
 * RSA. Anything else, or a malformed key of those types, is refused so the import lists it as
 * skipped instead of writing a credential that can never verify. The user handle those
 * authenticators hold is the ASCII of the account id, which is what `user_id` must carry for the
 * login check to pass.
 */
final class LegacyCredential
{
    /** @param array{id: string, publicKey: string, counter?: int, transports?: array} $row */
    public static function import(User $user, array $row): WebAuthnCredential
    {
        $cose = ByteBuffer::decodeBase64Url($row['publicKey']);
        if ($cose === false || $cose === '') {
            throw new InvalidArgumentException('credential '.$row['id'].': public key is not base64url');
        }

        $credential = $user->makeWebAuthnCredential([
            'id' => $row['id'],
            'user_id' => $user->webAuthnHandle(),
            'counter' => (int) ($row['counter'] ?? 0),
            'rp_id' => config('fitpal.rp_id'),
            'origin' => config('fitpal.origin'),
            'transports' => array_values(array_filter((array) ($row['transports'] ?? []), 'is_string')),
            'aaguid' => null,
            'public_key' => self::toPem($cose),
            'attestation_format' => 'none',
            'legacy_cose' => $row['publicKey'],
        ]);
        $credential->authenticatable_id = $user->id;
        $credential->save();

        return $credential;
    }

    /** The PEM of a COSE_Key: OKP Ed25519 (-8), EC2 on P-256 (-7) or RSA (-257). */
    public static function toPem(string $cose): string
    {
        $map = CborDecoder::decode($cose);
        if (! is_array($map) || ! isset($map[1])) {
            throw new InvalidArgumentException('not a COSE key');
        }
        $bytes = static fn (mixed $v): string => $v instanceof ByteBuffer ? $v->getBinaryString() : (string) $v;
        // -1 is the curve for OKP and EC2 but the modulus for RSA, so it is read per type.
        $crv = is_int($map[-1] ?? null) ? $map[-1] : -1;

        switch ((int) $map[1]) {
            case 1: // OKP: crv 6 = Ed25519, x = the 32-byte key
                $x = $bytes($map[-2] ?? '');
                if ($crv !== 6 || strlen($x) !== 32) {
                    throw new InvalidArgumentException('unsupported OKP curve '.$crv.' or malformed key');
                }
                $der = self::sequence(self::sequence(self::oid("\x2B\x65\x70")).self::bitString($x));
                break;
            case 2: // EC2: crv 1 = P-256, x and y 32 bytes each
                $x = $bytes($map[-2] ?? '');
                $y = $bytes($map[-3] ?? '');
                if ($crv !== 1 || strlen($x) !== 32 || strlen($y) !== 32) {
                    throw new InvalidArgumentException('unsupported EC2 curve '.$crv.' or malformed point');
                }
                $der = self::sequence(
                    self::sequence(self::oid("\x2A\x86\x48\xCE\x3D\x02\x01").self::oid("\x2A\x86\x48\xCE\x3D\x03\x01\x07"))
                    .self::bitString("\x04".$x.$y)
                );
                break;
            case 3: // RSA: n = modulus, e = exponent
                $n = $bytes($map[-1] ?? '');
                $e = $bytes($map[-2] ?? '');
                if ($n === '' || $e === '') {
                    throw new InvalidArgumentException('RSA key without modulus or exponent');
                }
                $der = self::sequence(
                    self::sequence(self::oid("\x2A\x86\x48\x86\xF7\x0D\x01\x01\x01")."\x05\x00")
                    .self::bitString(self::sequence(self::unsignedInteger($n).self::unsignedInteger($e)))
                );
                break;
            default:
                throw new InvalidArgumentException('unsupported COSE key type '.$map[1]);
        }

        return "-----BEGIN PUBLIC KEY-----\n".chunk_split(base64_encode($der), 64, "\n").'-----END PUBLIC KEY-----';
    }

    private static function length(int $n): string
    {
        if ($n < 128) {
            return chr($n);
        }
        $bytes = ltrim(pack('N', $n), "\0");

        return chr(0x80 | strlen($bytes)).$bytes;
    }

    private static function sequence(string $contents): string
    {
        return "\x30".self::length(strlen($contents)).$contents;
    }

    private static function oid(string $encoded): string
    {
        return "\x06".self::length(strlen($encoded)).$encoded;
    }

    private static function bitString(string $bytes): string
    {
        return "\x03".self::length(strlen($bytes) + 1)."\x00".$bytes;
    }

    private static function unsignedInteger(string $bytes): string
    {
        $bytes = ltrim($bytes, "\0");
        if ($bytes === '' || (ord($bytes[0]) & 0x80)) {
            $bytes = "\0".$bytes;
        }

        return "\x02".self::length(strlen($bytes)).$bytes;
    }
}
