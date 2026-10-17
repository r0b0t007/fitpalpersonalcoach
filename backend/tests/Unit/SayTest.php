<?php

use App\Support\Say;

it('fills the template and remembers it for the envelope', function () {
    $text = Say::f('{0} already has {1} programs waiting', 'Nadia', 5);
    expect($text)->toBe('Nadia already has 5 programs waiting')
        ->and(Say::envelope($text))->toBe([
            'error' => 'Nadia already has 5 programs waiting',
            'msg' => ['k' => '{0} already has {1} programs waiting', 'v' => ['Nadia', 5]],
        ]);
});

it('leaves a plain sentence without a msg block, since the sentence itself is the key', function () {
    expect(Say::envelope('not signed in'))->toBe(['error' => 'not signed in']);
});

it('does not treat $ in a value as a replacement pattern', function () {
    expect(Say::f('training now · {0}', 'Legs $$ day'))->toBe('training now · Legs $$ day');
});

it('keeps a placeholder it has no value for', function () {
    expect(Say::f('a {0} b {1}', 'x'))->toBe('a x b {1}');
});

it('keeps at most 200 templates', function () {
    foreach (range(1, 250) as $i) {
        Say::f('n {0}', $i);
    }
    expect(Say::saidAs('n 1'))->toBeNull()->and(Say::saidAs('n 250'))->not->toBeNull();
});

it('evicts the sentence unused the longest, and keeps a numeric sentence findable', function () {
    $text = Say::f('{0} sets', 3);
    for ($i = 0; $i < 199; $i++) {
        Say::f('filler {0}', $i);
    }
    Say::f('{0} sets', 3);        // said again: it is the newest now
    Say::f('one more {0}', 1);    // 201st distinct: the oldest filler goes, not "3 sets"
    expect(Say::saidAs($text))->toBe(['k' => '{0} sets', 'v' => [3]])
        ->and(Say::saidAs('filler 0'))->toBeNull()
        ->and(Say::saidAs('filler 1'))->not->toBeNull();

    $n = Say::f('{0}', 7);
    for ($i = 0; $i < 205; $i++) {
        Say::f('more {0}', $i);
    }
    expect(Say::saidAs($n))->toBeNull()->and(Say::saidAs('more 204'))->not->toBeNull();
    Say::f('{0}', 7);
    expect(Say::saidAs('7'))->toBe(['k' => '{0}', 'v' => [7]]);
});
