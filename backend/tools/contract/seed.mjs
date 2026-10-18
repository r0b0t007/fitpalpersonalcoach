#!/usr/bin/env node
// Writes a Node API data directory for the contract diff (diff.mjs): the session secret, a db.json
// with one account per role the R1 routes distinguish, and their training state. The Node API
// serves it as-is; Laravel gets the same through `php artisan fitpal:import-legacy`, with
// SESSION_SECRET set to the same secret — so one minted token is valid on both servers.
//
//   node backend/tools/contract/seed.mjs <dataDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: seed.mjs <dataDir>'); process.exit(2); }
mkdirSync(dir, { recursive: true });

// Fixed, not random: the diff is reproducible, and nothing here is a real secret.
const SECRET = 'c0ffee'.repeat(10) + 'beef';
// In signup order, as db.json is: the roster lists accounts in this order, and Laravel orders by
// creation date, so the dates rise with the array — with the one account from before Node kept
// dates first, as the oldest ones are.
const USERS = [
  // R2: a client of the second coach (below), listed before their coach as db.json can.
  { id: 'cdMemberB0000000', name: 'Member Salma', coachId: 'cdCoachB00000000', created: null },
  { id: 'cdAdmin000000000', name: 'Owner', admin: true, created: '2026-01-02T03:04:05.000Z' },
  { id: 'cdCoach000000000', name: 'Coach Amina', coach: true, created: '2026-02-01T00:00:00.000Z' },
  { id: 'cdMember00000000', name: 'Member Karim', coachId: 'cdCoach000000000', created: '2026-03-01T00:00:00.000Z' },
  { id: 'cdBare0000000000', name: 'No State Yet', created: '2026-03-02T00:00:00.000Z' },
  { id: 'cdGone0000000000', name: 'Disabled', disabled: true, created: '2026-03-03T00:00:00.000Z' },
  { id: 'cdWipe0000000000', name: 'Signs Out Everywhere', sv: 2, created: '2026-03-04T00:00:00.000Z' },
  { id: 'cdSync0000000000', name: 'Syncs', created: '2026-03-05T00:00:00.000Z' },
  // R2: a second coach, for the roster's tenant boundary; milliseconds in the date.
  { id: 'cdCoachB00000000', name: 'Coach Youssef', coach: true, created: '2026-03-06T08:09:10.123Z' },
];
// Dates inside the adherence window are written relative to the day the seed runs, so the trim
// (30 days on the server's UTC date) has something on both sides of its edge.
const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

writeFileSync(join(dir, 'secret'), SECRET, { mode: 0o600 });
writeFileSync(join(dir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }, null, 2));
// {} and [] kept apart, unicode, nesting: the shapes a raw-blob store must hand back untouched.
writeFileSync(join(dir, 'state-cdMember00000000.json'), JSON.stringify({
  unit: 'kg', lang: 'fr', week: { 1: 'rA', 4: 'rB' }, dayPlan: { [day(40)]: 'rest', [day(2)]: 'rA' }, mealDays: {},
  history: [{ d: '2026-05-01', note: 'Séance « jambes » — ok', ex: [] }],
  routines: [{ id: 'rA', name: 'Jambes', emoji: '🦵', ex: [{ id: 'squat' }] }, { id: 'rB', name: 'Haut', ex: [{ id: 'bench' }] }, { id: 'rEmpty', name: 'Vide', ex: [] }],
  workouts: [{ d: day(45), ex: [] }, { d: day(3), ex: [] }, { d: day(3), ex: [] }, { d: day(1), ex: [] }],
  checkins: [{ d: '2026-05-10', weight: 81 }, { d: '2026-05-03', weight: 82 }], checkinDay: 3,
  measurements: [[1790000000000, { waist: 84 }]], nutriTarget: { kcal: 2400 },
  bodyweight: [[1790000000000, 81.5]], _ts: 1790000000000,
}));
writeFileSync(join(dir, 'state-cdMemberB0000000.json'), JSON.stringify({ unit: 'lb', body: 'female', targetW: 140, _ts: 1790000000456 }));
console.log(`seeded ${USERS.length} accounts in ${dir}`);
