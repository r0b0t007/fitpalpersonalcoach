#!/usr/bin/env bash
# API smoke test for the coach role. Boots a throwaway instance, mints signed session cookies
# directly (same HMAC the server uses), and exercises every route including the refusals.
set -u
API="/c/Users/Chouchou/Desktop/Ahmed/Code Projects/opengym/openGym/api"
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
for i in $(seq 1 30); do curl -sf "$B/api/health" >/dev/null 2>&1 && break; sleep 0.4; done

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

echo ""
echo "passed $pass, failed $fail"
[ "$fail" = "0" ] || { echo "--- server log ---"; tail -20 "$D/log"; }
exit $fail
