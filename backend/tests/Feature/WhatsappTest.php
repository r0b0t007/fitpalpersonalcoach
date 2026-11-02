<?php

// WhatsApp buttons (CHW-341): a client reads their own coach's page number with who they are, and
// a coach reads the number a client gave with their request on that client's page. Each only
// their own: another coach's page or another coach's request says nothing.

use App\Models\CoachPage;
use App\Models\JoinRequest;
use Tests\Support\Coaching;

beforeEach(function () {
    config(['fitpal.session_secret' => str_repeat('ab', 32)]);
    $this->f = Coaching::twoCoaches();
});

function waPage(object $coach, string $whatsapp, string $handle): CoachPage
{
    return Coaching::own(new CoachPage, $coach, ['handle' => $handle, 'bio' => '', 'whatsapp' => $whatsapp, 'open' => true, 'theme' => 'dark', 'created' => 1, 'updated' => 1]);
}

function waRequest(object $coach, object $member, string $status, string $phone, int $decided): JoinRequest
{
    return Coaching::own(new JoinRequest, $coach, [
        'id' => JoinRequest::newId(), 'email' => 'x'.$decided.'@example.com', 'name' => $member->name, 'member_id' => $member->id, 'status' => $status,
        'intake' => json_encode(['goal' => 'strength', 'level' => 'beginner', 'days' => 3, 'injuries' => '', 'equipment' => [], 'phone' => $phone, 'consent_at' => 1]),
        'created' => 1, 'decided' => $decided,
    ]);
}

it("gives a client their own coach's number, and nothing when the coach has none", function () {
    waPage($this->f->b, '34612345678', 'coach.b');
    $this->getJson('/api/me', bearer($this->f->a1))->assertOk()->assertJsonPath('user.coachWhatsapp', '');
    waPage($this->f->a, '212612345678', 'coach.a');
    $this->getJson('/api/me', bearer($this->f->a1))->assertOk()->assertJsonPath('user.coachWhatsapp', '212612345678');
    $this->getJson('/api/me', bearer($this->f->b1))->assertOk()->assertJsonPath('user.coachWhatsapp', '34612345678');
    $this->getJson('/api/me', bearer($this->f->u1))->assertOk()->assertJsonPath('user.coachWhatsapp', '');
});

it('gives the coach the number a client asked with: the newest accepted request, their own', function () {
    $this->getJson('/api/coach/member?id='.$this->f->a1->id, bearer($this->f->a))->assertOk()->assertJsonPath('phone', '');
    waRequest($this->f->a, $this->f->a1, 'accepted', '212600000001', 10);
    waRequest($this->f->a, $this->f->a1, 'accepted', '212600000002', 20);
    waRequest($this->f->a, $this->f->a1, 'pending', '212600000003', 30);
    waRequest($this->f->b, $this->f->a1, 'accepted', '34600000004', 40);   // another coach's: not A's to read
    $this->getJson('/api/coach/member?id='.$this->f->a1->id, bearer($this->f->a))->assertOk()->assertJsonPath('phone', '212600000002');
});

it('says nothing for a request that gave no number', function () {
    waRequest($this->f->a, $this->f->a1, 'accepted', '', 10);
    $this->getJson('/api/coach/member?id='.$this->f->a1->id, bearer($this->f->a))->assertOk()->assertJsonPath('phone', '');
});
