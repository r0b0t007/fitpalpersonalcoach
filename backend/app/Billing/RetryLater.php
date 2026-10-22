<?php

namespace App\Billing;

use RuntimeException;

/**
 * A Creem event that cannot be placed yet (CreemEvent::row): the webhook answers 503, its
 * transaction — the recorded event id with it — rolls back, and Creem's retry is applied afresh.
 */
final class RetryLater extends RuntimeException {}
