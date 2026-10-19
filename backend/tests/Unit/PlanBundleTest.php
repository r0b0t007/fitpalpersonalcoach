<?php

// api/domain.test.mjs's cases for validateAssignmentBundle and cleanProgram, ported. Inputs are
// JSON text decoded the way the controllers decode a body: objects as stdClass.

use App\Coaching\PlanBundle;
use App\Support\ClientSafe;

function plan(array $over = []): stdClass
{
    // $over first: + keeps the LEFT operand's keys.
    return json_decode(json_encode($over + ['opengym_plan' => 1, 'name' => 'Block A', 'week' => ['1' => ['r1']],
        'routines' => [['id' => 'r1', 'name' => 'Push', 'ex' => [['id' => '0025', 'sets' => 3]]]], 'customEx' => []]));
}

/** The refusal's message, or null when the bundle passes. */
function refusal(mixed $raw): ?string
{
    try {
        PlanBundle::validate($raw);

        return null;
    } catch (ClientSafe $e) {
        expect($e->status)->toBe(400);

        return $e->getMessage();
    }
}

it('accepts a real bundle and strips unknown top-level keys', function () {
    $out = PlanBundle::validate(plan(['evil' => 'x', 'workouts' => [1, 2, 3]]));
    expect(array_keys(get_object_vars($out)))->toEqualCanonicalizing(['customEx', 'name', 'opengym_plan', 'routines', 'week'])
        ->and($out->name)->toBe('Block A');
});

it('rejects junk, empty and malformed plans, with Node\'s words', function () {
    foreach ([null, 'nope', []] as $bad) {
        expect(refusal($bad))->toBe('plan required');
    }
    expect(refusal(json_decode('{}')))->toBe('not a plan bundle')   // an object, without the marker
        ->and(refusal(json_decode('{"x":1}')))->toBe('not a plan bundle')
        ->and(refusal(json_decode('{"opengym_plan":1}')))->toBe('plan has no routines')
        ->and(refusal(plan(['routines' => []])))->toBe('plan has no routines')
        ->and(refusal(plan(['routines' => [['id' => 'r1']]])))->toBe('malformed routine')           // no ex array
        ->and(refusal(plan(['routines' => [['ex' => []]]])))->toBe('malformed routine')             // no id
        ->and(refusal(plan(['routines' => [[]]])))->toBe('malformed routine')                       // an array is no routine
        ->and(refusal(plan(['routines' => [['id' => 'r', 'ex' => [[]]]]])))->toBe('malformed exercise');
});

it('enforces the size caps', function () {
    $many = array_map(fn ($i) => ['id' => "r$i", 'ex' => []], range(0, 20));
    expect(refusal(plan(['routines' => $many])))->toBe('too many routines (max 20)');
    $fat = [['id' => 'r1', 'ex' => array_fill(0, 61, ['id' => '0025'])]];
    expect(refusal(plan(['routines' => $fat])))->toBe('a routine has more than 60 exercises')
        ->and(refusal(plan(['name' => str_repeat('x', 200_000)])))->toBe('plan is too large')
        ->and(refusal(plan(['customEx' => array_fill(0, 101, ['id' => 'c'])])))->toBe('too many custom exercises');
});

it('carries optional nutrition targets, and only the ones that were set', function () {
    $out = PlanBundle::validate(plan(['nutrition' => ['kcal' => 2200, 'p' => 170, 'note' => '  rest days  ']]));
    expect((array) $out->nutrition)->toBe(['kcal' => 2200, 'p' => 170, 'note' => 'rest days'])
        ->and(PlanBundle::validate(plan(['nutrition' => ['kcal' => 2200.6]]))->nutrition->kcal)->toBe(2201)
        ->and(PlanBundle::validate(plan(['nutrition' => ['kcal' => '2200']]))->nutrition->kcal)->toBe(2200)   // +"2200"
        ->and(mb_strlen(PlanBundle::validate(plan(['nutrition' => ['kcal' => 2200, 'note' => str_repeat('x', 500)]]))->nutrition->note))->toBe(280);
});

it('omits the nutrition key entirely when there is nothing to send', function () {
    foreach ([null, [], ['note' => 'eat well'], ['kcal' => 0, 'p' => 0]] as $none) {
        $raw = plan(['nutrition' => $none]);
        if ($none === []) {
            $raw->nutrition = new stdClass;   // {} — an empty PHP array would encode as []
        }
        expect(property_exists(PlanBundle::validate($raw), 'nutrition'))->toBeFalse();
    }
});

it('refuses nutrition it cannot use, rather than dropping it quietly', function () {
    expect(refusal(plan(['nutrition' => []])))->toBe('nutrition targets are malformed')
        ->and(refusal(plan(['nutrition' => 'nope'])))->toBe('nutrition targets are malformed')
        ->and(refusal(plan(['nutrition' => ['kcal' => 'lots']])))->toBe('calories must be a number between 0 and 20000')
        ->and(refusal(plan(['nutrition' => ['kcal' => -1]])))->toBe('calories must be a number between 0 and 20000')
        ->and(refusal(plan(['nutrition' => ['kcal' => 20001]])))->toBe('calories must be a number between 0 and 20000')
        ->and(refusal(plan(['nutrition' => ['p' => 2001]])))->toBe('protein must be a number between 0 and 2000 g')
        ->and(refusal(plan(['nutrition' => ['c' => 'x']])))->toBe('carbs must be a number between 0 and 2000 g')
        ->and(refusal(plan(['nutrition' => ['f' => -5]])))->toBe('fat must be a number between 0 and 2000 g');
});

it('lets a coach move the check-in day, with Sunday a real choice, and nothing when unsaid', function () {
    foreach ([0, 3, 6, '4', 5.0] as $day) {
        expect(PlanBundle::validate(plan(['checkinDay' => $day]))->checkinDay)->toBe((int) $day);
    }
    foreach ([null, ''] as $none) {
        expect(property_exists(PlanBundle::validate(plan(['checkinDay' => $none])), 'checkinDay'))->toBeFalse();
    }
    foreach ([7, -1, 1.5, 'monday', [], [5], true, false] as $bad) {
        expect(refusal(plan(['checkinDay' => $bad])))->toBe('check-in day must be a weekday, 0 (Sunday) to 6');
    }
    $obj = plan();
    $obj->checkinDay = new stdClass;
    expect(refusal($obj))->toBe('check-in day must be a weekday, 0 (Sunday) to 6');
});

it('keeps an empty week an object, and rebuilds a bad one as {}', function () {
    expect(json_encode(PlanBundle::validate(json_decode('{"opengym_plan":1,"week":{},"routines":[{"id":"r","ex":[]}]}'))->week))->toBe('{}')
        ->and(json_encode(PlanBundle::validate(plan(['week' => [1, 2]]))->week))->toBe('{}');
});

it('needs a program name, trims and caps it, and writes it over the bundle\'s', function () {
    $name = fn ($n) => PlanBundle::program($n, plan(['name' => 'stale']));
    expect(fn () => $name(null))->toThrow(ClientSafe::class, 'program needs a name')
        ->and(fn () => $name('   '))->toThrow(ClientSafe::class, 'program needs a name')
        ->and(fn () => PlanBundle::program('Block A', null))->toThrow(ClientSafe::class, 'plan required');
    [$n, $bundle] = $name('  Block A  ');
    expect($n)->toBe('Block A')->and($bundle->name)->toBe('Block A')
        ->and(mb_strlen($name(str_repeat('x', 100))[0]))->toBe(60)
        ->and($name(0)[0])->toBe('0');   // String(0), not "no name"
});
