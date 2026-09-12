#!/usr/bin/env node
/**
 * Seed a coach's roster with demo clients, so the coach screens can be looked at with data in
 * them. Operator tool, run by hand on a server with shell access — NOT reachable over HTTP and
 * not imported by server.js.
 *
 *   node seed-demo.mjs              # add the demo roster to the one coach in db.json
 *   node seed-demo.mjs --coach <id> # …or to a named coach, when there is more than one
 *   node seed-demo.mjs --remove     # take all of it back out again
 *   node seed-demo.mjs --list       # show what is currently seeded, change nothing
 *
 * Reads DATA_DIR the same way server.js does, so it works against whatever instance is
 * configured. RESTART IS NOT NEEDED for --list; it IS needed after seeding or removing, because
 * server.js holds db.json in memory and would otherwise overwrite this file's changes on its next
 * write. The script says so when it finishes.
 *
 * Three rules it holds to, because it writes to a live file:
 *
 *  1. It only ever ADDS. Existing users, credentials, invites, sessions and assignments are
 *     copied through untouched; nothing already in db.json is edited or removed.
 *  2. Every id it creates starts with DEMO_PREFIX, which is what --remove keys off. That is why
 *     removal can be exact rather than a guess at what looked fake.
 *  3. db.json is copied to db.json.bak-<timestamp> before the first write. If anything here is
 *     wrong, that file is the way back.
 *
 * The demo clients have NO credentials (`creds` is untouched), so nobody can sign in as one.
 * They exist to be looked at from the coach side and nothing else.
 *
 * On writing state-<uid>.json directly: the SERVER must never do that — `S` belongs to the
 * client, and the coach→client direction goes through an assignment bundle the client accepts.
 * That rule is about the request path, where a server write would race a real device and lose
 * somebody's training. Here there is no device and no owner to race: these profiles exist only
 * as fixtures. Seeding the file is the only way to give a demo client a history at all, and it is
 * why this lives in a standalone script rather than behind a route.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA = process.env.DATA_DIR || path.join(import.meta.dirname, '..', 'data');
const DEMO_PREFIX = 'demo-';
const argv = process.argv.slice(2);
const has = f => argv.includes(f);
const valOf = f => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const dbFile = path.join(DATA, 'db.json');
const stateFile = uid => path.join(DATA, `state-${uid}.json`);
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
// Temp-then-rename, the same pattern server.js uses: a half-written db.json is the one failure
// here that loses real accounts.
const writeJson = (f, o) => {
  const tmp = `${f}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2));
  fs.renameSync(tmp, f);
};

if (!fs.existsSync(dbFile)) {
  console.error(`No db.json at ${dbFile}\nSet DATA_DIR to the instance you mean, e.g.\n  DATA_DIR=/home/you/fitpal-coach-data node seed-demo.mjs`);
  process.exit(1);
}
const db = readJson(dbFile);
db.users ||= []; db.assignments ||= [];

const isDemo = id => String(id || '').startsWith(DEMO_PREFIX);
const seeded = db.users.filter(u => isDemo(u.id));

/* ---------- dates ---------- */
const DAY = 86400000;
const iso = d => new Date(d).toISOString().slice(0, 10);
const daysAgo = n => iso(Date.now() - n * DAY);
const at = (n, hour = 18) => Date.now() - n * DAY + (hour - 12) * 3600000;
// Weekday index for an ISO date, Monday = 1, matching S.week's keys.
const dayIndexOf = isoDate => { const d = new Date(isoDate + 'T00:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };

/* ---------- exercises (real ids from lib/exercises-data.js) ---------- */
const EX = {
  bench: '0025', squat: '0043', deadlift: '0032', pullup: '0652', row: '0027',
  dbBench: '0289', curl: '0294', rdl: '0085', pulldown: '2330', legPress: '2287',
};

/* ---------- the roster ----------
 * Each persona is built to light up a different part of the coach's Today screen, so the
 * "needs attention" list and the adherence bars have something real to disagree about.
 */
const PEOPLE = [
  {
    key: 'nadia', name: 'Nadia El Amrani', joinedDaysAgo: 96,
    plan: 'ppl', trains: [1, 3, 5], weeks: 13, missRate: 0.08,
    startBw: 71.5, endBw: 68.2, checkinDay: 0, checkinWeeks: 12, checkinBase: 4.2,
    program: 'Push / Pull / Legs', accepted: 92,
    note: 'Consistent, progressing, nothing to fix — the shape of a client doing fine.',
  },
  {
    key: 'karim', name: 'Karim Benali', joinedDaysAgo: 141,
    plan: 'upper-lower', trains: [1, 2, 4, 5], weeks: 20, missRate: 0.05,
    startBw: 78.0, endBw: 83.4, checkinDay: 0, checkinWeeks: 18, checkinBase: 4.5,
    program: 'Upper / Lower', accepted: 137,
    note: 'Four days a week, gaining, the longest history on the roster.',
  },
  {
    key: 'sara', name: 'Sara Mansouri', joinedDaysAgo: 26,
    plan: 'full-body', trains: [1, 3, 5], weeks: 3, missRate: 0.22,
    startBw: 64.0, endBw: 63.1, checkinDay: 0, checkinWeeks: 3, checkinBase: 3.4,
    program: 'Full body — beginner', accepted: 24,
    note: 'Three weeks in, still finding the habit. Check-ins say tired.',
  },
  {
    key: 'youssef', name: 'Youssef Idrissi', joinedDaysAgo: 118,
    plan: 'ppl', trains: [1, 3, 5], weeks: 14, missRate: 0.12, stoppedDaysAgo: 16,
    startBw: 88.0, endBw: 86.9, checkinDay: 0, checkinWeeks: 12, checkinBase: 3.1,
    checkinStoppedDaysAgo: 16,
    program: 'Push / Pull / Legs', accepted: 110,
    note: 'Was solid, then stopped 16 days ago. Should surface as inactive and check-in overdue.',
  },
  {
    key: 'lina', name: 'Lina Cherkaoui', joinedDaysAgo: 34,
    plan: 'full-body', trains: [2, 4], weeks: 4, missRate: 0.15,
    startBw: 59.5, endBw: 59.8, checkinDay: 0, checkinWeeks: 4, checkinBase: 3.9,
    pendingProgram: 'Upper / Lower', pendingDaysAgo: 3,
    note: 'Training on an old plan; a new program is waiting on her to accept.',
  },
  {
    key: 'omar', name: 'Omar Tazi', joinedDaysAgo: 2,
    plan: null, trains: [], weeks: 0, missRate: 0,
    startBw: 74.0, endBw: 74.0, checkinDay: 0, checkinWeeks: 0,
    note: 'Signed up two days ago. No program, no history — the new-client case.',
  },
];

/* ---------- plans ---------- */
const PLANS = {
  ppl: [
    { name: 'Push', emoji: 'arm', ex: [[EX.bench, 4, 6], [EX.dbBench, 3, 10], [EX.curl, 3, 12]] },
    { name: 'Pull', emoji: 'pullup', ex: [[EX.row, 4, 8], [EX.pulldown, 3, 10], [EX.pullup, 3, 8]] },
    { name: 'Legs', emoji: 'legs', ex: [[EX.squat, 4, 6], [EX.rdl, 3, 8], [EX.legPress, 3, 12]] },
  ],
  'upper-lower': [
    { name: 'Upper A', emoji: 'arm', ex: [[EX.bench, 4, 5], [EX.row, 4, 6], [EX.curl, 3, 10]] },
    { name: 'Lower A', emoji: 'legs', ex: [[EX.squat, 4, 5], [EX.rdl, 3, 8]] },
    { name: 'Upper B', emoji: 'pullup', ex: [[EX.pullup, 4, 6], [EX.dbBench, 4, 8], [EX.pulldown, 3, 12]] },
    { name: 'Lower B', emoji: 'legs', ex: [[EX.deadlift, 3, 5], [EX.legPress, 4, 10]] },
  ],
  'full-body': [
    { name: 'Full body A', emoji: 'barbell', ex: [[EX.squat, 3, 8], [EX.bench, 3, 8], [EX.row, 3, 10]] },
    { name: 'Full body B', emoji: 'kettlebell', ex: [[EX.deadlift, 3, 5], [EX.dbBench, 3, 10], [EX.pulldown, 3, 12]] },
  ],
};

// Opening working weight per exercise, in kg, and what it climbs by each time it is trained.
// Deliberately unequal: a roster where everyone adds 2.5 kg a week reads as generated.
const START_W = { [EX.bench]: 45, [EX.squat]: 55, [EX.deadlift]: 70, [EX.pullup]: 0, [EX.row]: 40,
  [EX.dbBench]: 20, [EX.curl]: 10, [EX.rdl]: 45, [EX.pulldown]: 35, [EX.legPress]: 80 };
const STEP_W = { [EX.bench]: 1.25, [EX.squat]: 2.5, [EX.deadlift]: 2.5, [EX.pullup]: 0, [EX.row]: 1.25,
  [EX.dbBench]: 1, [EX.curl]: 0.5, [EX.rdl]: 2.5, [EX.pulldown]: 1.25, [EX.legPress]: 5 };

// A small deterministic PRNG, seeded per person: the roster must look the same every run so
// --remove followed by a re-seed does not silently produce a different history.
const rng = seedStr => {
  let h = 2166136261;
  for (const ch of seedStr) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
};

function buildState(p) {
  const rand = rng(p.key);
  const routines = (PLANS[p.plan] || []).map((r, i) => ({
    id: `${DEMO_PREFIX}${p.key}-r${i}`, name: r.name, emoji: r.emoji,
    ex: r.ex.map(([id, sets, reps]) => ({ id, sets, reps, weight: START_W[id] || 20 })),
  }));

  // day index -> [routineId]; S.week is day -> ARRAY everywhere (the P0 bug was code reading it
  // as a scalar), so build it that way here too.
  const week = {};
  p.trains.forEach((day, i) => { if (routines.length) week[day] = [routines[i % routines.length].id]; });

  const workouts = [];
  const doneCount = {};                       // exId -> how many times trained, drives the weight
  const firstDay = p.joinedDaysAgo;
  const lastDay = p.stoppedDaysAgo || 0;
  for (let d = firstDay; d >= lastDay; d--) {
    const date = daysAgo(d);
    const di = dayIndexOf(date);
    if (!p.trains.includes(di)) continue;
    if (rand() < p.missRate) continue;         // a missed session, which is what adherence is for
    const routine = routines[p.trains.indexOf(di) % routines.length];
    if (!routine) continue;
    const entries = routine.ex.map(e => {
      const n = (doneCount[e.id] = (doneCount[e.id] || 0) + 1);
      const w = Math.round(((START_W[e.id] || 20) + (STEP_W[e.id] || 1) * (n - 1)) * 2) / 2;
      const sets = [];
      for (let s = 0; s < e.sets; s++) {
        // The last set drops a rep or two, the way a real one does.
        const r = s === e.sets - 1 ? Math.max(1, e.reps - (rand() < 0.5 ? 1 : 2)) : e.reps;
        sets.push({ w, r, done: true });
      }
      return { id: e.id, sets };
    });
    workouts.push({ d: date, start: at(d), name: routine.name, entries });
  }

  // Body weight, one reading a week, drifting from startBw to endBw with a little noise.
  const bodyweight = [];
  // floor, not round: rounding up overshoots the last step past today and files a weigh-in dated
  // in the future, which every chart then draws a line out to.
  const bwWeeks = Math.max(1, Math.floor(p.joinedDaysAgo / 7));
  for (let i = 0; i <= bwWeeks; i++) {
    const back = Math.max(0, p.joinedDaysAgo - i * 7);
    const t = i / bwWeeks;
    const w = p.startBw + (p.endBw - p.startBw) * t + (rand() - 0.5) * 0.6;
    bodyweight.push({ d: daysAgo(back), w: Math.round(w * 10) / 10 });
  }

  // Weekly check-ins, Sunday-filed, scores wobbling around the persona's baseline.
  const checkins = [];
  const stopCheckins = p.checkinStoppedDaysAgo || 0;
  for (let i = 0; i < (p.checkinWeeks || 0); i++) {
    const back = stopCheckins + i * 7;
    if (back > p.joinedDaysAgo) break;
    const jitter = () => Math.max(1, Math.min(5, Math.round(p.checkinBase + (rand() - 0.5) * 1.6)));
    checkins.push({
      d: daysAgo(back), t: at(back, 20),
      answers: { energy: jitter(), sleep: jitter(), recovery: jitter(), stress: jitter(), nutrition: jitter() },
      ...(i === 0 && p.note ? {} : {}),
    });
  }
  checkins.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));

  return {
    _ts: at(Math.max(0, lastDay), 20),
    routines, week, workouts, bodyweight, checkins,
    checkinDay: p.checkinDay ?? 0,
    measurements: [], meals: [], foods: [], customEx: [], programs: [], dayPlan: {},
    unit: 'kg', weekStart: 1, barWeights: {},
    gymCards: [], lastGymCardId: null, checkIn: true,
  };
}

/* ---------- actions ---------- */
function list() {
  if (!seeded.length) { console.log('Nothing seeded — no users with the ' + DEMO_PREFIX + ' prefix.'); return; }
  console.log(`${seeded.length} demo client(s):`);
  for (const u of seeded) {
    const st = fs.existsSync(stateFile(u.id)) ? readJson(stateFile(u.id)) : {};
    console.log(`  ${u.id.padEnd(20)} ${String(u.name).padEnd(22)} ${(st.workouts || []).length} workouts, ${(st.checkins || []).length} check-ins, coach=${u.coachId}`);
  }
  const as = db.assignments.filter(a => isDemo(a.memberId));
  console.log(`  ${as.length} assignment(s): ` + (as.map(a => a.status).join(', ') || 'none'));
}

function backup() {
  const dest = `${dbFile}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(dbFile, dest);
  console.log(`db.json backed up to ${path.basename(dest)}`);
}

function remove() {
  if (!seeded.length) { console.log('Nothing to remove.'); return; }
  backup();
  let files = 0;
  for (const u of seeded) {
    for (const f of [stateFile(u.id), path.join(DATA, `media-${u.id}.json`), path.join(DATA, `coach-${u.id}.json`)]) {
      if (fs.existsSync(f)) { fs.unlinkSync(f); files++; }
    }
  }
  const before = db.users.length + db.assignments.length;
  db.users = db.users.filter(u => !isDemo(u.id));
  db.assignments = db.assignments.filter(a => !isDemo(a.memberId));
  writeJson(dbFile, db);
  console.log(`Removed ${seeded.length} demo user(s), ${before - db.users.length - db.assignments.length} row(s) total, ${files} state file(s).`);
  console.log('\nRestart the API so it drops its in-memory copy of db.json.');
}

function seed() {
  if (seeded.length) {
    console.error(`Already seeded — ${seeded.length} demo client(s) present. Run --remove first, or --list to see them.`);
    process.exit(1);
  }
  const wanted = valOf('--coach');
  const coaches = db.users.filter(u => u.coach || u.admin);
  const coach = wanted ? db.users.find(u => u.id === wanted) : coaches[0];
  if (!coach) {
    console.error(wanted ? `No user with id ${wanted}.`
      : 'No coach found in db.json. Pass --coach <id>; these are the users:\n' +
        db.users.map(u => `  ${u.id}  ${u.name}${u.coach ? '  (coach)' : ''}${u.admin ? '  (admin)' : ''}`).join('\n'));
    process.exit(1);
  }
  if (!wanted && coaches.length > 1) {
    console.error(`More than one coach/admin in db.json — say which:\n` +
      coaches.map(u => `  --coach ${u.id}   (${u.name})`).join('\n'));
    process.exit(1);
  }
  backup();

  const now = new Date().toISOString();
  let workouts = 0, checkins = 0;
  for (const p of PEOPLE) {
    const id = DEMO_PREFIX + p.key;
    const S = buildState(p);
    workouts += S.workouts.length; checkins += S.checkins.length;
    fs.writeFileSync(stateFile(id), JSON.stringify(S));
    db.users.push({ id, name: p.name, coachId: coach.id, created: new Date(Date.now() - p.joinedDaysAgo * DAY).toISOString() });

    // An accepted assignment is what makes "Current program" show something on the client page.
    const bundleOf = label => ({
      name: label,
      routines: S.routines.map(r => ({ id: r.id, name: r.name, emoji: r.emoji, ex: r.ex })),
      week: S.week,
    });
    if (p.program) {
      db.assignments.push({
        id: crypto.randomBytes(12).toString('base64url'),
        coachId: coach.id, coachName: coach.name, memberId: id,
        bundle: bundleOf(p.program), note: 'Start light and add a little each week.',
        schedule: true, created: new Date(Date.now() - p.accepted * DAY).toISOString(),
        status: 'accepted', decidedAt: new Date(Date.now() - (p.accepted - 1) * DAY).toISOString(),
      });
    }
    if (p.pendingProgram) {
      db.assignments.push({
        id: crypto.randomBytes(12).toString('base64url'),
        coachId: coach.id, coachName: coach.name, memberId: id,
        bundle: bundleOf(p.pendingProgram), note: 'Moving you to four days — see what you think.',
        schedule: true, created: new Date(Date.now() - p.pendingDaysAgo * DAY).toISOString(),
        status: 'pending',
      });
    }
    console.log(`  ${id.padEnd(16)} ${String(p.name).padEnd(22)} ${String(S.workouts.length).padStart(3)} workouts  ${String(S.checkins.length).padStart(2)} check-ins   ${p.note}`);
  }
  writeJson(dbFile, db);
  console.log(`\nSeeded ${PEOPLE.length} clients onto ${coach.name} (${coach.id}) — ${workouts} workouts, ${checkins} check-ins, seeded ${now.slice(0, 10)}.`);
  console.log('None of them has a credential, so nobody can sign in as one.');
  console.log('\nRestart the API so it drops its in-memory copy of db.json, then open the coach app.');
  console.log('To undo: node seed-demo.mjs --remove');
}

if (has('--list')) list();
else if (has('--remove')) remove();
else seed();
