<?php

// Asking to join a coach (CHW-336, spec §3, §3.0, §3.2): the intake, the emailed code, and a
// pending request — with no account and no seat until the coach accepts (CHW-337).

use App\Coaching\Intake;
use App\Support\ClientSafe;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32), 'fitpal.origin' => 'https://coach.example', 'fitpal.free_cap' => 0]);
    $this->f = Coaching::twoCoaches();
});

function intake(array $over = []): array
{
    return $over + ['goal' => 'strength', 'level' => 'beginner', 'days' => 3, 'injuries' => '', 'equipment' => ['gym'], 'phone' => '', 'consent' => true];
}

it('keeps the intake to what the form offers, and stamps the consent', function () {
    $i = Intake::from((object) intake(['injuries' => '  Genou droit  ', 'equipment' => ['gym', 'home', 'gym', 'rocket'], 'phone' => '+212 612 345 678']));
    expect($i)->toMatchArray(['goal' => 'strength', 'level' => 'beginner', 'days' => 3, 'injuries' => 'Genou droit', 'equipment' => ['gym', 'home'], 'phone' => '212612345678'])
        ->and($i['consent_at'])->toBeInt();
});

it('says what is missing from an intake', function (array $over, string $error) {
    expect(fn () => Intake::from((object) intake($over)))->toThrow(ClientSafe::class, $error);
})->with([
    'no goal' => [['goal' => 'fly'], 'tell us your goal, level and days a week'],
    'no level' => [['level' => ''], 'tell us your goal, level and days a week'],
    'days out of range' => [['days' => 9], 'tell us your goal, level and days a week'],
    'days as text' => [['days' => '3'], 'tell us your goal, level and days a week'],
    'no consent' => [['consent' => false], 'please agree to share your answers with your coach'],
    'bad phone' => [['phone' => '0612345678'], 'that is not a phone number — include the country code'],
    'long injuries' => [['injuries' => str_repeat('a', 501)], 'tell us your goal, level and days a week'],
]);

it('refuses an intake that is not an object', function () {
    expect(fn () => Intake::from('nope'))->toThrow(ClientSafe::class, 'tell us your goal, level and days a week');
});
