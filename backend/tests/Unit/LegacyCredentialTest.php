<?php

// COSE → PEM for the three key types the Node API's registration offered.

use App\WebAuthn\LegacyCredential;
use Tests\Support\Passkey;

it('converts the P-256 key a software authenticator presents to the PEM OpenSSL made it from', function () {
    $pk = new Passkey;
    expect(trim(LegacyCredential::toPem(Passkey::unb64u($pk->coseKey()))))->toBe(trim($pk->publicKeyPem()));
});

it('converts an Ed25519 key, the algorithm the Node API offered first', function () {
    $x = sodium_crypto_sign_publickey(sodium_crypto_sign_keypair());
    // {1: 1 (OKP), 3: -8 (EdDSA), -1: 6 (Ed25519), -2: x}
    $cose = "\xa4\x01\x01\x03\x27\x20\x06\x21\x58\x20".$x;
    $pem = LegacyCredential::toPem($cose);
    $der = base64_decode(preg_replace('/-----[^-]+-----|\s/', '', $pem));
    expect(bin2hex(substr($der, 0, 12)))->toBe('302a300506032b6570032100')
        ->and(substr($der, 12))->toBe($x)
        ->and(openssl_pkey_get_public($pem))->not->toBeFalse();
});

it('converts an RSA key', function () {
    $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA, 'config' => getenv('OPENSSL_CONF') ?: null]);
    if ($key === false) {
        $this->markTestSkipped('no openssl.cnf for key generation here');
    }
    $d = openssl_pkey_get_details($key);
    // {1: 3 (RSA), 3: -257, -1: n, -2: e}
    $cose = Passkey::cbor([1 => 3, 3 => -257, -1 => $d['rsa']['n'], -2 => $d['rsa']['e']]);
    expect(trim(LegacyCredential::toPem($cose)))->toBe(trim($d['key']));
});

it('refuses a key type, curve or shape it does not know rather than importing a key that can never verify', function () {
    $x32 = str_repeat("\x11", 32);
    expect(fn () => LegacyCredential::toPem("\xa1\x01\x04"))->toThrow(InvalidArgumentException::class, 'unsupported COSE key type 4')
        ->and(fn () => LegacyCredential::toPem("\xa2\x01\x01\x20\x07"))->toThrow(InvalidArgumentException::class, 'unsupported OKP curve 7')
        // EC2 on P-384 (crv 2) with 32-byte coordinates: wrong curve.
        ->and(fn () => LegacyCredential::toPem(Passkey::cbor([1 => 2, 3 => -7, -1 => 2, -2 => $x32, -3 => $x32])))->toThrow(InvalidArgumentException::class, 'unsupported EC2 curve 2')
        // P-256 with a 31-byte x: not a point the package could ever verify against.
        ->and(fn () => LegacyCredential::toPem(Passkey::cbor([1 => 2, 3 => -7, -1 => 1, -2 => substr($x32, 1), -3 => $x32])))->toThrow(InvalidArgumentException::class, 'malformed point')
        ->and(fn () => LegacyCredential::toPem(Passkey::cbor([1 => 3, 3 => -257, -1 => '', -2 => "\x01\x00\x01"])))->toThrow(InvalidArgumentException::class, 'RSA key without modulus');
});
