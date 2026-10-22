<?php

namespace App\Console;

use App\Media\Sniff;
use App\Models\ExerciseMedia;
use App\Models\ProgressPhoto;
use App\Models\PushSubscription;
use App\Models\User;
use App\Support\Js;
use App\Support\Uid;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * The media and push half of fitpal:import-legacy (R3): db.subs, db.media and each client's
 * progress photos (media-<uid>.json) — and, for --verify, what the Node API would have answered
 * from those files. The files themselves (media/ex, media/photo/<uid>) are not touched: Laravel
 * reads them where Node wrote them, under the same DATA_DIR. The VAPID pair is only reported on
 * (vapidReport): it lives in .env or in DATA_DIR/vapid.json, and the import writes neither.
 *
 * As LegacyCoaching: one cleaning step (rows()) that both the import and the verify read, a row it
 * cannot store as Node served it skipped and reported, and the files the truth — rows they no
 * longer hold are removed, so run it only while Node is the live API. A photo sidecar that cannot
 * be read leaves that client's photos as they were.
 */
final class LegacyMedia
{
    /**
     * What is imported, cleaned and in file order.
     *
     * @param  array<string, true>  $accounts  the account ids that exist
     * @param  list<string>  $skipped
     * @return array{subs: list<stdClass>, media: list<stdClass>, photos: array<string, ?list<stdClass>>}
     */
    public static function rows(stdClass $db, string $dir, array $accounts, array &$skipped): array
    {
        $subs = [];
        $seen = [];
        foreach (Js::list($db->subs ?? null) as $i => $s) {
            $endpoint = $s instanceof stdClass ? ($s->endpoint ?? null) : null;
            $keys = $s instanceof stdClass ? ($s->keys ?? null) : null;
            $label = 'subscription '.$i;
            if (! is_string($endpoint) || $endpoint === '' || ! $keys instanceof stdClass || ! is_string($keys->p256dh ?? null) || ! is_string($keys->auth ?? null)) {
                $skipped[] = "$label (no usable endpoint or keys)";

                continue;
            }
            if (! is_string($s->userId ?? null) || ! isset($accounts[$s->userId])) {
                $skipped[] = "$label (its account does not exist)";

                continue;
            }
            // Node's subscribe kept one row per endpoint; a second one was never the one moved.
            if (isset($seen[$endpoint])) {
                $skipped[] = "$label (a second row for the same endpoint)";

                continue;
            }
            $seen[$endpoint] = true;
            $subs[] = $s;
        }

        $media = [];
        $seen = [];
        foreach (Js::list($db->media ?? null) as $m) {
            $id = $m instanceof stdClass ? ($m->id ?? null) : null;
            $label = 'media '.(is_string($id) ? $id : json_encode($id));
            if (! is_string($id) || $id === '' || strlen($id) > 16) {
                $skipped[] = "$label (no usable id)";

                continue;
            }
            if (isset($seen[$id])) {
                $skipped[] = "$label (a second row with the same id)";

                continue;
            }
            $seen[$id] = true;
            if (! is_string($m->coachId ?? null) || ! isset($accounts[$m->coachId])) {
                $skipped[] = "$label (its coach is not an account)";

                continue;
            }
            if (! is_string($m->exId ?? null) || ! preg_match('/^[A-Za-z0-9_-]{1,40}$/D', $m->exId)) {
                $skipped[] = "$label (not an exercise id)";

                continue;
            }
            // The one place an edited db.json would become a file read: the name Node checked too.
            if (! Sniff::safeFile($m->file ?? null) || strlen($m->file) > 160) {
                $skipped[] = "$label (not a file name the server would open)";

                continue;
            }
            if (! self::fits($m, ['label' => 40, 'mime' => 64, 'status' => 16, 'created' => 30], $label, $skipped, ['label'])) {
                continue;
            }
            if (! self::count($m->bytes ?? null)) {
                $skipped[] = "$label (bytes is not a size)";

                continue;
            }
            if (! is_file($dir.DIRECTORY_SEPARATOR.'media'.DIRECTORY_SEPARATOR.'ex'.DIRECTORY_SEPARATOR.$m->file)) {
                // Kept: Node listed it and answered its bytes with a 404 too.
                $skipped[] = "file of $label ({$m->file} is not in media/ex; the row is kept, as Node kept it)";
            }
            $media[] = $m;
        }

        $bySafe = [];
        foreach (array_keys($accounts) as $id) {
            $bySafe[Uid::safe((string) $id)] ??= (string) $id;
        }
        $photos = [];
        foreach (LegacyCoaching::files($dir, 'media-') as $uid => $file) {
            $owner = $bySafe[$uid] ?? null;
            if ($owner === null) {
                $skipped[] = basename($file).' (no such account)';

                continue;
            }
            // A torn copy (empty, or not JSON) removes nothing; JSON that is not a photo list is
            // Node's "no photos" (`Array.isArray(m && m.photos) ? m.photos : []`).
            $raw = @file_get_contents($file);
            $parsed = is_string($raw) && trim($raw) !== '' ? json_decode($raw) : null;
            if (! is_string($raw) || trim($raw) === '' || ($parsed === null && json_last_error() !== JSON_ERROR_NONE)) {
                $skipped[] = basename($file).' (cannot be read; these photos are left as they were)';
                $photos[$owner] = null;

                continue;
            }
            $kept = [];
            $slots = [];
            $ids = [];
            foreach ($parsed instanceof stdClass && is_array($parsed->photos ?? null) ? $parsed->photos : [] as $p) {
                $pid = $p instanceof stdClass ? ($p->id ?? null) : null;
                $label = basename($file).' photo '.(is_string($pid) ? $pid : json_encode($pid));
                if (! is_string($pid) || $pid === '' || strlen($pid) > 16 || isset($ids[$pid])) {
                    $skipped[] = "$label (no usable id, or a repeated one)";

                    continue;
                }
                if (! Js::isRealDate($p->d ?? null) || ! in_array($p->pose ?? null, ProgressPhoto::POSES, true)) {
                    $skipped[] = "$label (not a date and a pose)";

                    continue;
                }
                if (isset($slots[$p->d."\n".$p->pose])) {
                    $skipped[] = "$label (a second photo for {$p->d} {$p->pose})";

                    continue;
                }
                if (! Sniff::safeFile($p->file ?? null) || strlen($p->file) > 64 || ! self::count($p->bytes ?? null)) {
                    $skipped[] = "$label (not a file name the server would open, or no size)";

                    continue;
                }
                if (! self::fits($p, ['mime' => 64, 'created' => 30], $label, $skipped)) {
                    continue;
                }
                $ids[$pid] = $slots[$p->d."\n".$p->pose] = true;
                $kept[] = $p;
            }
            $photos[$owner] = $kept;
        }

        return ['subs' => $subs, 'media' => $media, 'photos' => $photos];
    }

    /**
     * Writes rows() in one transaction, mirror deletes included.
     *
     * @return array{subs: int, media: int, photos: int, removed: int}
     */
    public static function import(stdClass $db, string $dir, array $accounts, array &$skipped): array
    {
        $rows = self::rows($db, $dir, $accounts, $skipped);

        return DB::transaction(function () use ($rows, $accounts): array {
            $removed = 0;

            $subs = array_map(fn (stdClass $s) => [
                'user_id' => $s->userId, 'endpoint' => $s->endpoint, 'endpoint_hash' => PushSubscription::hashOf($s->endpoint),
                'p256dh' => $s->keys->p256dh, 'auth' => $s->keys->auth,
                'created' => is_string($s->created ?? null) ? mb_substr($s->created, 0, 30) : '',
            ], $rows['subs']);
            foreach (array_chunk($subs, 200) as $chunk) {
                PushSubscription::query()->upsert($chunk, ['endpoint_hash'], ['user_id', 'endpoint', 'p256dh', 'auth', 'created']);
            }
            $removed += PushSubscription::query()->whereNotIn('endpoint_hash', array_column($subs, 'endpoint_hash'))->delete();

            $media = array_map(fn (stdClass $m) => [
                'id' => $m->id, 'ex_id' => $m->exId, 'coach_id' => $m->coachId, 'file' => $m->file,
                'label' => is_string($m->label ?? null) ? $m->label : '', 'bytes' => (int) $m->bytes,
                'mime' => $m->mime, 'status' => $m->status, 'created' => $m->created,
            ], $rows['media']);
            foreach (array_chunk($media, 200) as $chunk) {
                ExerciseMedia::acrossCoaches()->upsert($chunk, ['id'], ['ex_id', 'coach_id', 'file', 'label', 'bytes', 'mime', 'status', 'created']); // across coaches: the import writes every coach's demos
            }
            $removed += ExerciseMedia::acrossCoaches()->whereNotIn('id', array_column($media, 'id'))->delete(); // across coaches: the import mirrors every coach's demos

            // Photos, per client: a sidecar that could not be read keeps what that client had; a
            // client with no sidecar has none (userPhotos answered []). In file order, which is
            // date order, so the list reads back as Node's did (ProgressPhoto::of).
            $count = 0;
            foreach (array_keys($accounts) as $owner) {
                if (array_key_exists($owner, $rows['photos']) && $rows['photos'][$owner] === null) {
                    continue;
                }
                $list = $rows['photos'][$owner] ?? [];
                $removed += ProgressPhoto::query()->where('user_id', $owner)->whereNotIn('id', array_map(fn ($p) => $p->id, $list))->delete();
                foreach ($list as $p) {
                    ProgressPhoto::query()->upsert([[
                        'id' => $p->id, 'user_id' => $owner, 'd' => $p->d, 'pose' => $p->pose, 'file' => $p->file,
                        'bytes' => (int) $p->bytes, 'mime' => $p->mime, 'created' => $p->created,
                    ]], ['id'], ['d', 'pose', 'file', 'bytes', 'mime', 'created']);
                    $count++;
                }
            }

            return ['subs' => count($subs), 'media' => count($media), 'photos' => $count, 'removed' => $removed];
        });
    }

    /**
     * What Node answered, per account, on the routes these tables serve — computed from the cleaned
     * rows — with Laravel's one deliberate change applied: the demo list is the caller's own coach's
     * (spec §5, ExerciseMedia::visibleTo), not every coach's. Also the rows the bytes are read back
     * through (HEAD), and whether a browser is subscribed.
     *
     * @return array{media: list<array>, photos: list<array>, hasPush: bool, heads: list<array{string, int}>}
     */
    public static function nodeAnswers(array $rows, User $u, string $dir): array
    {
        $visible = array_values(array_filter($rows['media'], fn (stdClass $m) => $u->isAdmin() || in_array($m->coachId, array_filter([$u->id, $u->coach_id]), true)));
        usort($visible, fn ($a, $b) => [$a->created, $a->id] <=> [$b->created, $b->id]);   // visibleTo's order
        $media = array_map(fn (stdClass $m) => [
            'id' => $m->id, 'exId' => $m->exId, 'file' => $m->file, 'label' => is_string($m->label ?? null) ? $m->label : '',
            'mime' => $m->mime, 'bytes' => (int) $m->bytes, 'status' => $m->status, 'created' => $m->created,
        ], $visible);
        $photos = array_map(fn (stdClass $p) => [
            'id' => $p->id, 'd' => $p->d, 'pose' => $p->pose, 'bytes' => (int) $p->bytes, 'mime' => $p->mime, 'created' => $p->created,
        ], $rows['photos'][$u->id] ?? []);
        // The status each read answers: 200 where the file is on disk, 404 where Node answered one.
        $there = fn (string $path) => is_file($dir.DIRECTORY_SEPARATOR.'media'.DIRECTORY_SEPARATOR.$path) ? 200 : 404;
        $heads = array_merge(
            array_map(fn (stdClass $m) => ['/api/media/ex?id='.rawurlencode($m->id), $there('ex'.DIRECTORY_SEPARATOR.$m->file)], $visible),
            array_map(fn (stdClass $p) => ['/api/media/photo?id='.rawurlencode($p->id), $there('photo'.DIRECTORY_SEPARATOR.Uid::safe($u->id).DIRECTORY_SEPARATOR.$p->file)], $rows['photos'][$u->id] ?? []),
        );

        return ['media' => $media, 'photos' => $photos, 'heads' => $heads,
            'hasPush' => collect($rows['subs'])->contains(fn (stdClass $s) => $s->userId === $u->id)];
    }

    /**
     * The VAPID pair Node signed with (DATA_DIR/vapid.json) against the one Laravel will use. A
     * push service refuses a message signed with any other key, so a mismatch silences every
     * browser that subscribed under Node. Reported, never written: keys stay out of the import.
     *
     * @return list<string> warnings
     */
    public static function vapidReport(string $dir): array
    {
        $raw = @file_get_contents($dir.DIRECTORY_SEPARATOR.'vapid.json');
        $node = is_string($raw) ? json_decode($raw, true) : null;
        if (! is_array($node) || ! is_string($node['publicKey'] ?? null)) {
            return ['no vapid.json in '.$dir.': browsers subscribed under Node cannot be reached by any other pair'];
        }
        $env = (string) config('fitpal.vapid.public');
        if ($env !== '') {
            return $env === $node['publicKey'] ? [] : ['VAPID_PUBLIC_KEY is not the pair in vapid.json: no browser subscribed under Node will receive a push. Set both VAPID keys to vapid.json\'s, or unset them so DATA_DIR/vapid.json is used.'];
        }
        $own = rtrim((string) config('fitpal.data_dir'), '/\\').DIRECTORY_SEPARATOR.'vapid.json';
        if (realpath($own) !== realpath($dir.DIRECTORY_SEPARATOR.'vapid.json')) {
            $mine = @file_get_contents($own);
            $theirs = is_string($mine) ? (json_decode($mine, true)['publicKey'] ?? null) : null;
            if ($theirs !== $node['publicKey']) {
                return ['DATA_DIR/vapid.json is not the pair in '.$dir.'/vapid.json: no browser subscribed under Node will receive a push. Point DATA_DIR at the Node data, or set the VAPID keys to that pair.'];
            }
        }

        return [];
    }

    /** A non-negative whole number of bytes. */
    private static function count(mixed $n): bool
    {
        return is_int($n) && $n >= 0;
    }

    /**
     * The text fields fit their columns (each a string, or absent where $optional says so).
     *
     * @param  array<string, int>  $widths
     * @param  list<string>  $optional
     */
    private static function fits(stdClass $row, array $widths, string $label, array &$skipped, array $optional = []): bool
    {
        foreach ($widths as $field => $width) {
            $v = $row->{$field} ?? null;
            if ($v === null && in_array($field, $optional, true)) {
                continue;
            }
            if (! is_string($v) || mb_strlen($v) > $width) {
                $skipped[] = "$label ($field is not text of at most $width characters)";

                return false;
            }
        }

        return true;
    }
}
