<?php

namespace App\Http;

use Illuminate\Http\Request as BaseRequest;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;

/**
 * Laravel's request, except that the JSON API's bodies are not decoded at capture.
 *
 * Illuminate's createFromBase() json-decodes every JSON request into PHP arrays the moment it is
 * captured, before any middleware or route runs. The API never reads them: every route reads the
 * body as sent, once, through App\Support\Input (as Node's readBody did), and its query through
 * Input::searchParam. So the eager decode is pure cost — and for the state sync, up to 16 MB of
 * it, which ran a 15.9 MB sync out of memory at 128M on the host (CHW-227); on an anonymous
 * sign-in route it decoded a body of any size before Input::body could answer 413.
 *
 * The admin panel (Filament and its Livewire endpoint, R4) is the exception: it reads input() and
 * keeps Laravel's request as it is. Anything that does call input() on an API route still gets
 * the decoded body: json() decodes lazily.
 */
final class Request extends BaseRequest
{
    public static function createFromBase(SymfonyRequest $request): static
    {
        if (! self::isJsonApi($request)) {
            return parent::createFromBase($request);
        }

        // parent::createFromBase() without the eager JSON decode.
        $new = new self(
            $request->query->all(), $request->request->all(), $request->attributes->all(),
            $request->cookies->all(), (new self)->filterFiles($request->files->all()) ?? [], $request->server->all()
        );
        $new->headers->replace($request->headers->all());
        $new->content = $request->content;

        return $new;
    }

    /**
     * Whether a request is the app's JSON API — everything but the admin panel. Laravel's global
     * input cleaners (TrimStrings, ConvertEmptyStringsToNull) skip the same requests, by this test
     * (bootstrap/app.php): they would decode and walk every body only to change nothing anyone reads.
     */
    public static function isJsonApi(SymfonyRequest $request): bool
    {
        // Both mounts: /…, and /api/… when the front controller is not mounted at /api.
        $path = ltrim($request->getPathInfo(), '/');
        $path = str_starts_with($path, 'api/') ? substr($path, 4) : $path;

        return ! preg_match('#^(admin-panel|livewire)(/|$)#', $path);
    }
}
