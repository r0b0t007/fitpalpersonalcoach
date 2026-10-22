<?php

namespace App\Console\Commands;

use App\Auth\Bootstrap;
use App\Auth\SessionToken;
use App\Media\Upload;
use Illuminate\Console\Command;

/**
 * The configuration mistakes the Node API printed at boot, as a command a deploy runs (and an
 * operator can run any time). PHP has no long-lived boot to print them at: a warning per request
 * would bury the log.
 */
final class CheckConfig extends Command
{
    protected $signature = 'fitpal:check-config';

    protected $description = 'Report configuration that will not behave as intended';

    public function handle(): int
    {
        $warnings = Bootstrap::warnings();
        if (! SessionToken::configured()) {
            $warnings[] = 'SESSION_SECRET is unset or shorter than '.SessionToken::MIN_SECRET_LENGTH.' characters — nobody can sign in. In production it is the contents of the old DATA_DIR/secret.';
        }
        // PHP refuses a body over post_max_size before Laravel runs, so a larger media cap is one
        // nobody can reach: uploads are capped at post_max_size instead (Upload::maxVideo).
        $post = Upload::postMax();
        if ($post !== null && (int) config('fitpal.media_max_video_mb') * 1048576 > $post) {
            $warnings[] = 'MEDIA_MAX_VIDEO_MB ('.config('fitpal.media_max_video_mb').') is above PHP\'s post_max_size ('.Upload::mb($post).' MB) — videos are capped at '.Upload::mb($post).' MB. Raise post_max_size (public/.user.ini, public/.htaccess) or lower the cap; keep both under Cloudflare\'s 100 MB.';
        }
        foreach ($warnings as $w) {
            $this->warn($w);
        }
        if ($warnings === []) {
            $this->info('configuration ok');
        }

        return $warnings === [] ? self::SUCCESS : self::FAILURE;
    }
}
