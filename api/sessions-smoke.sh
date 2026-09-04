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
# A server that never booted (missing dep, port taken, syntax error) otherwise shows up as every
# check failing at once, with the real cause buried under the wall of FAILs.
#
# Probing /api/health alone is not enough, and the port-taken case is exactly where it fails: if
# something else is already listening - a leftover server from an earlier run, or the app itself
# in another terminal - it answers the probe cheerfully while OUR node has died on EADDRINUSE.
# The run then reads the wrong instance, finds no secret to sign cookies with, and degrades into
# the same wall of FAILs. So gate on our own process still being alive and on the secret THIS
# instance wrote, not merely on something answering at that address.
ready() { kill -0 $SRV 2>/dev/null && [ -s "$D/secret" ] && curl -sf --max-time 5 "$B/api/health" >/dev/null 2>&1; }
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
ADMIN=$(cook adminX); ANA=$(cook ana); MEM=$(cook mem1)

pass=0; fail=0
chk() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf "  ok    %-54s %s\n" "$1" "$3"
  else fail=$((fail+1)); printf "  FAIL  %-54s got %s want %s\n" "$1" "$3" "$2"; fi; }

# Every fixture date is computed from today, never written as a literal. GET /api/sessions serves
# only from SESSION_WINDOW_DAYS (7) back, so a hardcoded date stops being visible the moment the
# wall clock passes it — the suite would start failing on a date with no code change behind it.
# That was survivable while these ran by hand; now that they gate deploys it would block every
# release instead. Anchored to a Tuesday ~4 months out so the "move the series to Wednesdays"
# case below keeps exactly the shape it was written for, and offsets preserve the original gaps.
eval "$(node -e "
const d = new Date(); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate() + 120);
while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);   // snap forward to a Tuesday
const at = n => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) };
// D1 the clash block; WK* the weekly series and its one-day move; SER/BLK the whole-series clash
// (BLK lands on week 3 of SER); ORIG the cancel-then-replace pair; REST the restorable series.
const days = { D1: 0, WK: 35, WK1: 36, WK2: 43, WK3: 50, WK4: 57, SER: 91, BLK: 105, ORIG: 125, REST: 153 };
process.stdout.write(Object.entries(days).map(([k, n]) => k + '=' + at(n)).join(' '));
")"
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
  -d "{\"session\":{\"title\":\"Weekly Spin\",\"date\":\"$WK\",\"time\":\"07:00\",\"room\":\"Studio 3\",\"coachId\":\"ana\"},\"repeatWeeks\":4,\"confirm\":true}"
SID=$(sessions | jq_ 'd.sessions.filter(s=>s.title==="Weekly Spin").sort((a,b)=>a.date<b.date?-1:1)[0].id')
chk "series created with 4 occurrences"             4 "$(sessions | jq_ 'd.sessions.filter(s=>s.title==="Weekly Spin").length')"
# Tuesday -> Wednesday, for this one and every later one, in a single action.
curl -s -o /dev/null -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN" \
  -d "{\"session\":{\"id\":\"$SID\",\"title\":\"Weekly Spin\",\"date\":\"$WK1\",\"time\":\"07:00\",\"room\":\"Studio 3\",\"coachId\":\"ana\"},\"series\":true,\"confirm\":true}"
chk "whole series shifted by one day"  "$WK1,$WK2,$WK3,$WK4" \
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
  "$(save "{\"session\":{\"title\":\"Replacement\",\"date\":\"$WK1\",\"time\":\"07:00\",\"room\":\"Studio 3\"}}" | jq_ 'String(d.ok===true)')"
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

echo "== clashes are checked across the WHOLE series, not just week 1 =="
# The review's sharpest finding: creating 4 weekly copies validated only the first, so weeks 2-4
# could land on an occupied room in silence -- and the headline "move a class to Wednesdays"
# validated the first Wednesday only.
curl -s -o /dev/null -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN"   -d "{\"session\":{\"title\":\"Blocker\",\"date\":\"$BLK\",\"time\":\"10:00\",\"minutes\":60,\"room\":\"Studio 9\"},\"confirm\":true}"
chk "a later week of a new series is caught"     room   "$(save "{\"session\":{\"title\":\"Weekly\",\"date\":\"$SER\",\"time\":\"10:00\",\"minutes\":60,\"room\":\"Studio 9\"},\"repeatWeeks\":4}" | jq_ 'String((d.conflicts||[])[0]&&d.conflicts[0].why)')"
chk "week 1 alone still saves cleanly"           true   "$(save "{\"session\":{\"title\":\"Weekly\",\"date\":\"$SER\",\"time\":\"10:00\",\"minutes\":60,\"room\":\"Studio 9\"},\"repeatWeeks\":1}" | jq_ 'String(d.ok===true)')"

echo "== editing a cancelled class must not clash with its own replacement =="
curl -s -o /dev/null -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN"   -d "{\"session\":{\"title\":\"Original\",\"date\":\"$ORIG\",\"time\":\"12:00\",\"minutes\":60,\"room\":\"Studio 7\"},\"confirm\":true}"
OID=$(sessions | jq_ 'd.sessions.find(s=>s.title==="Original").id')
cancel "{\"id\":\"$OID\",\"reason\":\"off\"}" >/dev/null
curl -s -o /dev/null -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN"   -d "{\"session\":{\"title\":\"Replacement\",\"date\":\"$ORIG\",\"time\":\"12:00\",\"minutes\":60,\"room\":\"Studio 7\"},\"confirm\":true}"
chk "fixing a typo on the cancelled one is clean" true   "$(save "{\"session\":{\"id\":\"$OID\",\"title\":\"Original fixed\",\"date\":\"$ORIG\",\"time\":\"12:00\",\"minutes\":60,\"room\":\"Studio 7\"}}" | jq_ 'String(d.ok===true)')"

echo "== restoring a whole series in one press =="
curl -s -o /dev/null -X POST "$B/api/admin/sessions/save" -H 'Content-Type: application/json' -H "Cookie: $ADMIN"   -d "{\"session\":{\"title\":\"Restorable\",\"date\":\"$REST\",\"time\":\"09:00\",\"room\":\"Studio 8\"},\"repeatWeeks\":3,\"confirm\":true}"
RID=$(sessions | jq_ 'd.sessions.filter(s=>s.title==="Restorable").sort((a,b)=>a.date<b.date?-1:1)[0].id')
cancel "{\"id\":\"$RID\",\"series\":true,\"reason\":\"x\"}" >/dev/null
chk "all three cancelled"                           3 "$(sessions | jq_ 'd.sessions.filter(s=>s.title==="Restorable"&&s.cancelled).length')"
chk "restore with series clears all three"          0   "$(cancel "{\"id\":\"$RID\",\"series\":true,\"restore\":true}" >/dev/null; sessions | jq_ 'd.sessions.filter(s=>s.title==="Restorable"&&s.cancelled).length')"

echo "== an admin still sees the coach on the public timetable =="
chk "admin rows carry coachName"                 true   "$(curl -s "$B/api/sessions" -H "Cookie: $ADMIN" | jq_ 'String(d.sessions.some(s=>!!s.coachName))')"
chk "...and coachId, which the edit sheet needs" true   "$(curl -s "$B/api/sessions" -H "Cookie: $ADMIN" | jq_ 'String(d.sessions.some(s=>!!s.coachId))')"
chk "anonymous readers get the name but no id"  true   "$(curl -s "$B/api/sessions" | jq_ 'String(d.sessions.some(s=>!!s.coachName) && d.sessions.every(s=>!("coachId" in s)))')"

echo ""
echo "passed $pass, failed $fail"
[ "$fail" = "0" ] || { echo "--- server log ---"; tail -20 "$D/log"; }
exit $fail
