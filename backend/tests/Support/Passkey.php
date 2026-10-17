<?php

namespace Tests\Support;

use Illuminate\Testing\TestResponse;
use OpenSSLAsymmetricKey;
use Tests\TestCase;

/**
 * A software authenticator for the tests: a P-256 key that answers registration and login
 * options exactly as the React app's credToJSON posts them (frontend/src/lib/api.js). It keeps the
 * key between calls, so a credential registered in one request signs assertions in the next.
 */
final class Passkey
{
    public string $credentialId;

    public string $userHandle = '';

    public int $counter = 0;

    private OpenSSLAsymmetricKey $key;

    public function __construct(public string $origin = 'http://localhost:5173', public string $rpId = 'localhost')
    {
        $this->key = self::newKey();
        $this->credentialId = self::b64u(random_bytes(16));
    }

    /** Registers through the two routes; returns the verify response. */
    public function register(TestCase $test, string $name, string $code = '', array $extra = []): TestResponse
    {
        $options = $test->postJson('/api/register/options', ['name' => $name, 'code' => $code] + $extra);
        if ($options->status() !== 200) {
            return $options;
        }

        return $test->postJson('/api/register/verify', ['cid' => $options->json('cid'), 'credential' => $this->attest($options->json('options'))]);
    }

    public function login(TestCase $test, ?string $withUserHandle = null, bool $uv = true): TestResponse
    {
        $options = $test->postJson('/api/login/options', []);

        return $test->postJson('/api/login/verify', ['cid' => $options->json('cid'), 'credential' => $this->assert($options->json('options'), $withUserHandle, $uv)]);
    }

    /** The registration response for the given options JSON. */
    public function attest(array $options, bool $uv = true): array
    {
        $this->userHandle = $options['user']['id'];
        $cose = self::cbor($this->coseMap());
        $credId = self::unb64u($this->credentialId);
        $authData = hash('sha256', $options['rp']['id'], true).chr(($uv ? 0x05 : 0x01) | 0x40).pack('N', 0)
            .str_repeat("\0", 16).pack('n', strlen($credId)).$credId.$cose;
        $attObj = self::cbor(['fmt' => 'none', 'attStmt' => [], 'authData' => $authData]);

        return [
            'id' => $this->credentialId, 'rawId' => $this->credentialId, 'type' => 'public-key',
            'clientExtensionResults' => [], 'authenticatorAttachment' => 'platform',
            'response' => [
                'clientDataJSON' => self::b64u($this->clientData('webauthn.create', $options['challenge'])),
                'attestationObject' => self::b64u($attObj),
                'transports' => ['internal'],
            ],
        ];
    }

    /** The authentication response for the given options JSON. */
    public function assert(array $options, ?string $userHandle = null, bool $uv = true): array
    {
        $this->counter++;
        $authData = hash('sha256', $options['rpId'] ?? $this->rpId, true).chr($uv ? 0x05 : 0x01).pack('N', $this->counter);
        $clientData = $this->clientData('webauthn.get', $options['challenge']);
        openssl_sign($authData.hash('sha256', $clientData, true), $signature, $this->key, OPENSSL_ALGO_SHA256);

        return [
            'id' => $this->credentialId, 'rawId' => $this->credentialId, 'type' => 'public-key',
            'clientExtensionResults' => [], 'authenticatorAttachment' => 'platform',
            'response' => [
                'clientDataJSON' => self::b64u($clientData), 'authenticatorData' => self::b64u($authData),
                'signature' => self::b64u($signature), 'userHandle' => $userHandle ?? ($this->userHandle ?: null),
            ],
        ];
    }

    /** The COSE key bytes, base64url, as the Node API stored them in db.json. */
    public function coseKey(): string
    {
        return self::b64u(self::cbor($this->coseMap()));
    }

    /**
     * The COSE_Key map of the P-256 public key. OpenSSL hands back x and y as minimal big-endian
     * integers, so about one key in 128 has a 31-byte coordinate; an authenticator always sends
     * 32, and the package rightly refuses anything else. Pad, or the suite fails at random.
     */
    private function coseMap(): array
    {
        $ec = openssl_pkey_get_details($this->key)['ec'];

        return [1 => 2, 3 => -7, -1 => 1, -2 => str_pad($ec['x'], 32, "\0", STR_PAD_LEFT), -3 => str_pad($ec['y'], 32, "\0", STR_PAD_LEFT)];
    }

    public function publicKeyPem(): string
    {
        return openssl_pkey_get_details($this->key)['key'];
    }

    /** openssl_pkey_new needs an openssl.cnf; Windows PHP builds do not always find theirs. */
    private static function newKey(): OpenSSLAsymmetricKey
    {
        $opts = ['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC];
        $key = @openssl_pkey_new($opts);
        if ($key === false) {
            foreach ([getenv('OPENSSL_CONF'), dirname(PHP_BINARY).'/extras/ssl/openssl.cnf', dirname(PHP_BINARY).'/extras/openssl/openssl.cnf', dirname(PHP_BINARY, 2).'/apache/conf/openssl.cnf'] as $cnf) {
                if ($cnf && is_file($cnf)) {
                    $key = openssl_pkey_new($opts + ['config' => $cnf]);
                    if ($key !== false) {
                        break;
                    }
                }
            }
        }
        if ($key === false) {
            throw new \RuntimeException('openssl_pkey_new failed: '.openssl_error_string());
        }

        return $key;
    }

    private function clientData(string $type, string $challenge): string
    {
        return json_encode(['type' => $type, 'challenge' => $challenge, 'origin' => $this->origin, 'crossOrigin' => false]);
    }

    public static function b64u(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }

    public static function unb64u(string $s): string
    {
        return base64_decode(strtr($s, '-_', '+/'));
    }

    /** Enough CBOR for an attestation object and a COSE key: ints, byte and text strings, maps. */
    public static function cbor(mixed $v): string
    {
        $head = static function (int $major, int $n): string {
            if ($n < 24) {
                return chr(($major << 5) | $n);
            }
            if ($n < 256) {
                return chr(($major << 5) | 24).chr($n);
            }
            if ($n < 65536) {
                return chr(($major << 5) | 25).pack('n', $n);
            }

            return chr(($major << 5) | 26).pack('N', $n);
        };
        if (is_int($v)) {
            return $v >= 0 ? $head(0, $v) : $head(1, -1 - $v);
        }
        if (is_string($v)) {
            // Keys and format names are text; anything else here is raw bytes.
            return in_array($v, ['fmt', 'none', 'attStmt', 'authData'], true)
                ? $head(3, strlen($v)).$v
                : $head(2, strlen($v)).$v;
        }
        if (is_array($v)) {
            $pairs = [];
            foreach ($v as $k => $val) {
                $pairs[] = [self::cbor($k), self::cbor($val)];
            }
            usort($pairs, fn ($a, $b) => strlen($a[0]) <=> strlen($b[0]) ?: strcmp($a[0], $b[0]));

            return $head(5, count($pairs)).implode('', array_map(fn ($p) => $p[0].$p[1], $pairs));
        }
        throw new \InvalidArgumentException('cbor: unsupported value');
    }
}
