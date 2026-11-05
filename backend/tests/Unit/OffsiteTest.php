<?php

// App\Backup\Offsite (CHW-361): the S3 request signature it writes by hand, checked against the
// worked examples in AWS's Signature Version 4 documentation for S3 ("Examples: Signature
// Calculations in AWS Signature Version 4"); and what fitpal:check-config is told when the copy
// off the server is not set up, or set up wrong.

use App\Backup\Offsite;
use Tests\Support\AgeFiles;

const AWS_KEY_ID = 'AKIAIOSFODNN7EXAMPLE';
const AWS_SECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';

it('signs the AWS documentation GET Object example', function () {
    $auth = Offsite::sign('GET', '/test.txt', [
        'host' => 'examplebucket.s3.amazonaws.com',
        'range' => 'bytes=0-9',
        'x-amz-content-sha256' => hash('sha256', ''),
        'x-amz-date' => '20130524T000000Z',
    ], AWS_KEY_ID, AWS_SECRET, 'us-east-1');

    expect($auth)->toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
        .'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
});

it('signs the AWS documentation PUT Object example, headers in any order', function () {
    $auth = Offsite::sign('PUT', '/test%24file.text', [
        'x-amz-storage-class' => 'REDUCED_REDUNDANCY',
        'x-amz-date' => '20130524T000000Z',
        'host' => 'examplebucket.s3.amazonaws.com',
        'date' => 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-content-sha256' => hash('sha256', 'Welcome to Amazon S3.'),
    ], AWS_KEY_ID, AWS_SECRET, 'us-east-1');

    expect($auth)->toEndWith('SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
});

/** A complete, valid setup; a test changes what it is about. */
function offsiteConfig(array $over = []): void
{
    config(['fitpal.backup' => [...[
        'recipient' => AgeFiles::keyPair()[1],
        'endpoint' => 'https://0123456789abcdef.eu.r2.cloudflarestorage.com',
        'bucket' => 'fitpal-coach-backups',
        'key_id' => 'key-id',
        'secret' => 'secret',
    ], ...$over]]);
}

it('has nothing to say about a complete setup', function () {
    offsiteConfig();
    expect(Offsite::problems())->toBe([])->and(Offsite::attempted())->toBeTrue();
});

it('names every setting missing, and an instance with none has not attempted it', function () {
    config(['fitpal.backup' => ['recipient' => '', 'endpoint' => '', 'bucket' => '', 'key_id' => '', 'secret' => '']]);
    expect(Offsite::attempted())->toBeFalse()
        ->and(Offsite::problems())->toBe(['the nightly backup is not copied off the server: set BACKUP_AGE_RECIPIENT, BACKUP_R2_ENDPOINT, BACKUP_R2_BUCKET, BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY (docs/DEPLOY_COACH_SUBDOMAIN.md, Backups).']);

    offsiteConfig(['secret' => '']);
    expect(Offsite::problems()[0])->toContain('set BACKUP_R2_SECRET_ACCESS_KEY (');
});

it('says so loudly when the private key was put on the server', function () {
    offsiteConfig(['recipient' => 'AGE-SECRET-KEY-1GFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPQ4EGAEX']);
    expect(Offsite::problems())->toHaveCount(1)
        ->and(Offsite::problems()[0])->toContain('holds a PRIVATE key')->toContain('Remove it from this server now');
});

it('refuses a recipient or an endpoint that is not one', function (array $over, string $says) {
    offsiteConfig($over);
    expect(Offsite::problems())->toHaveCount(1)->and(Offsite::problems()[0])->toContain($says);
})->with([
    'a typo in the key' => [['recipient' => 'age1zvkyg2lqzraa2lnjvqej32nkuu0ues2s82hzrye869xeexvn73equnujwq'], 'BACKUP_AGE_RECIPIENT is the Bech32 checksum does not match'],
    'the bucket in the endpoint' => [['endpoint' => 'https://0123.eu.r2.cloudflarestorage.com/fitpal-coach-backups'], 'is not the bucket\'s S3 address'],
    'plain http' => [['endpoint' => 'http://0123.eu.r2.cloudflarestorage.com'], 'is not the bucket\'s S3 address'],
    'a port, which the signature would not cover' => [['endpoint' => 'https://0123.eu.r2.cloudflarestorage.com:443'], 'is not the bucket\'s S3 address'],
    'a low-order key' => [['recipient' => AgeFiles::recipient(str_repeat("\0", 32))], 'a low-order point'],
]);

it('can encrypt with a usable key whatever the R2 settings are, and cannot without one', function () {
    offsiteConfig(['endpoint' => '', 'secret' => '']);
    expect(Offsite::recipientUsable())->toBeTrue()->and(Offsite::problems())->not->toBe([]);

    foreach (['', 'AGE-SECRET-KEY-1GFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPYYSJZGFPQ4EGAEX', 'age1typo'] as $bad) {
        offsiteConfig(['recipient' => $bad]);
        expect(Offsite::recipientUsable())->toBeFalse();
    }
});
