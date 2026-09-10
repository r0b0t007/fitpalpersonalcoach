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
],"creds":[],"subs":[],"invites":[],"requests":[],"sessions":[],"assignments":[],
"media":[{"id":"brokenrow","exId":"0099","coachId":"coachA","mime":"video/mp4","status":"ready"}]}
JSON
# That media row has no `file`, on purpose, and is seeded here rather than injected later because
# the server holds db.json in memory — a row written to the file after boot is never seen. It is
# the hand-edited/truncated row the serving route's guard exists for.

# MEDIA_MAX_VIDEO_MB=1 so the over-the-cap path can be exercised with a 2 MB fixture instead of a
# 91 MB one. The cap being env-driven is what makes that possible, and testing it matters: it is
# the branch where a partial file is already on disk when the refusal happens.
DATA_DIR="$D" PORT=$PORT RP_ID=localhost ORIGIN="http://localhost:$PORT" MEDIA_MAX_VIDEO_MB=1 node "$API/server.js" > "$D/log" 2>&1 &
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
  ['week','dayPlan','routineIds','trainedDays','created'].every(k => k in a) ? 'ok' : 'missing: ' + JSON.stringify(a)")"
# The join date clamps the near end of the window client-side. Drop it and every member added
# this month is scored against the weeks before they existed and painted red on the roster.
chk "member card carries the join date to clamp on" "ok" "$(get -H "Cookie: $CA" "$B/api/coach/members" | node -pe "
  const m = JSON.parse(require('fs').readFileSync(0,'utf8')).members[0];
  m.adherence.created === m.created ? 'ok' : 'got ' + JSON.stringify(m.adherence.created)")"
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

echo "== nutrition targets on the bundle =="
# The targets ride on the plan bundle rather than a route of their own: anything the SERVER writes
# into state-<uid>.json is destroyed by that member's next whole-state push, so the accept flow is
# the only channel a target survives. These checks are here because that reuse is easy to break by
# adding the "obvious" endpoint later.
nsend() { curl -s -o /dev/null -w "%{http_code}" -X POST "$B/api/coach/assign" -H 'Content-Type: application/json' -H "Cookie: $CA" -d "{\"memberIds\":[\"mem1\"],\"bundle\":$(node -pe "
  const b = JSON.parse(process.argv[1]); b.nutrition = JSON.parse(process.argv[2]); JSON.stringify(b)" "$BUNDLE" "$1")}"; }
chk "a bundle with targets is accepted"       200 "$(nsend '{"kcal":2200,"p":170,"note":"rest days"}')"
chk "targets that are not numbers are refused" 400 "$(nsend '{"kcal":"lots"}')"
chk "an absurd target is refused"             400 "$(nsend '{"kcal":999999}')"
chk "the member is offered exactly what was set" '{"kcal":2200,"p":170,"note":"rest days"}' "$(get -H "Cookie: $M1" "$B/api/assignments" | node -pe "
  const a = JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.find(x => x.bundle.nutrition);
  JSON.stringify(a.bundle.nutrition)")"
# Carbs and fat were never set, so they must not come back as 0 — a target nobody wrote is worse
# on a client's screen than no target at all.
chk "unset macros are absent, not zero"      true "$(get -H "Cookie: $M1" "$B/api/assignments" | node -pe "
  const n = JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.find(x => x.bundle.nutrition).bundle.nutrition;
  String(!('c' in n) && !('f' in n))")"
# Withdraw them again so the inbox checks below start from the one offer they expect.
for W in $(get -H "Cookie: $M1" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.map(a=>a.id).join(' ')"); do
  curl -s -o /dev/null -X POST "$B/api/coach/assignments/withdraw" -H 'Content-Type: application/json' -H "Cookie: $CA" -d "{\"id\":\"$W\"}"
done
chk "inbox is clear again before the next block" 0 "$(get -H "Cookie: $M1" "$B/api/assignments" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).assignments.length")"
chk "coach assigns to own member (again)"     200 "$(send "$CA" '["mem1"]')"

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

echo "== the state sync cap answers in JSON, not by hanging up =="
# Over MAX_BODY, readBody used to reject with a bare Error AND destroy the request in the same
# breath: the 500 went to a dead socket, the client saw a connection reset, pushState swallowed
# it and the profile stopped syncing forever with nothing on screen. It must be a readable 413.
node -e "
const fs=require('fs');
fs.writeFileSync(process.argv[1], JSON.stringify({state:{pad:'x'.repeat(17*1024*1024)}}));
" "$D/fat.json"
chk "a state push past the cap is a 413"      413 "$(code -X PUT "$B/api/data" -H 'Content-Type: application/json' -H "Cookie: $M1" --data-binary @"$D/fat.json")"
chk "...and the client can read why"         true "$(curl -s -X PUT "$B/api/data" -H 'Content-Type: application/json' -H "Cookie: $M1" --data-binary @"$D/fat.json" | node -pe "
  let d; try { d = JSON.parse(require('fs').readFileSync(0,'utf8')) } catch { d = {} }
  String(typeof d.error === 'string' && /MB/.test(d.error))")"
# 5 MB was the old ceiling for every route and it is not a ceiling for a food log. A body between
# the general limit and the state limit has to go through.
node -e "
const fs=require('fs');
fs.writeFileSync(process.argv[1], JSON.stringify({state:{_ts:1,pad:'x'.repeat(8*1024*1024)}}));
" "$D/big.json"
chk "a state push above the general limit still saves" 200 "$(code -X PUT "$B/api/data" -H 'Content-Type: application/json' -H "Cookie: $M2" --data-binary @"$D/big.json")"
# ...and the wider cap is for PUT /api/data ALONE. A video-sized JSON body must not become
# bufferable in the heap on every other route just because one of them legitimately grew.
chk "no other route inherited the wider cap"  413 "$(code -X POST "$B/api/coach/assign" -H 'Content-Type: application/json' -H "Cookie: $CA" --data-binary @"$D/big.json")"
chk "bad json is a 400, not a 500"            400 "$(code -X PUT "$B/api/data" -H 'Content-Type: application/json' -H "Cookie: $M1" -d 'not json')"

echo "== nutrition reaches the coach =="
# GET /api/coach/member is a hand-written allow-list. A client-side feature that is invisible on
# the coach dashboard fails silently — no test, no error, just a panel that never appears.
chk "the opened member carries meals, rollups and the target" ok "$(get -H "Cookie: $ADMIN" "$B/api/coach/member?id=mem2" | node -pe "
  const d = JSON.parse(require('fs').readFileSync(0,'utf8'));
  ['meals','mealDays','nutriTarget'].every(k => k in d) ? 'ok' : 'missing'")"

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

echo "== media upload: role gating =="
# Fixtures are built rather than committed: a real .mp4 in the repo is a binary blob nobody can
# review, and the bytes that matter here are the first 64. `ftyp` + brand is all sniffMedia reads.
mkfix() { node -e "
const fs=require('fs'); const size=+process.argv[5]||4096; const b=Buffer.alloc(size);
b.writeUInt32BE(32,0); b.write('ftyp',4); b.write(process.argv[2],8); b.writeUInt32BE(0,12);
[process.argv[3]].filter(Boolean).forEach((c,i)=>b.write(c,16+i*4));
b.write(process.argv[4]||'pad', 2048);          // make each fixture's CONTENT differ, so the
fs.writeFileSync(process.argv[1], b);           // content-addressed names differ too
" "$@"; }
mkfix "$D/demo.mp4" 'isom' 'iso2' 'avc1'
mkfix "$D/iphone.mov" 'qt  ' ''
mkfix "$D/photo.heic" 'heic' 'mif1'
head -c 300000 /dev/zero > "$D/junk.bin"
# --max-time so a handler that never answers shows up as one failed check rather than a suite that
# hangs forever and takes the deploy gate with it. An upload here is at most 2 MB over loopback.
up() { curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$B/api/media/exercise?ex=$2&label=front" -H "Cookie: $1" --data-binary "@$3"; }

chk "anonymous cannot upload a demo"          401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/media/exercise?ex=0025" --data-binary "@$D/demo.mp4")"
chk "a member cannot upload a demo"           403 "$(up "$M1" 0025 "$D/demo.mp4")"
chk "a coach can upload a demo"               200 "$(up "$CA" 0025 "$D/demo.mp4")"

echo "== media upload: what it accepts and refuses =="
chk "an iPhone .mov is ACCEPTED, not refused" 200 "$(up "$CA" 0026 "$D/iphone.mov")"
chk "...and is flagged raw for conversion"   raw  "$(get -H "Cookie: $CA" "$B/api/media/exercises" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String((d.media.find(m=>m.exId==='0026')||{}).status)")"
chk "an H.264 mp4 needs no conversion"      ready  "$(get -H "Cookie: $CA" "$B/api/media/exercises" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String((d.media.find(m=>m.exId==='0025')||{}).status)")"
chk "a photo in the video slot is refused"    415 "$(up "$CA" 0027 "$D/photo.heic")"
chk "bytes that are not media are refused"    415 "$(up "$CA" 0028 "$D/junk.bin")"
chk "a traversing exercise id is refused"     400 "$(up "$CA" '../../etc' "$D/demo.mp4")"
chk "an empty body is refused"                400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/media/exercise?ex=0029" -H "Cookie: $CA" --data-binary '')"
# The refusals above must leave nothing behind. A partial upload that survives its own rejection
# is a disk quota filling with files nothing references — invisible until the account is full.
chk "a refused upload leaves no temp file"      0 "$(ls -1 "$D"/media/ex/.up-* 2>/dev/null | wc -l | tr -d ' ')"
chk "and stores no file for the refused ids"    0 "$(ls -1 "$D"/media/ex/ 2>/dev/null | grep -c '^002[789]-' | tr -d ' ')"

# A refusal that arrives as a dropped connection is the failure this whole module exists to
# avoid: the messages are written for a coach who just filmed something and needs to know what to
# change. Destroying the request to stop the sender silently ate every one of them, and the
# status-code checks above still passed while it did — so assert the BODY, not just the code.
msg() { curl -s -X POST "$B/api/media/exercise?ex=$2" -H "Cookie: $1" --data-binary "@$3" | node -pe "String(JSON.parse(require('fs').readFileSync(0,'utf8')).error||'')"; }
chk "the refusal carries a readable reason"  true "$(node -pe "String(process.argv[1].length>10)" "$(msg "$CA" 0031 "$D/photo.heic")")"
chk "...and it names what to send instead"   true "$(node -pe "String(/image|video/i.test(process.argv[1]))" "$(msg "$CA" 0032 "$D/photo.heic")")"

echo "== media upload: the size cap =="
head -c 2000000 /dev/zero > "$D/big.pad"; cat "$D/demo.mp4" "$D/big.pad" > "$D/big.mp4"
chk "a file over the cap is refused"          413 "$(up "$CA" 0033 "$D/big.mp4")"
chk "the 413 says what the limit is"         true "$(node -pe "String(/1 MB/.test(process.argv[1]))" "$(msg "$CA" 0034 "$D/big.mp4")")"
# This is the branch where bytes are ALREADY on disk when the refusal fires, so it is the one
# that leaks if the cleanup is wrong.
chk "an over-cap upload leaves no temp file"    0 "$(ls -1 "$D"/media/ex/.up-* 2>/dev/null | wc -l | tr -d ' ')"
chk "and stores nothing for it"                 0 "$(ls -1 "$D"/media/ex/ 2>/dev/null | grep -c '^003[34]-' | tr -d ' ')"

echo "== media upload: the per-exercise cap holds under concurrency =="
# The count check runs before an await and db.media is only mutated after one, so a check that is
# not repeated afterwards is a promise about the past: parallel requests can all see the same
# pre-upload count and all pass it. The route therefore re-checks after the upload.
#
# Be honest about what this test does and does not establish. It was run with that re-check
# disabled and still passed, at 4 KB and again at 900 KB per file: ten backgrounded curls against
# loopback do not reliably interleave, because each upload finishes before the next handler
# reaches its post-await code. So this pins that the cap HOLDS for ten parallel requests; it does
# not demonstrate the re-check is load-bearing. That one rests on the reasoning above, not on
# this. Left in because it is cheap and would catch a cap that broke outright — but do not read a
# green here as proof the race is covered.
# ~900 KB each (under the 1 MB cap this suite runs with), not 4 KB. The overlap is the entire
# point: with tiny files each upload finishes before the next begins, every request reaches its
# post-upload code alone, and the check passes whether or not the re-check exists — a test that
# proves nothing. Verified by disabling the re-check and watching this go red.
for i in 1 2 3 4 5 6 7 8 9 10; do mkfix "$D/c$i.mp4" 'isom' 'avc1' "v$i" 900000; done
# `wait` with no arguments waits for EVERY background job this shell owns — which includes the
# API server started at the top of this file, so it never returns. Wait on these ten PIDs only.
ups=""
for i in 1 2 3 4 5 6 7 8 9 10; do up "$CA" 0040 "$D/c$i.mp4" > /dev/null & ups="$ups $!"; done
wait $ups
chk "no more rows than the cap allows"          6 "$(get -H "Cookie: $CA" "$B/api/media/exercises" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String(d.media.filter(m=>m.exId==='0040').length)")"
chk "and no more files than rows"               6 "$(ls -1 "$D"/media/ex/ 2>/dev/null | grep -c '^0040-' | tr -d ' ')"

echo "== media list =="
chk "anonymous cannot list media"             401 "$(code "$B/api/media/exercises")"
chk "a member CAN list media (to render it)"  200 "$(code -H "Cookie: $M1" "$B/api/media/exercises")"
# Content addressing: the same bytes twice is one row and one file, not two of each.
up "$CA" 0025 "$D/demo.mp4" > /dev/null
chk "re-uploading identical bytes dedupes"      1 "$(get -H "Cookie: $CA" "$B/api/media/exercises" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String(d.media.filter(m=>m.exId==='0025').length)")"
chk "and leaves one file on disk"               1 "$(ls -1 "$D"/media/ex/ 2>/dev/null | grep -c '^0025-' | tr -d ' ')"

echo "== serving the bytes back =="
MID=$(get -H "Cookie: $CA" "$B/api/media/exercises" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));(d.media.find(m=>m.exId==='0025')||{}).id||''")
SZ=$(node -pe "require('fs').statSync(process.argv[1]).size" "$D/demo.mp4")
chk "anonymous cannot fetch a demo"            401 "$(code "$B/api/media/ex?id=$MID")"
chk "a member can watch a demo"                200 "$(code -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
chk "an unknown id is 404"                     404 "$(code -H "Cookie: $M1" "$B/api/media/ex?id=nope")"
chk "the whole file comes back intact"       "$SZ" "$(curl -s -H "Cookie: $M1" "$B/api/media/ex?id=$MID" | wc -c | tr -d ' ')"
curl -s -H "Cookie: $M1" "$B/api/media/ex?id=$MID" > "$D/full.got"
chk "...byte for byte, not just in length"    true "$(node -pe "
  const fs=require('fs');
  String(Buffer.compare(fs.readFileSync(process.argv[1]), fs.readFileSync(process.argv[2]))===0)" "$D/demo.mp4" "$D/full.got")"
chk "and advertises range support"         "bytes" "$(curl -s -D - -o /dev/null -H "Cookie: $M1" "$B/api/media/ex?id=$MID" | grep -i '^accept-ranges' | tr -d '\r' | awk '{print $2}')"

# <video> seeks by issuing range requests. A server that answers each one with the whole file
# from byte zero makes scrubbing unusable, and Safari will not begin playback at all without a
# 206 for its opening probe — so these are playback working, not protocol trivia.
chk "a range request is answered 206"          206 "$(code -r 0-99 -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
chk "...with the right Content-Range"  "bytes 0-99/$SZ" "$(curl -s -D - -o /dev/null -r 0-99 -H "Cookie: $M1" "$B/api/media/ex?id=$MID" | grep -i '^content-range' | tr -d '\r' | cut -d' ' -f2-)"
chk "...and exactly that many bytes"           100 "$(curl -s -r 0-99 -H "Cookie: $M1" "$B/api/media/ex?id=$MID" | wc -c | tr -d ' ')"
chk "an open-ended range runs to the end"      206 "$(code -r 100- -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
chk "a suffix range returns the last bytes"     50 "$(curl -s -r -50 -H "Cookie: $M1" "$B/api/media/ex?id=$MID" | wc -c | tr -d ' ')"
# Length alone would pass on an off-by-one that served the wrong 50 bytes, which is exactly the
# mistake a suffix range invites. Compare the CONTENT against the tail of the source.
curl -s -r -50 -H "Cookie: $M1" "$B/api/media/ex?id=$MID" > "$D/tail.got"
chk "...and they are the right last bytes"    true "$(node -pe "
  const fs=require('fs'); const src=fs.readFileSync(process.argv[1]); const got=fs.readFileSync(process.argv[2]);
  String(Buffer.compare(src.subarray(src.length-50), got)===0)" "$D/demo.mp4" "$D/tail.got")"
chk "an end past EOF is clamped, not refused"  206 "$(code -r "0-$((SZ + 5000))" -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
# 416 means "that range does not exist in this file", so it is only ever the answer to a range
# that parsed and cannot be met. A multi-range or an unknown unit is something this server cannot
# ACT on, which the spec says to ignore — answer 200 with everything. Saying 416 to those (which
# an earlier revision did) fails a download manager or a coalescing proxy that a 200 would serve.
chk "a start past EOF is 416"                  416 "$(code -H "Range: bytes=$((SZ + 10))-" -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
chk "...and that 416 is never cached"     "no-store" "$(curl -s -D - -o /dev/null -H "Range: bytes=$((SZ + 10))-" -H "Cookie: $M1" "$B/api/media/ex?id=$MID" | grep -i '^cache-control' | tr -d '\r' | awk '{print $2}')"
chk "a multi-range falls back to the whole file" 200 "$(code -H "Range: bytes=0-9,20-29" -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
chk "...and really is the whole file"        "$SZ" "$(curl -s -H "Range: bytes=0-9,20-29" -H "Cookie: $M1" "$B/api/media/ex?id=$MID" | wc -c | tr -d ' ')"
chk "an unknown range unit is ignored"         200 "$(code -H "Range: seconds=0-10" -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
chk "a malformed range is ignored"             200 "$(code -H "Range: bytes=abc" -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
# A row an operator truncated by hand must 404, not 500. RegExp.test coerces, so a missing `file`
# is tested as the string "undefined" — which matches the safe-name pattern — and the traversal
# check then throws on the real undefined.
chk "a row with no filename 404s, not 500s"    404 "$(code -H "Cookie: $M1" "$B/api/media/ex?id=brokenrow")"
chk "HEAD works where GET does"                200 "$(code -I -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
# curl's own byte counter, not a sed that hunts for the blank line between headers and body:
# that separator is CRLF, and how much of it survives the pipe differs between platforms — the
# first version of this check passed on Windows and failed on CI's Linux for that reason alone.
chk "...and sends no body"                       0 "$(curl -s -I -o /dev/null -w '%{size_download}' -H "Cookie: $M1" "$B/api/media/ex?id=$MID")"
# But it must still ANNOUNCE the length, which is what a player reads before deciding how to seek.
chk "...while still declaring the length"    "$SZ" "$(curl -s -I -H "Cookie: $M1" "$B/api/media/ex?id=$MID" | grep -i '^content-length' | tr -d '\r' | awk '{print $2}')"

echo "== progress photos: uploading =="
# A JPEG, sniffed from its first three bytes exactly like the mp4 fixtures above. Two of them,
# with different content, so a retake can be told apart from the file it replaced.
mkjpg() { node -e "
const fs=require('fs'); const b=Buffer.alloc(+process.argv[3]||4096);
b[0]=0xff; b[1]=0xd8; b[2]=0xff; b[3]=0xe0; b.write(process.argv[2]||'pad', 2048);
fs.writeFileSync(process.argv[1], b);
" "$@"; }
mkjpg "$D/front.jpg" 'one'
mkjpg "$D/front2.jpg" 'two'
PD=$(node -pe "const d=new Date(); d.setUTCDate(d.getUTCDate()-d.getUTCDay()); d.toISOString().slice(0,10)")
ph() { curl -s --max-time 20 -o /dev/null -w "%{http_code}" -X POST "$B/api/media/photo?d=$3&pose=$4" -H "Cookie: $1" --data-binary "@$2"; }

chk "anonymous cannot send a photo"            401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/api/media/photo?d=$PD&pose=front" --data-binary "@$D/front.jpg")"
chk "a member sends their own photo"           200 "$(ph "$M1" "$D/front.jpg" "$PD" front)"
chk "another member sends theirs too"          200 "$(ph "$M2" "$D/front.jpg" "$PD" front)"
chk "a video in the photo slot is refused"     415 "$(ph "$M1" "$D/demo.mp4" "$PD" side)"
chk "a HEIC is refused with camera advice"    true "$(node -pe "String(/Compatible|JPEG/i.test(process.argv[1]))" "$(curl -s -X POST "$B/api/media/photo?d=$PD&pose=side" -H "Cookie: $M1" --data-binary "@$D/photo.heic" | node -pe "String(JSON.parse(require('fs').readFileSync(0,'utf8')).error||'')")")"
chk "a date that is not a date is refused"     400 "$(ph "$M1" "$D/front.jpg" 'not-a-date' front)"
chk "a traversing date is refused"             400 "$(ph "$M1" "$D/front.jpg" '../../etc' front)"
chk "a pose outside the three is refused"      400 "$(ph "$M1" "$D/front.jpg" "$PD" 'moon')"
# Same property the demo route has: nothing a refusal touched may survive it.
chk "a refused photo leaves no temp file"        0 "$(ls -1 "$D"/media/photo/*/.up-* 2>/dev/null | wc -l | tr -d ' ')"

echo "== progress photos: the slot is (week, pose), and a retake replaces =="
chk "the member's own list has one row"          1 "$(get -H "Cookie: $M1" "$B/api/media/photos" | node -pe "String(JSON.parse(require('fs').readFileSync(0,'utf8')).photos.length)")"
chk "...and it never carries the filename"    true "$(get -H "Cookie: $M1" "$B/api/media/photos" | node -pe "String(!('file' in JSON.parse(require('fs').readFileSync(0,'utf8')).photos[0]))")"
PID1=$(get -H "Cookie: $M1" "$B/api/media/photos" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).photos[0].id")
chk "a retake of the same slot is accepted"    200 "$(ph "$M1" "$D/front2.jpg" "$PD" front)"
chk "...and still leaves exactly one row"        1 "$(get -H "Cookie: $M1" "$B/api/media/photos" | node -pe "String(JSON.parse(require('fs').readFileSync(0,'utf8')).photos.length)")"
# Weekly photos with no retention rule and no delete route fill a shared-hosting quota forever.
# The replaced FILE has to go, not just the row that pointed at it.
chk "...and exactly one file on disk"            1 "$(ls -1 "$D"/media/photo/mem1/ 2>/dev/null | wc -l | tr -d ' ')"
chk "the old row id stops resolving"           403 "$(code -H "Cookie: $M1" "$B/api/media/photo?id=$PID1")"
chk "a second pose is a second slot"           200 "$(ph "$M1" "$D/front.jpg" "$PD" back)"
chk "...so now there are two rows"               2 "$(get -H "Cookie: $M1" "$B/api/media/photos" | node -pe "String(JSON.parse(require('fs').readFileSync(0,'utf8')).photos.length)")"
# The sidecar, not the state file. PUT /api/data replaces state-<uid>.json wholesale from
# whatever the client last held, so a row written there is destroyed by the next sync.
chk "metadata lands in the sidecar, not state"   1 "$(ls -1 "$D"/media-mem1.json 2>/dev/null | wc -l | tr -d ' ')"
chk "...and never into the state file"         true "$(node -pe "
  const fs=require('fs'); const f=process.argv[1];
  const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f,'utf8')) : {};
  String(!('photos' in s))" "$D/state-mem1.json")"
# Unguessable names, not content-addressed ones: the demo route may derive a name from its bytes
# because every signed-in member may have the file anyway. These filenames must be an index of
# nothing, in case the directory is ever reachable by something other than the route below.
chk "stored filenames are unguessable"        true "$(ls -1 "$D"/media/photo/mem1/ | node -pe "
  const n=require('fs').readFileSync(0,'utf8').trim().split(/\s+/);
  String(n.every(f => /^[A-Za-z0-9_-]{22}\.(jpg|png|webp|gif)$/.test(f)))")"
# Forced, not waited for: base64url puts '-' or '_' first in 2 names out of 64, and the serving
# guard used to reject exactly those — stored 200, read back 403, forever. A 3% bug is one this
# smoke passes 94% of the time by luck, so rename a stored file onto the awkward case and ask.
LEAD=$(node -e "
  const fs=require('fs'), path=require('path');
  const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
  const row=m.photos.find(p=>p.pose==='front');
  const next='-'+row.file.slice(1);
  fs.renameSync(path.join(process.argv[2],row.file), path.join(process.argv[2],next));
  row.file=next; fs.writeFileSync(process.argv[1], JSON.stringify(m));
  process.stdout.write(row.id)" "$D/media-mem1.json" "$D/media/photo/mem1")
chk "a name beginning '-' is served, not 403'd" 200 "$(code -H "Cookie: $M1" "$B/api/media/photo?id=$LEAD")"

# The sections above demote and re-promote coachA, and demoting runs detachCoach — which
# unlinks their whole roster on purpose. Re-link mem1 explicitly so what follows depends on
# the relationship it is actually testing rather than on wherever the earlier checks left it.
curl -s -o /dev/null -X POST "$B/api/admin/user/assign-coach" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"id":"mem1","coachId":"coachA"}'
chk "mem1 is coachA's again, for what follows"  200 "$(code -H "Cookie: $CA" "$B/api/coach/member?id=mem1")"

echo "== progress photos: who may read the bytes =="
MPID=$(get -H "Cookie: $M1" "$B/api/media/photos" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).photos.find(p=>p.pose==='front').id")
SZP=$(node -pe "require('fs').statSync(process.argv[1]).size" "$D/front2.jpg")
chk "signed out gets no photo"                 401 "$(code "$B/api/media/photo?u=mem1&id=$MPID")"
chk "the owner reads their own"                200 "$(code -H "Cookie: $M1" "$B/api/media/photo?u=mem1&id=$MPID")"
chk "...and without naming themselves"         200 "$(code -H "Cookie: $M1" "$B/api/media/photo?id=$MPID")"
chk "their coach reads it"                     200 "$(code -H "Cookie: $CA" "$B/api/media/photo?u=mem1&id=$MPID")"
chk "an admin reads it"                        200 "$(code -H "Cookie: $ADMIN" "$B/api/media/photo?u=mem1&id=$MPID")"
chk "another coach cannot"                     403 "$(code -H "Cookie: $CB" "$B/api/media/photo?u=mem1&id=$MPID")"
chk "another CLIENT cannot"                    403 "$(code -H "Cookie: $M2" "$B/api/media/photo?u=mem1&id=$MPID")"
# The whole point of the 403. A coach who is told 404 for "no such photo" and 403 for "not your
# client" can walk the id space and learn who else trains here — the same enumeration
# GET /api/coach/member refuses to allow. Status AND body have to match, or the body leaks it.
chk "a missing id is the SAME 403, not a 404"  403 "$(code -H "Cookie: $M2" "$B/api/media/photo?u=mem1&id=nope")"
chk "an unknown member is the same 403 too"    403 "$(code -H "Cookie: $M2" "$B/api/media/photo?u=ghost&id=$MPID")"
chk "...and all three say exactly the same thing" true "$(node -pe "
  const a=process.argv[1], b=process.argv[2], c=process.argv[3];
  String(a===b && b===c && a.length>0)" \
  "$(get -H "Cookie: $M2" "$B/api/media/photo?u=mem1&id=$MPID")" \
  "$(get -H "Cookie: $M2" "$B/api/media/photo?u=mem1&id=nope")" \
  "$(get -H "Cookie: $M2" "$B/api/media/photo?u=ghost&id=$MPID")")"
# canCoachMember refuses when coach and member are the same person, so a gate that asked it
# FIRST would lock a coach who files their own check-ins out of their own photos.
chk "a coach may file a check-in photo too"     200 "$(ph "$CA" "$D/front.jpg" "$PD" front)"
CPID=$(get -H "Cookie: $CA" "$B/api/media/photos" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).photos[0].id")
chk "...and read their OWN back"               200 "$(code -H "Cookie: $CA" "$B/api/media/photo?id=$CPID")"
chk "...naming themselves, which self-coaching forbids" 200 "$(code -H "Cookie: $CA" "$B/api/media/photo?u=coachA&id=$CPID")"
chk "the bytes come back intact"            "$SZP" "$(curl -s -H "Cookie: $CA" "$B/api/media/photo?u=mem1&id=$MPID" | wc -c | tr -d ' ')"
chk "HEAD works where GET does"                200 "$(code -I -H "Cookie: $CA" "$B/api/media/photo?u=mem1&id=$MPID")"

echo "== progress photos: reaching the coach =="
chk "the opened member carries their photos"     2 "$(get -H "Cookie: $CA" "$B/api/coach/member?id=mem1" | node -pe "String((JSON.parse(require('fs').readFileSync(0,'utf8')).photos||[]).length)")"
chk "...as metadata only, never a path"       true "$(get -H "Cookie: $CA" "$B/api/coach/member?id=mem1" | node -pe "
  const p=JSON.parse(require('fs').readFileSync(0,'utf8')).photos;
  String(p.every(x => !('file' in x) && x.id && x.d && x.pose))")"

echo "== taking a client on: minting =="
mint() { curl -s -X POST "$B/api/coach/invites/new" -H 'Content-Type: application/json' -H "Cookie: $1" -d "{\"note\":\"$2\"}"; }
chk "anonymous cannot mint a code"            401 "$(code -X POST "$B/api/coach/invites/new" -H 'Content-Type: application/json' -d '{}')"
chk "a member cannot mint a code"             403 "$(code -X POST "$B/api/coach/invites/new" -H 'Content-Type: application/json' -H "Cookie: $M1" -d '{}')"
CODE_A=$(mint "$CA" "for Nadia" | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).invite.code")
chk "a coach mints one"                      true "$(node -pe "String(/^[0-9A-F]{16}$/.test(process.argv[1]))" "$CODE_A")"
chk "and it carries the coach it belongs to" true "$(get -H "Cookie: $ADMIN" "$B/api/admin/invites" | node -pe "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  String((d.invites.find(i=>i.code===process.argv[1])||{}).coachId==='coachA')" "$CODE_A")"

echo "== an admin's own code must NOT bind anyone =="
# isCoach() counts admins as coaches, so inferring the binding from createdBy would have made
# every general admin invite — and every access-request approval — silently assign that admin as
# the new member's coach. The field is explicit precisely so this stays absent.
ACODE=$(curl -s -X POST "$B/api/admin/invites/new" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d '{"note":"general"}' | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).invite.code")
chk "an admin's general code has no coachId" true "$(get -H "Cookie: $ADMIN" "$B/api/admin/invites" | node -pe "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  String(!('coachId' in (d.invites.find(i=>i.code===process.argv[1])||{})))" "$ACODE")"

echo "== listing is scoped to the coach, not the gym =="
chk "coachA sees their own code"                1 "$(get -H "Cookie: $CA" "$B/api/coach/invites" | node -pe "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String(d.invites.filter(i=>i.code===process.argv[1]).length)" "$CODE_A")"
chk "coachB does NOT see it"                    0 "$(get -H "Cookie: $CB" "$B/api/coach/invites" | node -pe "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String(d.invites.filter(i=>i.code===process.argv[1]).length)" "$CODE_A")"
chk "nor does the admin's general code appear"  0 "$(get -H "Cookie: $CA" "$B/api/coach/invites" | node -pe "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));String(d.invites.filter(i=>i.code===process.argv[1]).length)" "$ACODE")"

echo "== revoking is scoped too, and says nothing about what it will not touch =="
rev() { curl -s -o /dev/null -w "%{http_code}" -X POST "$B/api/coach/invites/revoke" -H 'Content-Type: application/json' -H "Cookie: $1" -d "{\"code\":\"$2\"}"; }
chk "another coach cannot revoke it"          404 "$(rev "$CB" "$CODE_A")"
chk "...the same 404 a made-up code gets"     404 "$(rev "$CB" "AAAAAAAAAAAAAAAA")"
chk "a coach cannot revoke the admin's code"  404 "$(rev "$CA" "$ACODE")"
chk "the owner can revoke it"                 200 "$(rev "$CA" "$CODE_A")"
chk "and it is flagged, not deleted"         true "$(get -H "Cookie: $CA" "$B/api/coach/invites" | node -pe "
  const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
  String((d.invites.find(i=>i.code===process.argv[1])||{}).revoked===true)" "$CODE_A")"

echo ""
echo "passed $pass, failed $fail"
[ "$fail" = "0" ] || { echo "--- server log ---"; tail -20 "$D/log"; }
exit $fail
