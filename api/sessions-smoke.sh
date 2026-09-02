#!/usr/bin/env bash
# API smoke test for the multi-room timetable: clash warnings, series moves, and soft cancel.
# Boots a throwaway instance and mints signed session cookies directly (same HMAC the server uses).
set -u
API="$(cd "$(dirname "$0")" && pwd)"
# Throwaway instance data goes to a temp dir, never inside the repo: this creates a `secret`
# and `vapid.json`, and a stray commit of those is exactly the sort of thing nobody notices.
D="${TMPDIR:-/tmp}/opengym-sessions-smoke.$$"
PORT=3989
B="http://localhost:$PORT"
rm -rf "$D"; mkdir -p "$D"

cat > "$D/db.json" <<'JSON'
{"users":[
  {"id":"adminX","name":"Owner","admin":true,"created":"2026-01-01T00:00:00.000Z"},
  {"id":"ana","name":"Ana","coach":true,"created":"2026-01-01T00:00:00.000Z"},
  {"id":"bob","name":"Bob","coach":true,"created":"2026-01-01T00:00:00.000Z"},
  {"id":"mem1","name":"Member","created":"2026-01-01T00:00:00.000Z"}
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
ADMIN=$(cook adminX); ANA=$(cook ana); MEM=$(cook mem1)

pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf "  ok    %-54s %s\n" "$1" "$3"
  else fail=$((fail+1)); printf "  FAIL  %-54s got %s want %s\n" "$1" "$3" "$2"; fi; }

# Far-future dates so nothing is pruned as past.
D1=2027-03-02   # a Tuesday
save() { curl -s -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d "$1"; }
sessions() { curl -s "$B/api/sessions" -H "Cookie: $ADMIN"; }
jq_() { node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); $1"; }

echo "== creating =="
chk "a class with a room and a real coach is created" true \
  "$(save "{\"session\":{\"title\":\"Spin\",\"date\":\"$D1\",\"time\":\"18:00\",\"minutes\":45,\"room\":\"Studio 1\",\"coachId\":\"ana\"},\"confirm\":true}" | jq_ 'String(d.ok===true)')"
chk "an unknown coachId is refused"  "that user is not a coach" \
  "$(save "{\"session\":{\"title\":\"X\",\"date\":\"$D1\",\"time\":\"09:00\",\"coachId\":\"mem1\"},\"confirm\":true}" | jq_ 'String(d.error)')"

echo "== clash detection =="
chk "same room, overlapping time -> warns"          room \
  "$(save "{\"session\":{\"title\":\"Yoga\",\"date\":\"$D1\",\"time\":\"18:15\",\"minutes\":60,\"room\":\"studio  1\"}}" | jq_ 'String((d.conflicts||[])[0]&&d.conflicts[0].why)')"
chk "...and it was NOT written while unconfirmed"      1 \
  "$(sessions | jq_ 'd.sessions.length')"
chk "same coach, different room -> warns"          coach \
  "$(save "{\"session\":{\"title\":\"Zumba\",\"date\":\"$D1\",\"time\":\"18:15\",\"room\":\"Studio 2\",\"coachId\":\"ana\"}}" | jq_ 'String((d.conflicts||[])[0]&&d.conflicts[0].why)')"
chk "different room and coach -> no warning"        true \
  "$(save "{\"session\":{\"title\":\"Zumba\",\"date\":\"$D1\",\"time\":\"18:15\",\"room\":\"Studio 2\",\"coachId\":\"bob\"}}" | jq_ 'String(d.ok===true)')"
chk "back-to-back in one room is not a clash"       true \
  "$(save "{\"session\":{\"title\":\"Late Spin\",\"date\":\"$D1\",\"time\":\"18:45\",\"room\":\"Studio 1\"}}" | jq_ 'String(d.ok===true)')"
chk "override with confirm writes it anyway"        true \
  "$(save "{\"session\":{\"title\":\"Yoga\",\"date\":\"$D1\",\"time\":\"18:15\",\"room\":\"Studio 1\"},\"confirm\":true}" | jq_ 'String(d.ok===true)')"

echo "== moving a weekly series =="
curl -s -o /dev/null -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" \
  -d "{\"session\":{\"title\":\"Weekly Spin\",\"date\":\"2027-04-06\",\"time\":\"07:00\",\"room\":\"Studio 3\",\"coachId\":\"ana\"},\"repeatWeeks\":4,\"confirm\":true}"
SID=$(sessions | jq_ 'd.sessions.filter(s=>s.title==="Weekly Spin").sort((a,b)=>a.date<b.date?-1:1)[0].id')
chk "series created with 4 occurrences"             4 "$(sessions | jq_ 'd.sessions.filter(s=>s.title==="Weekly Spin").length')"
# Tuesday -> Wednesday, for this one and every later one, in a single action.
curl -s -o /dev/null -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" \
  -d "{\"session\":{\"id\":\"$SID\",\"title\":\"Weekly Spin\",\"date\":\"2027-04-07\",\"time\":\"07:00\",\"room\":\"Studio 3\",\"coachId\":\"ana\"},\"series\":true,\"confirm\":true}"
chk "whole series shifted by one day"  "2027-04-07,2027-04-14,2027-04-21,2027-04-28" \
  "$(sessions | jq_ 'd.sessions.filter(s=>s.title==="Weekly Spin").map(s=>s.date).sort().join(",")')"

echo "== soft cancel =="
cancel() { curl -s -X POST "$B/api/admin/sessions/cancel" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" -d "$1"; }
chk "cancelling marks it, does not delete it"       4 \
  "$(cancel "{\"id\":\"$SID\",\"reason\":\"Coach ill\",\"series\":true}" >/dev/null; sessions | jq_ 'd.sessions.filter(s=>s.title==="Weekly Spin").length')"
chk "all four are flagged cancelled"                4 \
  "$(sessions | jq_ 'd.sessions.filter(s=>s.cancelled).length')"
chk "the reason is kept for members to see" "Coach ill" \
  "$(sessions | jq_ 'String(d.sessions.find(s=>s.cancelled).cancelReason)')"
chk "a cancelled class no longer blocks its room"   true \
  "$(save "{\"session\":{\"title\":\"Replacement\",\"date\":\"2027-04-07\",\"time\":\"07:00\",\"room\":\"Studio 3\"}}" | jq_ 'String(d.ok===true)')"
chk "restoring clears the flag"                     0 \
  "$(cancel "{\"id\":\"$SID\",\"series\":true,\"restore\":true}" >/dev/null; sessions | jq_ 'd.sessions.filter(s=>s.cancelled).length')"

echo "== a coach's own timetable =="
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
chk "coach sees only their own classes"             true \
  "$(curl -s "$B/api/coach/sessions" -H "Cookie: $ANA" | jq_ 'String(d.sessions.every(s=>s.coachId==="ana") && d.sessions.length>0)')"
chk "a member cannot read the coach timetable"    403 "$(code -H "Cookie: $MEM" "$B/api/coach/sessions")"
chk "anonymous cannot either"                     401 "$(code "$B/api/coach/sessions")"
chk "admin sees their own (none assigned)"          0 \
  "$(curl -s "$B/api/coach/sessions" -H "Cookie: $ADMIN" | jq_ 'd.sessions.length')"

echo "== members still read the timetable without signing in =="
chk "public timetable is readable"                200 "$(code "$B/api/sessions")"
chk "cancel needs admin"                          403 "$(code -X POST "$B/api/admin/sessions/cancel" -H 'Content-Type: application/json' -H "Cookie: $ANA" -d "{\"id\":\"$SID\"}")"

echo ""
echo "passed $pass, failed $fail"
[ "$fail" = "0" ] || { echo "--- server log ---"; tail -20 "$D/log"; }
exit $fail
