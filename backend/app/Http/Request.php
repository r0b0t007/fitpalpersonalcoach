<?php

namespace App\Http;

use Illuminate\Http\Request as BaseRequest;
use Symfony\Component\HttpFoundation\Request as SymfonyRequest;

/**
 * Laravel's request, except that the state sync body is not decoded at capture.
 *
 * Illuminate's createFromBase() json-decodes every JSON request into PHP arrays the moment it is
 * captured, before any middleware or route runs. For `PUT /api/data` that is up to 16 MB decoded
 * into arrays nobody reads: DataController takes the raw body and decodes it once, into objects,
 * so `{}` stays `{}`. On the host that extra decode is what ran a 15.9 MB sync out of memory at
 * 128M (CHW-227). The app's request is unchanged; it still says application/json.
 *
 * Anything that calls input() on this route still gets the decoded body: json() decodes lazily.
 */
final class Request extends BaseRequest
{
    public static function createFromBase(SymfonyRequest $request): static
    {
        if (! self::isStateSync($request)) {
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

    private static function isStateSync(SymfonyRequest $request): bool
    {
        // Both mounts: /api/data, and /data when a proxy strips the prefix (routes/api.php).
        return $request->getMethod() === 'PUT' && in_array(rtrim($request->getPathInfo(), '/'), ['/api/data', '/data'], true);
    }
}
