<?php

// App\Media\Sniff, with the cases api/domain.test.mjs held sniffMedia, validateUpload and
// safeMediaFile to, ported one for one.

use App\Media\Sniff;
use App\Support\Say;

/** An ISO base-media header: [size][ftyp][major][minor][compatible…], padded to the window. */
function ftyp(string $major, array $compat = [], ?int $declared = null): string
{
    $total = 16 + 4 * count($compat);
    $b = pack('N', $declared ?? $total).'ftyp'.$major.pack('N', 0x200).implode('', $compat);

    return str_pad($b, max($total, Sniff::BYTES), "\0");
}

function bytesOf(int ...$n): string
{
    return pack('C*', ...$n).str_repeat("\0", Sniff::BYTES);
}

beforeEach(function () {
    $this->jpeg = bytesOf(0xFF, 0xD8, 0xFF, 0xE0);
    $this->png = bytesOf(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A);
    $this->webp = 'RIFF'.str_repeat("\0", 4).'WEBPVP8 '.str_repeat("\0", 16);
    $this->gif = 'GIF89a'.str_repeat("\0", Sniff::BYTES);
});

it('identifies the plain image formats', function () {
    expect(Sniff::media($this->jpeg))->toBe(['kind' => 'photo', 'ext' => 'jpg', 'mime' => 'image/jpeg'])
        ->and(Sniff::media($this->png))->toBe(['kind' => 'photo', 'ext' => 'png', 'mime' => 'image/png'])
        ->and(Sniff::media($this->webp))->toBe(['kind' => 'photo', 'ext' => 'webp', 'mime' => 'image/webp'])
        ->and(Sniff::media($this->gif)['ext'])->toBe('gif');
});

it('returns null rather than guessing', function () {
    expect(Sniff::media(''))->toBeNull()
        ->and(Sniff::media('too short'))->toBeNull()
        ->and(Sniff::media(str_repeat("\0", Sniff::BYTES)))->toBeNull()
        ->and(Sniff::media('{"not":"media","but":"json"}'))->toBeNull();
});

it('separates mp4 / mov / heic / avif by brand, not by ftyp', function () {
    expect(Sniff::media(ftyp('isom', ['iso2', 'avc1', 'mp41']))['kind'])->toBe('video')
        ->and(Sniff::media(ftyp('isom', ['iso2', 'avc1', 'mp41']))['ext'])->toBe('mp4')
        ->and(Sniff::media(ftyp('qt  '))['ext'])->toBe('mov')
        ->and(Sniff::media(ftyp('heic', ['mif1']))['kind'])->toBe('photo');
});

it('does not read a real AVIF as HEIC', function () {
    $avif = ftyp('avif', ['avif', 'mif1', 'miaf', 'MA1B']);
    expect(Sniff::media($avif)['ext'])->toBe('avif')
        ->and(Sniff::media($avif)['mime'])->toBe('image/avif')
        ->and(Sniff::validate($avif, 'photo')['error'])->toContain('not a supported image format');
});

it('reads the compatible-brand list, not only the major brand', function () {
    expect(Sniff::media(ftyp('mp42', ['mif1', 'heic']))['kind'])->toBe('photo')
        ->and(Sniff::media(ftyp('mp42', ['isom', 'hvc1']))['brand'])->toBe('hvc1');
});

it('clamps the brand walk to the bytes actually read', function () {
    expect(Sniff::media(ftyp('mp42', ['isom'], 0xFFFFFFF0))['ext'])->toBe('mp4')
        ->and(Sniff::media(ftyp('mp42', ['isom'], 0))['ext'])->toBe('mp4');   // 0 is not a length
});

it('never reads past the sniff window, however much it is handed', function () {
    $whole = str_repeat("\0", 4 * 1024 * 1024);
    $whole = substr_replace($whole, pack('N', 0).'ftypmp42', 0, 12);
    $whole = substr_replace($whole, 'isom', 16, 4);
    $whole = substr_replace($whole, 'mif1', 2_000_000, 4);   // payload bytes that spell a HEIF brand
    $started = microtime(true);
    expect(Sniff::media($whole)['ext'])->toBe('mp4')
        ->and(microtime(true) - $started)->toBeLessThan(0.05)
        ->and(Sniff::validate($whole, 'video'))->not->toHaveKey('error');
});

it('sees a decisive brand late in the compatible list', function () {
    $late = ftyp('mp42', ['isom', 'iso2', 'mp41', 'avc1', 'hvc1']);
    expect(Sniff::media($late)['brand'])->toBe('hvc1')
        ->and(Sniff::validate($late, 'video')['needsTranscode'])->toBeTrue();
});

it('accepts what every browser can decode, unflagged', function () {
    expect(Sniff::validate(ftyp('isom', ['avc1']), 'video'))->toBe(['kind' => 'video', 'ext' => 'mp4', 'mime' => 'video/mp4', 'needsTranscode' => false])
        ->and(Sniff::validate($this->jpeg, 'photo'))->toBe(['kind' => 'photo', 'ext' => 'jpg', 'mime' => 'image/jpeg', 'needsTranscode' => false])
        ->and(Sniff::validate($this->png, 'photo'))->not->toHaveKey('error')
        ->and(Sniff::validate($this->webp, 'photo'))->not->toHaveKey('error');
});

it('takes what an iPhone produces, and marks it for conversion', function () {
    $mov = Sniff::validate(ftyp('qt  '), 'video');
    $hevc = Sniff::validate(ftyp('mp42', ['isom', 'hvc1']), 'video');
    expect($mov)->toMatchArray(['ext' => 'mov', 'mime' => 'video/quicktime', 'needsTranscode' => true])
        ->and($hevc)->toMatchArray(['ext' => 'mp4', 'needsTranscode' => true]);
});

it('cannot see a codec the container does not declare', function () {
    expect(Sniff::validate(ftyp('isom', ['iso2']), 'video')['needsTranscode'])->toBeFalse();
});

it('refuses what it cannot store, in the words the app translates', function () {
    expect(Sniff::validate(ftyp('heic', ['mif1']), 'photo'))->toBe(['error' => 'HEIC photos do not display in most browsers — set the camera to “Most Compatible”, or export as JPEG'])
        ->and(Sniff::validate(ftyp('avif', ['mif1']), 'photo'))->toBe(['error' => 'image/avif is not a supported image format — use JPEG, PNG, WebP or GIF'])
        ->and(Sniff::validate($this->jpeg, 'video'))->toBe(['error' => 'expected a video, got image/jpeg'])
        ->and(Sniff::validate(ftyp('isom', ['avc1']), 'photo'))->toBe(['error' => 'expected an image, got video/mp4'])
        ->and(Sniff::validate(str_repeat("\0", Sniff::BYTES), 'video'))->toBe(['error' => 'not a recognised image or video file']);
});

it('takes a GIF, as it already took an animated WebP', function () {
    expect(Sniff::validate($this->gif, 'photo'))->toBe(['kind' => 'photo', 'ext' => 'gif', 'mime' => 'image/gif', 'needsTranscode' => false]);
});

it('carries the template beside the templated refusals', function () {
    Sniff::validate($this->jpeg, 'video');
    expect(Say::envelope('expected a video, got image/jpeg'))
        ->toBe(['error' => 'expected a video, got image/jpeg', 'msg' => ['k' => 'expected a video, got {0}', 'v' => ['image/jpeg']]]);
});

it('takes every file name the upload routes generate, and nothing that is not one', function () {
    foreach (str_split('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') as $c) {
        expect(Sniff::safeFile($c.'Xk3pQ7rTb2Ls9Nv1Zw.jpg'))->toBeTrue();
    }
    expect(Sniff::safeFile('squat_back-0f3a9c21d4e5b6a7.mp4'))->toBeTrue()
        ->and(Sniff::safeFile('.up-0123456789abcdef'))->toBeFalse()
        ->and(Sniff::safeFile('../db.json'))->toBeFalse()
        ->and(Sniff::safeFile('a..b.jpg'))->toBeFalse()
        ->and(Sniff::safeFile('a/b.jpg'))->toBeFalse()
        ->and(Sniff::safeFile("a.jpg\n"))->toBeFalse()
        ->and(Sniff::safeFile(''))->toBeFalse()
        ->and(Sniff::safeFile(null))->toBeFalse()
        ->and(Sniff::safeFile(['a.jpg']))->toBeFalse();
});
