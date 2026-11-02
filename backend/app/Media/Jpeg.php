<?php

namespace App\Media;

/**
 * A JPEG with nothing in it but the picture (CHW-356): for the one photo anyone can fetch, a
 * coach's face on their public page. The app sends one drawn on a canvas, which carries no
 * metadata (lib/photo.js); this is what makes that true of every file the public route serves,
 * whatever posted it, without an image library: the file is walked segment by segment, and kept
 * are only those a decoder needs.
 *
 * Dropped: APP1–APP15 (EXIF with its GPS, XMP, ICC, maker notes, Photoshop's IPTC) and comments,
 * and everything after the end-of-image marker — where phones append a motion photo's video.
 * Kept: APP0 (JFIF), the tables, the frame and every scan, byte for byte, so the picture decodes
 * as it did. Its size comes from the frame header.
 */
final class Jpeg
{
    /** Start-of-frame markers, the ones that carry the size: not DHT (C4), JPG (C8) or DAC (CC). */
    private const SOF = [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF];

    /**
     * The picture without the rest, and its size; null for what is not a whole JPEG.
     *
     * @return array{bytes: string, w: int, h: int}|null
     */
    public static function clean(string $in): ?array
    {
        $n = strlen($in);
        if ($n < 4 || substr($in, 0, 2) !== "\xFF\xD8") {
            return null;
        }
        $out = "\xFF\xD8";
        $i = 2;
        $w = $h = 0;
        $scanned = false;
        while ($i + 1 < $n) {
            if ($in[$i] !== "\xFF") {
                return null;
            }
            $m = ord($in[$i + 1]);
            if ($m === 0xFF) {   // fill before a marker
                $i++;

                continue;
            }
            if ($m === 0xD9) {   // the end: what follows is not the picture
                return $scanned && $w > 0 && $h > 0 ? ['bytes' => $out."\xFF\xD9", 'w' => $w, 'h' => $h] : null;
            }
            if ($m === 0x01 || ($m >= 0xD0 && $m <= 0xD7)) {   // markers with no length
                $out .= substr($in, $i, 2);
                $i += 2;

                continue;
            }
            if ($i + 4 > $n) {
                return null;
            }
            $len = unpack('n', substr($in, $i + 2, 2))[1];
            if ($len < 2 || $i + 2 + $len > $n) {
                return null;
            }
            if (in_array($m, self::SOF, true)) {
                if ($len < 8) {
                    return null;
                }
                $h = unpack('n', substr($in, $i + 5, 2))[1];
                $w = unpack('n', substr($in, $i + 7, 2))[1];
            }
            $drop = ($m >= 0xE1 && $m <= 0xEF) || $m === 0xFE;
            if (! $drop) {
                $out .= substr($in, $i, 2 + $len);
            }
            $i += 2 + $len;
            if ($m !== 0xDA) {
                continue;
            }
            // A scan's coded data runs to the next marker: an FF that is not a stuffed 00, a
            // restart, or fill. Kept as it is; a progressive file has several, with tables between.
            $scanned = true;
            $j = $i;
            while (true) {
                $p = strpos($in, "\xFF", $j);
                if ($p === false || $p + 1 >= $n) {
                    return null;
                }
                $next = ord($in[$p + 1]);
                if ($next === 0x00 || ($next >= 0xD0 && $next <= 0xD7)) {
                    $j = $p + 2;

                    continue;
                }
                break;
            }
            $out .= substr($in, $i, $p - $i);
            $i = $p;
        }

        return null;
    }
}
