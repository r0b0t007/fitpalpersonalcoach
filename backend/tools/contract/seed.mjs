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
// R2 coaching data, so the routes answer from IMPORTED rows too (fitpal:import-legacy, CHW-251), on
// the second coach and their client: a code of each kind, offers in every state, a library. Offer
// dates are recent: Node prunes past 30 days on every send and Laravel hourly, so an old seeded
// offer would part the two servers for a reason that is not a bug.
const iso = n => new Date(Date.now() - n * 86400000).toISOString();
const PLAN = name => ({ opengym_plan: 1, name, week: { 1: ['r1'], 3: ['r1'] }, routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3 }] }], customEx: [], nutrition: { kcal: 2200 }, checkinDay: 0 });
const INVITES = [
  { code: 'SEEDOPENB0000000', note: '  for a friend ', createdBy: 'cdCoachB00000000', created: '2026-03-07T00:00:00.000Z', coachId: 'cdCoachB00000000' },
  { code: 'SEEDUSEDB0000000', note: 'Salma', createdBy: 'cdCoachB00000000', created: '2026-03-08T00:00:00.000Z', coachId: 'cdCoachB00000000', usedBy: 'cdMemberB0000000', usedAt: '2026-03-09T00:00:00.000Z' },
  { code: 'SEEDREVOKED00000', note: 'mistyped', createdBy: 'cdAdmin000000000', created: '2026-03-10T00:00:00.000Z', revoked: true, revokedAt: '2026-03-11T00:00:00.000Z', revokedReason: 'coach detached' },
  { code: 'SEEDGENERAL00000', note: 'general', createdBy: 'cdAdmin000000000', created: '2026-03-12T00:00:00.000Z' },
];
const offer = (id, status, created, decided, name) => ({
  id, coachId: 'cdCoachB00000000', coachName: 'Coach Youssef', memberId: 'cdMemberB0000000', bundle: PLAN(name),
  note: 'from the seed', schedule: status === 'pending', created: iso(created), status, ...(decided ? { decidedAt: iso(decided) } : {}),
});
const ASSIGNMENTS = [
  offer('seedAccepted0000', 'accepted', 10, 9, 'Block A'),
  offer('seedDeclined0000', 'declined', 8, 7, 'Block B'),
  offer('seedWithdrawn000', 'withdrawn', 6, 5, 'Oops'),
  offer('seedPending00000', 'pending', 3, null, 'Block C'),
];
// R3 media and push (fitpal:import-legacy, CHW-264): a demo of the first coach's with its file, a
// client's progress photo with its file, and a subscription. The endpoint is under .invalid: a push
// either server tries for it fails at DNS and reaches nobody.
const DEMO_BYTES = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(4), Buffer.from('isomavc1'), Buffer.from('a seeded demo'.padEnd(64, '.'))]);
const PHOTO_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a seeded photo'.padEnd(96, '.'))]);
const MEDIA = [
  { id: 'seedMedia0000001', exId: '0031', coachId: 'cdCoach000000000', file: '0031-5eed5eed5eed5eed.mp4', label: 'Seeded', bytes: DEMO_BYTES.length, mime: 'video/mp4', status: 'ready', created: '2026-03-15T00:00:00.000Z' },
];
const SUBS = [
  { userId: 'cdMemberB0000000', endpoint: 'https://push.invalid/seeded', keys: { p256dh: 'BSeededKeyForTheContractOnly', auth: 'seededAuth' }, created: '2026-03-16T00:00:00.000Z' },
];
mkdirSync(join(dir, 'media', 'ex'), { recursive: true });
writeFileSync(join(dir, 'media', 'ex', MEDIA[0].file), DEMO_BYTES);
mkdirSync(join(dir, 'media', 'photo', 'cdMemberB0000000'), { recursive: true });
writeFileSync(join(dir, 'media', 'photo', 'cdMemberB0000000', 'seededPhotoFileName0001.jpg'), PHOTO_BYTES);
writeFileSync(join(dir, 'media-cdMemberB0000000.json'), JSON.stringify({ photos: [
  { id: 'seedPhoto0000001', d: '2026-03-15', pose: 'front', file: 'seededPhotoFileName0001.jpg', bytes: PHOTO_BYTES.length, mime: 'image/jpeg', created: '2026-03-15T09:00:00.000Z' },
] }));
writeFileSync(join(dir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: SUBS, media: MEDIA, invites: INVITES, assignments: ASSIGNMENTS }, null, 2));
writeFileSync(join(dir, 'coach-cdCoachB00000000.json'), JSON.stringify({
  programs: [
    { id: 'seed-prog-1', name: 'Seeded block', created: 1772000000000, updated: 1772000005000, bundle: { ...PLAN('Seeded block'), week: {} } },
    { id: 'seed-prog-2', name: 'Seeded deload', created: 1772000010000, updated: 1772000010000, bundle: PLAN('Seeded deload') },
  ],
  notes: { cdMemberB0000000: 'read by no route' },
}));
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
