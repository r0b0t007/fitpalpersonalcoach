<?php

namespace App\Media;

use App\Support\ClientSafe;
use App\Support\Json;

/**
 * Where media lives: `DATA_DIR/media` (Node's MEDIA_DIR), with `ex/` for coach demos and
 * `photo/<safeUid>/` for each client's progress photos. Outside the document root; the bytes only
 * ever leave through Serve, behind a session. The `media` disk (config/filesystems.php) points at
 * the same root for code that wants a Storage disk (the admin panel, R4).
 */
final class Paths
{
    public static function root(): string
    {
        return rtrim((string) config('fitpal.data_dir'), '/\\').DIRECTORY_SEPARATOR.'media';
    }

    /**
     * A directory under the root, created on first use. Refused as Node refused it — before the
     * body is read, so with `Connection: close`.
     *
     * @throws ClientSafe
     */
    public static function dir(string $sub): string
    {
        $dir = self::root().DIRECTORY_SEPARATOR.str_replace('/', DIRECTORY_SEPARATOR, $sub);
        if (! is_dir($dir) && ! @mkdir($dir, 0700, true) && ! is_dir($dir)) {
            throw new ClientSafe(500, 'media directory is not writable', [], Json::CLOSE);
        }

        return $dir;
    }

    /** api/server.js safeUid: how Node named a user's photo directory. */
    public static function safeUid(string $id): string
    {
        return (string) preg_replace('/[^a-zA-Z0-9_-]/', '', $id);
    }
}
