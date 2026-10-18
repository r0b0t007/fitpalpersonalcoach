<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Every request resolves its caller afresh. Laravel's RequestGuard caches the user it found,
     * and one test here plays several requests as different people (sign in, sign out everywhere,
     * try the old token); without this the second request would see the first one's user.
     *
     * Scoped instances are forgotten too — CoachContext above all: in production every request
     * starts with an empty one, and a test must not inherit the coach a previous request acted as.
     */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();
        $this->app->forgetScopedInstances();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }
}
