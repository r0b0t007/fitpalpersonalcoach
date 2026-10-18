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
const USERS = [
  { id: 'cdAdmin000000000', name: 'Owner', admin: true, created: '2026-01-02T03:04:05.000Z' },
  { id: 'cdCoach000000000', name: 'Coach Amina', coach: true, created: '2026-02-01T00:00:00.000Z' },
  { id: 'cdMember00000000', name: 'Member Karim', coachId: 'cdCoach000000000', created: '2026-03-01T00:00:00.000Z' },
  { id: 'cdBare0000000000', name: 'No State Yet', created: '2026-03-02T00:00:00.000Z' },
  { id: 'cdGone0000000000', name: 'Disabled', disabled: true, created: '2026-03-03T00:00:00.000Z' },
  { id: 'cdWipe0000000000', name: 'Signs Out Everywhere', sv: 2, created: '2026-03-04T00:00:00.000Z' },
  { id: 'cdSync0000000000', name: 'Syncs', created: '2026-03-05T00:00:00.000Z' },
];

writeFileSync(join(dir, 'secret'), SECRET, { mode: 0o600 });
writeFileSync(join(dir, 'db.json'), JSON.stringify({ users: USERS, creds: [], subs: [], invites: [] }, null, 2));
// {} and [] kept apart, unicode, nesting: the shapes a raw-blob store must hand back untouched.
writeFileSync(join(dir, 'state-cdMember00000000.json'), JSON.stringify({
  unit: 'kg', lang: 'fr', week: {}, dayPlan: {}, history: [{ d: '2026-05-01', note: 'Séance « jambes » — ok', ex: [] }],
  bodyweight: [[1790000000000, 81.5]], _ts: 1790000000000,
}));
console.log(`seeded ${USERS.length} accounts in ${dir}`);
