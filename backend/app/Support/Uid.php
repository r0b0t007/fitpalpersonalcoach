<?php

namespace App\Support;

/**
 * api/server.js safeUid: how the Node API turned an account id into a file name — state-<uid>.json,
 * coach-<uid>.json, media-<uid>.json and each client's photo directory. Kept for the files it
 * named (the import reads them, the photo directories stay where they are), not as a sanitiser:
 * every id the app makes is already in this alphabet.
 */
final class Uid
{
    public static function safe(string $id): string
    {
        return (string) preg_replace('/[^a-zA-Z0-9_-]/', '', $id);
    }
}
