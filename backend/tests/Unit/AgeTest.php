<?php

// App\Backup\Age, the encryption of the nightly dump to the owner's age key (CHW-361). Checked three
// ways: its pieces reproduce the C2SP test vectors byte for byte (tests/fixtures/age, from
// github.com/C2SP/CCTV/tree/main/age, whose licence asks no attribution); what it writes decrypts
// with an X25519 identity, through a decrypter (Tests\Support\AgeFiles) that the same vectors check
// first; and, where the real age is installed (CI), with age itself.

use App\Backup\Age;
use Illuminate\Support\Facades\Process;
use Tests\Support\AgeFiles;

it('decrypts the C2SP vectors, and refuses the bad one', function (string $name) {
    [$v, $file] = AgeFiles::vector($name);
    $out = AgeFiles::decrypt($file, AgeFiles::secret($v['identity']));
    if ($v['expect'] === 'success') {
        expect($out)->not->toBeNull()
            ->and(hash('sha256', $out['plain']))->toBe($v['payload'])
            ->and(bin2hex($out['fileKey']))->toBe($v['file key']);
    } else {
        expect($out)->toBeNull();
    }
})->with(['x25519', 'x25519_grease', 'x25519_multiple_recipients', 'x25519_bad_tag']);

it('writes the header MAC and the payload of a vector byte for byte, given its file key and nonce', function () {
    [$v, $file] = AgeFiles::vector('x25519');
    $out = AgeFiles::decrypt($file, AgeFiles::secret($v['identity']));
    $fileKey = hex2bin($v['file key']);

    expect(Age::mac($fileKey, $out['header']))->toBe($out['mac'])
        ->and(Age::payload($fileKey, $out['nonce'], $out['plain']))->toBe($out['payload']);
});

it('reads a recipient as its public key: the spec example is the public half of its identity', function () {
    $secret = AgeFiles::secret('AGE-SECRET-KEY-1GFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPQ4EGAEX');
    expect(Age::recipientKey('age1zvkyg2lqzraa2lnjvqej32nkuu0ues2s82hzrye869xeexvn73equnujwj'))
        ->toBe(sodium_crypto_scalarmult_base($secret))
        ->and(Age::recipientKey("  age1zvkyg2lqzraa2lnjvqej32nkuu0ues2s82hzrye869xeexvn73equnujwj\n"))->toHaveLength(32);
});

it('refuses what is not an age X25519 recipient', function (string $bad) {
    expect(fn () => Age::recipientKey($bad))->toThrow(InvalidArgumentException::class);
})->with([
    'one character changed' => 'age1zvkyg2lqzraa2lnjvqej32nkuu0ues2s82hzrye869xeexvn73equnujwq',
    'mixed case' => 'age1zvkyg2lqzraa2lnjvqej32nkuu0ues2s82hzrye869xeexvn73equnujwJ',
    'the private key' => 'AGE-SECRET-KEY-1GFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPQ4EGAEX',
    'empty' => '',
    'an ssh key' => 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl',
]);

it('refuses a key nothing can be encrypted to, before a dump needs it', function () {
    // The all-zero point decodes as 32 bytes but every shared secret with it is zero.
    expect(fn () => Age::recipientKey(AgeFiles::recipient(str_repeat("\0", 32))))
        ->toThrow(InvalidArgumentException::class, 'a low-order point');
});

it('writes files an X25519 identity decrypts, of every size around the 64 KiB chunk', function (int $size) {
    [$secret, $recipient] = AgeFiles::keyPair();
    $plain = $size > 0 ? random_bytes($size) : '';
    $file = Age::encrypt($plain, $recipient);

    expect(AgeFiles::decrypt($file, $secret)['plain'] ?? null)->toBe($plain)
        // a fresh file key and nonce each time: the same dump never encrypts the same way twice
        ->and(Age::encrypt($plain, $recipient))->not->toBe($file);
})->with([0, 1, 65535, 65536, 65537, 200000]);

it('decrypts with the real age, where it is installed', function () {
    if (Process::run(['age', '--version'])->failed()) {
        // CI installs it (test.yml); there, a missing age is a broken check, not a skipped one.
        expect(getenv('CI'))->toBeFalsy('age must be installed in CI');
        $this->markTestSkipped('age is not installed here (CI installs it)');
    }
    $dir = sys_get_temp_dir().'/fitpal-age-'.bin2hex(random_bytes(4));
    mkdir($dir);
    [$secret, $recipient] = AgeFiles::keyPair();
    file_put_contents("$dir/key.txt", AgeFiles::bech32('age-secret-key-', $secret, upper: true)."\n");
    $plain = random_bytes(150000);
    file_put_contents("$dir/dump.age", Age::encrypt($plain, $recipient));

    $run = Process::run(['age', '-d', '-i', "$dir/key.txt", '-o', "$dir/dump", "$dir/dump.age"]);
    expect($run->errorOutput())->toBe('')
        ->and($run->successful())->toBeTrue()
        ->and(file_get_contents("$dir/dump"))->toBe($plain);
    array_map('unlink', glob("$dir/*") ?: []);
    rmdir($dir);
});
