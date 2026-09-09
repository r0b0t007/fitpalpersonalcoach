#!/usr/bin/env bash
# API smoke test for the coach role. Boots a throwaway instance, mints signed session cookies
# directly (same HMAC the server uses), and exercises every route including the refusals.
set -u
API="$(cd "$(dirname "$0")" && pwd)"
# Throwaway instance data goes to a temp dir, never inside the repo: this creates a `secret`
# and `vapid.json`, and a stray commit of those is exactly the sort of thing nobody notices.
D="${TMPDIR:-/tmp}/opengym-coach-smoke.$$"
PORT=3990
B="http://localhost:$PORT"
rm -rf "$D"; mkdir -p "$D"

cat > "$D/db.json" <<'JSON'
{"users":[
  {"id":"adminX","name":"Owner","admin":true,"created":"2026-01-01T00:00:00.000Z"},
  {"id":"coachA","name":"Coach A","coach":true,"created":"2026-01-01T00:00:00.000Z"},
  {"id":"coachB","name":"Coach B","coach":true,"created":"2026-01-01T00:00:00.000Z"},
  {"id":"mem1","name":"Mine","coachId":"coachA","created":"2026-01-01T00:00:00.000Z"},
  {"id":"mem2","name":"Theirs","coachId":"coachB","created":"2026-01-01T00:00:00.000Z"},
  {"id":"mem3","name":"Unassigned","created":"2026-01-01T00:00:00.000Z"},
  {"id":"mem4","name":"Disabled","coachId":"coachA","disabled":true,"created":"2026-01-01T00:00:00.000Z"}
],"creds":[],"subs":[],"invites":[],"requests":[],"sessions":[],"assignments":[]}
JSON

DATA_DIR="$D" PORT=$PORT RP_ID=localhost ORIGIN="http://localhost:$PORT" node "$API/server.js" > "$D/log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$D"' EXIT
# A server that never booted (missing dep, port taken, syntax error) otherwise shows up as every
# check failing at once, with the real cause buried under the wall of FAILs.
#
# Probing /api/health alone is not enough, and the port-taken case is exactly where it fails: if
# something else is already listening - a leftover server from an earlier run, or the app itself
# in another terminal - it answers the probe cheerfully while OUR node has died on EADDRINUSE.
# The run then reads the wrong instance, has no matching secret to sign cookies with, and
# degrades into the same wall of FAILs.
#
# `kill -0` is what catches that: the secret is written at module load, before listen(), so it
# exists even when the bind then fails. The -s test guards the narrower case of a DATA_DIR that
# is somehow not ours to read, and keeps the check honest if secret creation ever moves after
# listen(). --max-time keeps a wedged handler from stretching this loop: a readiness probe
# against localhost answers in milliseconds or not at all, and 30 iterations of a long timeout
# would outlast the job budget the workflows set.
ready() { kill -0 $SRV 2>/dev/null && [ -s "$D/secret" ] && curl -sf --max-time 2 "$B/api/health" >/dev/null 2>&1; }
for i in $(seq 1 30); do
  kill -0 $SRV 2>/dev/null || break   # it died; waiting the full 12s tells us nothing more
  ready && break
  sleep 0.4
done
ready || {
  echo "server did not start on $B - port taken, missing dependency, or a crash on boot"
  echo "--- server log ---"; tail -40 "$D/log"; exit 1; }

SECRET=$(cat "$D/secret")
cook() { node -e "
const c=require('crypto');
const p='$1:'+(Date.now()+86400000)+':0';
process.stdout.write('gymsid='+p+'.'+c.createHmac('sha256','$SECRET').update(p).digest('base64url'));
"; }
ADMIN=$(cook adminX); CA=$(cook coachA); CB=$(cook coachB); M1=$(cook mem1); M2=$(cook mem2)

pass=0; fail=0
chk() { # chk <label> <expected> <actual>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); printf "  ok    %-52s %s\n" "$1" "$3"
  else fail=$((fail+1)); printf "  FAIL  %-52s got %s want %s\n" "$1" "$3" "$2"; fi
}
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
get()  { curl -s "$@"; }

# Computed, not literal - a hardcoded date falls out of the GET /api/sessions window (7 days
# back) once the clock passes it, and this suite gates deploys. See the note in sessions-smoke.sh.
eval "$(node -e "
const d = new Date(); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate() + 120);
const at = n => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) };
process.stdout.write('C1=' + at(0) + '\nC2=' + at(7));
")"

BUNDLE='{"opengym_plan":1,"name":"Block A","week":{"1":"r1"},"routines":[{"id":"r1","name":"Push","emoji":"barbell","ex":[{"id":"0025","sets":4,"reps":8}]}],"customEx":[]}'
send() { curl -s -o /dev/null -w "%{http_code}" -X POST "$B/api/coach/assign" -H 'Content-Type: application/json' -H "Cookie: $1" -d "{\"memberIds\":$2,\"bundle\":$BUNDLE,\"note\":\"go\"}"; }

echo "== role gating =="
chk "member cannot list coach members"        403 "$(code -H "Cookie: $M1" "$B/api/coach/members")"
chk "anonymous cannot list coach members"     401 "$(code "$B/api/coach/members")"
chk "coach can list own members"              200 "$(code -H "Cookie: $CA" "$B/api/coach/members")"

echo "== roster scoping =="
echo "  coachA roster: $(get -H "Cookie: $CA" "$B/api/coach/members" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).members.map(m=>m.name).join(',')||'(none)'")"
echo "  admin roster : $(get -H "Cookie: $ADMIN" "$B/api/coach/members" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).members.length+' members'")"

echo "== reading a member =="
chk "coach reads own member"                  200 "$(code -H "Cookie: $CA" "$B/api/coach/member?id=mem1")"
chk "coach cannot read another coach's member" 403 "$(code -H "Cookie: $CA" "$B/api/coach/member?id=mem2")"
chk "coach cannot read unassigned member"     403 "$(code -H "Cookie: $CA" "$B/api/coach/member?id=mem3")"
chk "coach cannot read disabled member"       403 "$(code -H "Cookie: $CA" "$B/api/coach/member?id=mem4")"
chk "unknown id is 403 not 404 (no enumeration)" 403 "$(code -H "Cookie: $CA" "$B/api/coach/member?id=nope")"
chk "admin reads any member"                  200 "$(code -H "Cookie: $ADMIN" "$B/api/coach/member?id=mem2")"

# The roster scores adherence client-side (frontend/src/lib/adherence.js) from four fields the
# card carries. They are cheap -- the state is already read to build the card -- but they are
# also easy to drop in a refactor, and the failure is silent: the column just stops rendering.
chk "member card carries the adherence fields" "ok" "$(get -H "Cookie: $CA" "$B/api/coach/members" | node -pe "
  const a = JSON.parse(require('fs').readFileSync(0,'utf8')).members[0].adherence || {};
  ['week','dayPlan','routineIds','trainedDays'].every(k => k in a) ? 'ok' : 'missing: ' + JSON.stringify(a)")"
chk "opened member carries the plan to score against" "ok" "$(get -H "Cookie: $CA" "$B/api/coach/member?id=mem1" | node -pe "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  ('week' in d) && ('dayPlan' in d) ? 'ok' : 'missing'")"

echo "== assigning =="
chk "coach assigns to own member"             200 "$(send "$CA" '["mem1"]')"
chk "coach cannot assign to another's member" 403 "$(send "$CA" '["mem2"]')"
chk "coach cannot assign to disabled member"  403 "$(send "$CA" '["mem4"]')"
chk "mixed batch is refused wholesale"        403 "$(send "$CA" '["mem1","mem2"]')"
chk "empty member list refused"               400 "$(send "$CA" '[]')"
chk "junk bundle refused" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/coach/assign" -H 'Content-Type: application/json' -H "Cookie: $CA" -d '{"memberIds":["mem1"],"bundle":{"nope":1}}')"

echo "== the member's inbox =="
chk "member sees their offer"                   1 "$(get -H "Cookie: $M1" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.length")"
chk "another member sees nothing"               0 "$(get -H "Cookie: $M2" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.length")"
AID=$(get -H "Cookie: $M1" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments[0].id")
dec() { curl -s -o /dev/null -w "%{http_code}" -X POST "$B/api/assignments/decide" -H 'Content-Type: application/json' -H "Cookie: $1" -d "{\"id\":\"$AID\",\"accept\":$2}"; }
chk "a different member cannot decide it"     404 "$(dec "$M2" true)"
chk "the coach cannot decide it either"       404 "$(dec "$CA" true)"
chk "the member accepts"                      200 "$(dec "$M1" true)"
chk "accepting twice is refused"              409 "$(dec "$M1" true)"
chk "inbox is empty once decided"               0 "$(get -H "Cookie: $M1" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.length")"

echo "== the server must NOT have touched member state =="
chk "no state file written for the member"   none "$([ -f "$D/state-mem1.json" ] && echo written || echo none)"

echo "== pending cap =="
for i in 1 2 3 4 5 6; do R=$(send "$CA" '["mem1"]'); done
chk "6th pending offer is throttled"          429 "$R"

echo "== admin role controls =="
chk "admin grants coach"                      200 "$(code -X POST "$B/api/admin/user/coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"mem3","coach":true}')"
chk "coach cannot grant coach"                403 "$(code -X POST "$B/api/admin/user/coach" -H 'Content-Type: application/json' -H "Cookie: $CA" -d '{"id":"mem3","coach":true}')"
chk "admin assigns a coach"                   200 "$(code -X POST "$B/api/admin/user/assign-coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"mem3","coachId":"coachA"}')"
chk "cannot assign a non-coach as coach"      400 "$(code -X POST "$B/api/admin/user/assign-coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"mem1","coachId":"mem2"}')"
chk "cannot be your own coach"                400 "$(code -X POST "$B/api/admin/user/assign-coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"mem3","coachId":"mem3"}')"

echo "== revoking coach clears their roster =="
curl -s -o /dev/null -X POST "$B/api/admin/user/coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"coachA","coach":false}'
chk "coachA's members were unlinked"            0 "$(get -H "Cookie: $ADMIN" "$B/api/admin/users" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).users.filter(u=>u.coachId==='coachA').length")"
chk "the ex-coach can no longer list members"  403 "$(code -H "Cookie: $CA" "$B/api/coach/members")"

echo "== /api/me exposes the role =="
chk "coachB reports coach:true"              true "$(get -H "Cookie: $CB" "$B/api/me" | node -pe "String(JSON.parse(require('fs').readFileSync(0,'utf8')).user.coach)")"
chk "mem2 reports coach:false"               false "$(get -H "Cookie: $M2" "$B/api/me" | node -pe "String(JSON.parse(require('fs').readFileSync(0,'utf8')).user.coach)")"
chk "mem2 is told who their coach is"    "Coach B" "$(get -H "Cookie: $M2" "$B/api/me" | node -pe "String(JSON.parse(require('fs').readFileSync(0,'utf8')).user.coachName)")"

echo "== a stale offer must not outlive the relationship =="
# The bug: an offer stayed pending after the member moved to another coach, so it could still be
# accepted with the ex-coach's name on it -- and it kept consuming the 5-slot pending cap.
curl -s -o /dev/null -X POST "$B/api/admin/user/coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"coachA","coach":true}'
curl -s -o /dev/null -X POST "$B/api/admin/user/assign-coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"mem3","coachId":"coachA"}'
CA=$(cook coachA); M3=$(cook mem3)
chk "coachA sends mem3 a program"             200 "$(send "$CA" '["mem3"]')"
chk "mem3 has it pending"                       1 "$(get -H "Cookie: $M3" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.length")"
curl -s -o /dev/null -X POST "$B/api/admin/user/assign-coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"mem3","coachId":"coachB"}'
chk "moving them to coachB retires the offer"   0 "$(get -H "Cookie: $M3" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.length")"
chk "...so the new coach is not blocked"      200 "$(send "$(cook coachB)" '["mem3"]')"

echo "== withdrawing a program sent by mistake =="
WID=$(get -H "Cookie: $M3" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments[0].id")
wd() { curl -s -o /dev/null -w "%{http_code}" -X POST "$B/api/coach/assignments/withdraw" -H 'Content-Type: application/json' -H "Cookie: $1" -d "{\"id\":\"$WID\"}"; }
chk "another coach cannot withdraw it"        404 "$(wd "$CA")"
chk "someone with no coach role at all is 403" 403 "$(wd "$M1")"
chk "the sending coach can"                   200 "$(wd "$(cook coachB)")"
chk "it leaves the member's inbox"              0 "$(get -H "Cookie: $M3" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.length")"
chk "withdrawing twice is refused"            409 "$(wd "$(cook coachB)")"

echo "== the coach can finally see what happened =="
chk "roster reports a pending count"            1   "$(send "$(cook coachB)" '["mem3"]' >/dev/null; get -H "Cookie: $(cook coachB)" "$B/api/coach/members" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));(d.members.find(m=>m.id==='mem3')||{}).pending.length")"
AID2=$(get -H "Cookie: $M3" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments[0].id")
curl -s -o /dev/null -X POST "$B/api/assignments/decide" -H 'Content-Type: application/json' -H "Cookie: $M3" -d "{\"id\":\"$AID2\",\"accept\":false}"
chk "a decline is now visible to the coach" declined   "$(get -H "Cookie: $(cook coachB)" "$B/api/coach/members" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String(((d.members.find(m=>m.id==='mem3')||{}).lastDecision||{}).status)")"

echo "== disabling a coach must do what revoking the role does =="
# It used to only lock the account: the roster still pointed at them and their pending programs
# stayed acceptable, while the admin dropdown dropped them -- so those members rendered as
# "no coach" while still assigned, with live offers. Invisible and wrong.
curl -s -o /dev/null -X POST "$B/api/admin/user/coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"coachB","coach":true}'
curl -s -o /dev/null -X POST "$B/api/admin/user/assign-coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"mem3","coachId":"coachB"}'
CB2=$(cook coachB); M3B=$(cook mem3)
chk "coachB sends mem3 a program"             200 "$(send "$CB2" '["mem3"]')"
chk "mem3 has it pending"                       1 "$(get -H "Cookie: $M3B" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.length")"
DIS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$B/api/admin/user/disable" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"coachB","disabled":true}')
chk "admin disables the coach"                200 "$DIS"
chk "their roster is unassigned"                0   "$(get -H "Cookie: $ADMIN" "$B/api/admin/users" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).users.filter(u=>u.coachId==='coachB').length")"
chk "the pending offer is gone"                 0 "$(get -H "Cookie: $M3B" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.length")"
chk "the disabled coach cannot list members"  401 "$(code -H "Cookie: $CB2" "$B/api/coach/members")"
curl -s -o /dev/null -X POST "$B/api/admin/user/disable" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"coachB","disabled":false}'
chk "re-enabling does not resurrect the roster" 0   "$(get -H "Cookie: $ADMIN" "$B/api/admin/users" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).users.filter(u=>u.coachId==='coachB').length")"

echo "== revoking an invite keeps the record =="
NEW=$(curl -s -X POST "$B/api/admin/invites/new" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"note":"for Sara"}')
NCODE=$(echo "$NEW" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).invite.code")
chk "the note is stored"               "for Sara"   "$(get -H "Cookie: $ADMIN" "$B/api/admin/invites" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String((d.invites.find(i=>i.code===process.argv[1])||{}).note)" "$NCODE")"
curl -s -o /dev/null -X POST "$B/api/admin/invites/revoke" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d "{\"code\":\"$NCODE\"}"
chk "the row survives, flagged revoked"      true   "$(get -H "Cookie: $ADMIN" "$B/api/admin/invites" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String(!!(d.invites.find(i=>i.code===process.argv[1])||{}).revoked)" "$NCODE")"

echo "== a disabled coach cannot be attached to anything =="
curl -s -o /dev/null -X POST "$B/api/admin/user/disable" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"coachB","disabled":true}'
chk "assign-coach refuses a disabled coach"   400   "$(code -X POST "$B/api/admin/user/assign-coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"mem3","coachId":"coachB"}')"
chk "a class cannot be given to one either"   400   "$(code -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"session":{"title":"X","date":"'"$C1"'","time":"10:00","coachId":"coachB"},"confirm":true}')"
curl -s -o /dev/null -X POST "$B/api/admin/user/disable" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"coachB","disabled":false}'

echo "== a disabled coach is unnamed on the timetable, but the class keeps its assignment =="
# Deleting coachId off every future occurrence would be unrecoverable, and disabling is often
# temporary. So the assignment survives and only the DISPLAY and the push respect eligibility.
curl -s -o /dev/null -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN"   -d '{"session":{"title":"Spin with B","date":"'"$C2"'","time":"10:00","room":"Studio 4","coachId":"coachB"},"confirm":true}'
chk "while active, the class names them"  "Coach B"   "$(curl -s "$B/api/sessions" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String((d.sessions.find(s=>s.title===process.argv[1])||{}).coachName)" 'Spin with B')"
curl -s -o /dev/null -X POST "$B/api/admin/user/disable" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"coachB","disabled":true}'
chk "disabled: members are shown no coach"      ""   "$(curl -s "$B/api/sessions" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String((d.sessions.find(s=>s.title===process.argv[1])||{}).coachName)" 'Spin with B')"
chk "...but the assignment is NOT destroyed"  true   "$(curl -s "$B/api/sessions" -H "Cookie: $ADMIN" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String((d.sessions.find(s=>s.title===process.argv[1])||{}).coachId===process.argv[2])" 'Spin with B' coachB)"
chk "editing that class does not force a swap" true   "$(curl -s -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"session":{"id":"'"$(curl -s "$B/api/sessions" -H "Cookie: $ADMIN" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));(d.sessions.find(s=>s.title===process.argv[1])||{}).id" 'Spin with B')"'","title":"Spin with B","date":"'"$C2"'","time":"10:30","room":"Studio 4","coachId":"coachB"},"confirm":true}' | node -pe "String(JSON.parse(require('fs').readFileSync(0,'utf8')).ok===true)")"
curl -s -o /dev/null -X POST "$B/api/admin/user/disable" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"coachB","disabled":false}'
chk "re-enabling restores the name"       "Coach B"   "$(curl -s "$B/api/sessions" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String((d.sessions.find(s=>s.title===process.argv[1])||{}).coachName)" 'Spin with B')"

echo ""
echo "passed $pass, failed $fail"
[ "$fail" = "0" ] || { echo "--- server log ---"; tail -20 "$D/log"; }
exit $fail
