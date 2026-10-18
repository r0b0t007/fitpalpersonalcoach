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
     * Scoped instances are forgotten on both sides of the request — CoachContext above all. In
     * production a request starts with an empty one and its context dies with it: a request must
     * not inherit the coach a previous one acted as, and neither must the test's own assertions
     * after it, which would otherwise be silently scoped to that coach.
     */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();
        $this->app->forgetScopedInstances();
        try {
            return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
        } finally {
            $this->app->forgetScopedInstances();
        }
    }
}
