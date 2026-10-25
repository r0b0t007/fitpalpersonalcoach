<?php

namespace App\Console;

use App\Media\Sniff;
use App\Models\ExerciseMedia;
use App\Models\ProgressPhoto;
use App\Models\PushSubscription;
use App\Models\User;
use App\Push\Vapid;
use App\Support\Js;
use App\Support\Uid;
use Illuminate\Support\Facades\DB;
use stdClass;

/**
 * The media and push half of fitpal:import-legacy (R3): db.subs, db.media and each client's
 * progress photos (media-<uid>.json) — and, for --verify, what the Node API would have answered
 * from those files. The files themselves (media/ex, media/photo/<uid>) are not touched: Laravel
 * reads them where Node wrote them, under its DATA_DIR (dataDirReport says when that is not the
 * directory imported). The VAPID pair is only reported on (vapidReport): it lives in .env or in
 * DATA_DIR/vapid.json, and the import writes neither.
 *
 * As LegacyCoaching: one cleaning step (rows()) that both the import and the verify read, a row it
 * cannot store as Node served it skipped and reported, the few changes it makes on purpose
 * reported too (as `kept: …`), and the files the truth — rows they no longer hold are removed, so
 * run it only while Node is the live API. A photo sidecar that cannot be read leaves that client's
 * photos as they were.
 */
final class LegacyMedia
{
    /**
     * What is imported, cleaned: subscriptions and demos in file order, each client's photos in
     * date order (as Laravel lists them).
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
            if (! LegacyCoaching::fits($s, ['created' => [30, false]], $label, $skipped)) {
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
            if (! LegacyCoaching::fits($m, ['label' => [40, false], 'mime' => [64, true], 'status' => [16, true], 'created' => [30, true]], $label, $skipped)) {
                continue;
            }
            if (! self::count($m->bytes ?? null)) {
                $skipped[] = "$label (bytes is not a size)";

                continue;
            }
            if (! is_string($m->label ?? null)) {
                // Node sent no `label` for such a row; Laravel's demo always has one.
                $skipped[] = "kept: $label with no label, listed with an empty one";
            }
            if (! is_file($dir.DIRECTORY_SEPARATOR.'media'.DIRECTORY_SEPARATOR.'ex'.DIRECTORY_SEPARATOR.$m->file)) {
                $skipped[] = "kept: $label, whose file {$m->file} is not in media/ex (Node listed it too, and answered its bytes with a 404)";
            }
            $media[] = $m;
        }

        $bySafe = LegacyCoaching::bySafeUid($accounts);
        $photos = [];
        $ids = [];   // a photo id is one row across every client, as the table's key
        foreach (LegacyCoaching::files($dir, 'media-') as $uid => $file) {
            $owner = $bySafe[$uid] ?? null;
            if ($owner === null) {
                $skipped[] = basename($file).' (no such account)';

                continue;
            }
            // A torn copy removes nothing; JSON that holds no photo list is Node's "no photos"
            // (`Array.isArray(m && m.photos) ? m.photos : []`).
            [$read, $parsed] = LegacyCoaching::readJson($file);
            if (! $read) {
                $skipped[] = basename($file).' (cannot be read; these photos are left as they were)';
                $photos[$owner] = null;

                continue;
            }
            $kept = [];
            $slots = [];
            foreach ($parsed instanceof stdClass ? Js::list($parsed->photos ?? null) : [] as $p) {
                $pid = $p instanceof stdClass ? ($p->id ?? null) : null;
                $label = basename($file).' photo '.(is_string($pid) ? $pid : json_encode($pid));
                if (! is_string($pid) || $pid === '' || strlen($pid) > 16 || isset($ids[$pid])) {
                    $skipped[] = "$label (no usable id, or one another photo already has)";

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
                if (! LegacyCoaching::fits($p, ['mime' => [64, true], 'created' => [30, true]], $label, $skipped)) {
                    continue;
                }
                $ids[$pid] = $slots[$p->d."\n".$p->pose] = true;
                $kept[] = $p;
            }
            // Node wrote the sidecar sorted by date; one that is not (hand-edited, or older) Node
            // listed as it stood, Laravel lists by date. Stable, so a date's poses keep their order.
            $sorted = $kept;
            usort($sorted, fn (stdClass $a, stdClass $b) => strcmp($a->d, $b->d));
            if ($sorted !== $kept) {
                $skipped[] = 'kept: '.basename($file).'\'s photos, which are not in date order, listed by date';
            }
            $photos[$owner] = $sorted;
        }

        return ['subs' => $subs, 'media' => $media, 'photos' => $photos];
    }

    /**
     * Writes rows() in one transaction, mirror deletes included, as bulk upserts.
     *
     * @return array{subs: int, media: int, photos: int, removed: int}
     */
    public static function import(stdClass $db, string $dir, array $accounts, array &$skipped): array
    {
        $rows = self::rows($db, $dir, $accounts, $skipped);

        return DB::transaction(function () use ($rows): array {
            $removed = 0;

            $subs = array_map(fn (stdClass $s) => [
                'user_id' => $s->userId, 'endpoint' => $s->endpoint, 'endpoint_hash' => PushSubscription::hashOf($s->endpoint),
                'p256dh' => $s->keys->p256dh, 'auth' => $s->keys->auth, 'created' => is_string($s->created ?? null) ? $s->created : '',
            ], $rows['subs']);
            foreach (array_chunk($subs, 200) as $chunk) {
                PushSubscription::query()->upsert($chunk, ['endpoint_hash'], ['user_id', 'endpoint', 'p256dh', 'auth', 'created']);
            }
            $removed += self::deleteExcept(PushSubscription::query(), 'endpoint_hash', array_column($subs, 'endpoint_hash'));

            $media = array_map(fn (stdClass $m) => [
                'id' => $m->id, 'ex_id' => $m->exId, 'coach_id' => $m->coachId, 'file' => $m->file,
                'label' => is_string($m->label ?? null) ? $m->label : '', 'bytes' => (int) $m->bytes,
                'mime' => $m->mime, 'status' => $m->status, 'created' => $m->created,
            ], $rows['media']);
            foreach (array_chunk($media, 200) as $chunk) {
                ExerciseMedia::acrossCoaches()->upsert($chunk, ['id'], ['ex_id', 'coach_id', 'file', 'label', 'bytes', 'mime', 'status', 'created']); // across coaches: the import writes every coach's demos
            }
            $removed += self::deleteExcept(ExerciseMedia::acrossCoaches(), 'id', array_column($media, 'id')); // across coaches: the import mirrors every coach's demos

            // Photos: every client's, but for those whose sidecar could not be read (a client with
            // no sidecar has none: userPhotos answered []). Rows the files do not hold go first, so
            // a slot one of them held is free for the row that holds it now.
            $unread = array_keys(array_filter($rows['photos'], fn ($l) => $l === null));
            $photos = [];
            foreach ($rows['photos'] as $owner => $list) {
                foreach ($list ?? [] as $p) {
                    $photos[] = ['id' => $p->id, 'user_id' => (string) $owner, 'd' => $p->d, 'pose' => $p->pose, 'file' => $p->file,
                        'bytes' => (int) $p->bytes, 'mime' => $p->mime, 'created' => $p->created];
                }
            }
            $removed += self::deleteExcept(ProgressPhoto::query()->whereNotIn('user_id', $unread), 'id', array_column($photos, 'id'));
            // In order, and a row at a time per chunk: seq is the order a date's poses list in.
            foreach (array_chunk($photos, 200) as $chunk) {
                ProgressPhoto::query()->upsert($chunk, ['id'], ['user_id', 'd', 'pose', 'file', 'bytes', 'mime', 'created']);
            }

            return ['subs' => count($subs), 'media' => count($media), 'photos' => count($photos), 'removed' => $removed];
        });
    }

    /**
     * For --verify: the cleaned rows, grouped once, so each account's answers come from its own
     * slice rather than a rescan of every row per account.
     *
     * @return array{media: list<stdClass>, byCoach: array<string, list<stdClass>>, photos: array<string, ?list<stdClass>>, pushed: array<string, true>}
     */
    public static function verifyContext(stdClass $db, string $dir, array $accounts): array
    {
        $ignored = [];
        $rows = self::rows($db, $dir, $accounts, $ignored);
        $byCoach = [];
        foreach ($rows['media'] as $m) {
            $byCoach[$m->coachId][] = $m;
        }

        return ['media' => $rows['media'], 'byCoach' => $byCoach, 'photos' => $rows['photos'],
            'pushed' => array_fill_keys(array_map(fn (stdClass $s) => $s->userId, $rows['subs']), true)];
    }

    /**
     * What Node answered, per account, on the routes these tables serve — computed from the cleaned
     * rows — with Laravel's deliberate changes applied (the demo list is the caller's own coach's,
     * spec §5, in visibleTo's order; the import's `kept:` changes). Also the reads of every byte
     * stream (HEAD) with the status each answers, and whether a browser is subscribed.
     *
     * @return array{media: list<array>, photos: list<array>, hasPush: bool, heads: list<array{string, int}>}
     */
    public static function nodeAnswers(array $ctx, User $u, string $dir): array
    {
        $visible = $u->isAdmin() ? $ctx['media']
            : array_merge($ctx['byCoach'][$u->id] ?? [], $u->coach_id !== null && $u->coach_id !== $u->id ? ($ctx['byCoach'][$u->coach_id] ?? []) : []);
        usort($visible, fn ($a, $b) => [$a->created, $a->id] <=> [$b->created, $b->id]);
        $photos = $ctx['photos'][$u->id] ?? [];
        // 200 where the file is on disk, 404 where Node answered one.
        $there = fn (string $path) => is_file($dir.DIRECTORY_SEPARATOR.'media'.DIRECTORY_SEPARATOR.$path) ? 200 : 404;

        return [
            'media' => array_map(fn (stdClass $m) => [
                'id' => $m->id, 'exId' => $m->exId, 'file' => $m->file, 'label' => is_string($m->label ?? null) ? $m->label : '',
                'mime' => $m->mime, 'bytes' => (int) $m->bytes, 'status' => $m->status, 'created' => $m->created,
            ], $visible),
            'photos' => array_map(fn (stdClass $p) => [
                'id' => $p->id, 'd' => $p->d, 'pose' => $p->pose, 'bytes' => (int) $p->bytes, 'mime' => $p->mime, 'created' => $p->created,
            ], $photos),
            'heads' => array_merge(
                array_map(fn (stdClass $m) => ['/api/media/ex?id='.rawurlencode($m->id), $there('ex'.DIRECTORY_SEPARATOR.$m->file)], $visible),
                array_map(fn (stdClass $p) => ['/api/media/photo?id='.rawurlencode($p->id), $there('photo'.DIRECTORY_SEPARATOR.Uid::safe($u->id).DIRECTORY_SEPARATOR.$p->file)], $photos),
            ),
            'hasPush' => isset($ctx['pushed'][$u->id]),
        ];
    }

    /**
     * Laravel reads the demo and photo files under its own DATA_DIR. Importing a directory that is
     * not it (a copy, a backup) imports rows whose files Laravel will never find.
     *
     * @return list<string> warnings
     */
    public static function dataDirReport(string $dir): array
    {
        $own = (string) config('fitpal.data_dir');

        return realpath($own) === realpath($dir) ? [] : ["DATA_DIR ($own) is not $dir: the demos and photos imported here are read from DATA_DIR/media, and will answer 404 until their files are there"];
    }

    /**
     * The VAPID pair Node signed with (DATA_DIR/vapid.json) against the one Laravel will use — both
     * halves. A push service refuses a message signed with any other key, so a mismatch silences
     * every browser that subscribed under Node. Reported, never written.
     *
     * @return list<string> warnings
     */
    public static function vapidReport(string $dir): array
    {
        $node = self::pair($dir.DIRECTORY_SEPARATOR.'vapid.json');
        if ($node === null) {
            return ['no usable vapid.json in '.$dir.': browsers subscribed under Node cannot be reached by any other pair'];
        }
        $public = (string) config('fitpal.vapid.public');
        $private = (string) config('fitpal.vapid.private');
        if ($public !== '' || $private !== '') {
            return [$public, $private] === $node ? [] : ['VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are not the pair in vapid.json: no browser subscribed under Node will receive a push. Set both to vapid.json\'s, or unset both so DATA_DIR/vapid.json is used.'];
        }
        $own = rtrim((string) config('fitpal.data_dir'), '/\\').DIRECTORY_SEPARATOR.'vapid.json';

        return self::pair($own) === $node ? [] : ['DATA_DIR/vapid.json is not the pair in '.$dir.'/vapid.json: no browser subscribed under Node will receive a push. Point DATA_DIR at the Node data, or set the VAPID keys to that pair.'];
    }

    /** @return array{string, string}|null  [public, private], read as Vapid reads it at runtime */
    private static function pair(string $file): ?array
    {
        $keys = Vapid::read($file);

        return $keys === null ? null : [$keys['publicKey'], $keys['privateKey']];
    }

    /** Deletes the rows of $query whose $key is not one of $keep; how many went. */
    private static function deleteExcept($query, string $key, array $keep): int
    {
        $keep = array_flip($keep);
        $gone = array_values(array_filter((clone $query)->pluck($key)->all(), fn ($k) => ! isset($keep[$k])));
        $n = 0;
        foreach (array_chunk($gone, 500) as $chunk) {
            $n += (clone $query)->whereIn($key, $chunk)->delete();
        }

        return $n;
    }

    /** A non-negative whole number of bytes. */
    private static function count(mixed $n): bool
    {
        return is_int($n) && $n >= 0;
    }
}
