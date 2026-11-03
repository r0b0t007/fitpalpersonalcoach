<?php

namespace App\Media;

/**
 * A JPEG with nothing in it but the picture (CHW-356): for the one photo anyone can fetch, a
 * coach's face on their public page. The app sends one drawn on a canvas, which carries no
 * metadata (lib/photo.js); this is what makes that true of every file the public route serves,
 * whatever posted it, without an image library: the file is walked segment by segment, and kept
 * are only those a decoder needs.
 *
 * Kept, by a list of what a decoder needs rather than of what to drop: the frame, the tables
 * (quantisation, Huffman, arithmetic, restart interval) and every scan, byte for byte; JFIF's
 * header without its thumbnail (a small copy of the uncropped photo); and Adobe's 12 bytes, whose
 * colour-transform flag an RGB or CMYK file decodes by. Everything else goes: EXIF with its GPS,
 * XMP, maker notes, IPTC, comments, a JFXX thumbnail, any segment a decoder skips — and whatever
 * follows the end-of-image marker, where phones append a motion photo's video. The ICC profile
 * goes too: a Display P3 photo comes out a little flatter, as one drawn on the app's canvas does.
 * Its size comes from the frame header.
 */
final class Jpeg
{
    /** Start-of-frame markers, the ones that carry the size: not DHT (C4), JPG (C8) or DAC (CC). */
    private const SOF = [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF];

    /** The tables and the scan header, kept as they are: DHT, DAC, DQT, DRI, SOS. */
    private const TABLES = [0xC4, 0xCC, 0xDB, 0xDD, 0xDA];

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
            $kept = self::kept($m, substr($in, $i + 4, $len - 2));
            if ($kept !== null) {
                $out .= "\xFF".chr($m).pack('n', strlen($kept) + 2).$kept;
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

    /** What of one segment stays: its data, as much of it as a decoder needs, or null for none. */
    private static function kept(int $marker, string $data): ?string
    {
        if (in_array($marker, self::SOF, true) || in_array($marker, self::TABLES, true)) {
            return $data;
        }
        // JFIF: identifier, version, units, two densities — and a thumbnail of size 0 by 0.
        if ($marker === 0xE0 && strlen($data) >= 14 && str_starts_with($data, "JFIF\0")) {
            return substr($data, 0, 12)."\0\0";
        }
        // Adobe: identifier, version, two flag words, the colour transform. Nothing more.
        if ($marker === 0xEE && strlen($data) >= 12 && str_starts_with($data, 'Adobe')) {
            return substr($data, 0, 12);
        }

        return null;
    }
}
