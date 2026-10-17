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

it('refuses a key type it does not know rather than importing junk', function () {
    expect(fn () => LegacyCredential::toPem("\xa1\x01\x04"))->toThrow(InvalidArgumentException::class, 'unsupported COSE key type 4')
        ->and(fn () => LegacyCredential::toPem("\xa2\x01\x01\x20\x07"))->toThrow(InvalidArgumentException::class, 'unsupported OKP curve 7');
});
