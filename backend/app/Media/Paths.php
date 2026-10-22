<?php

namespace App\Media;

use App\Support\ClientSafe;
use App\Support\Json;
use Illuminate\Contracts\Filesystem\Filesystem;
use Illuminate\Support\Facades\Storage;

/**
 * Where media lives: `DATA_DIR/media` (Node's MEDIA_DIR), with `ex/` for coach demos and
 * `photo/<Uid::safe>/` for each client's progress photos — where the Node API keeps them, so a
 * cutover moves no files. Outside the document root; the bytes only ever leave through Serve,
 * behind a session.
 */
final class Paths
{
    public static function root(): string
    {
        return rtrim((string) config('fitpal.data_dir'), '/\\').DIRECTORY_SEPARATOR.'media';
    }

    /**
     * The same root as a Storage disk, for code that wants one (the admin panel, R4). Built from
     * root() each time rather than declared in config/filesystems.php, so the two can never point
     * at different trees.
     */
    public static function disk(): Filesystem
    {
        return Storage::build(['driver' => 'local', 'root' => self::root(), 'serve' => false, 'throw' => false]);
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
}
