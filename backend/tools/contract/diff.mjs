#!/usr/bin/env node
// Does the Laravel backend answer like the Node API? Every ported route, called on both servers seeded
// from the same data directory (seed.mjs), with the same session token, compared:
//
//   - the status code, always;
//   - `error` and `msg` exactly — they are the app's translation keys;
//   - the body exactly where it is deterministic (/me, /config, /data, …), or by SHAPE (keys and
//     value types) where values legitimately differ between two servers (challenges, codes,
//     timestamps, ids);
//   - the headers the app or the browser relies on (Cache-Control, CORS, Set-Cookie names).
//
// A difference that is intended is listed in INTENDED with its reason; anything else fails.
//
//   node diff.mjs --node http://localhost:3101 --laravel http://localhost:3102 --data <seeded dir>
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { node: { type: 'string' }, laravel: { type: 'string' }, data: { type: 'string' } } });
if (!opt.node || !opt.laravel || !opt.data) { console.error('usage: diff.mjs --node URL --laravel URL --data DIR'); process.exit(2); }

const SECRET = readFileSync(join(opt.data, 'secret'), 'utf8').trim();

// The token both servers accept: `uid:expiryMs:sv` + `.` + base64url HMAC-SHA256 (api/server.js sign).
const token = (uid, sv = 0) => {
  const payload = `${uid}:${Date.now() + 86400000}:${sv}`;
  return payload + '.' + createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const bearer = (uid, sv) => ({ Authorization: 'Bearer ' + token(uid, sv) });

/**
 * Differences that are meant. Key: case name + ' ' + the whole difference as reported, VALUES
 * INCLUDED — so an entry excuses exactly the difference it documents, and any other value at the
 * same path (a cacheable header, a non-empty list) is reported like any other change.
 */
const INTENDED = {
  'config $.self_serve: only Laravel has it (false)': 'the self-serve coach signup flag for R4 (/#/start); the app ignores unknown keys.',
  'login options $.options.allowCredentials: only Node has it ([])': 'Laragear omits an empty list. Same meaning in WebAuthn (any discoverable passkey), and the app reads `(o.allowCredentials || [])` (frontend/src/lib/api.js).',
  'me, admin headers.cache-control: Node "no-store" vs Laravel "no-store, private"': 'Symfony always adds private when neither public nor private is set. no-store already forbids every cache.',
  'preflight headers.cache-control: only Laravel has it ("no-cache, private")': 'browsers cache a preflight by Access-Control-Max-Age (86400 on both), never by Cache-Control.',
  'programs save, a name cut through an emoji (lone surrogate) $.program.name: Node "Push \\ud83d" vs Laravel "Push �"': 'half a UTF-16 character cannot be held in UTF-8, nor stored in utf8mb4; Laravel keeps it as U+FFFD (Input::parse) where Node kept the escape in its JSON file. What matters is kept: Node accepted such a name, and so does Laravel, instead of refusing it as bad json.',
  'programs save, a name cut through an emoji (lone surrogate) $.program.bundle.name: Node "Push \\ud83d" vs Laravel "Push �"': 'the same name, copied into the bundle by cleanProgram.',
  'register options, a key that starts with NUL status: Node 200 vs Laravel 400': 'no PHP object can hold a property name that starts with NUL, so Input::parse refuses such a body as bad json (documented there). The app never sends one; the fields the route reads are unaffected either way.',
};

// --- comparison ---------------------------------------------------------------------------------
const shape = v => Array.isArray(v) ? (v.length ? [shape(v[0])] : [])
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, shape(v[k])]))
  : v === null ? 'null' : typeof v;

function diffs(a, b, path = '$') {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [`${path}: ${a.length} items vs ${b.length}`];
    return a.flatMap((x, i) => diffs(x, b[i], `${path}[${i}]`));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap(k => !(k in a) ? [`${path}.${k}: only Laravel has it (${JSON.stringify(b[k])})`]
      : !(k in b) ? [`${path}.${k}: only Node has it (${JSON.stringify(a[k])})`]
      : diffs(a[k], b[k], `${path}.${k}`));
  }
  return JSON.stringify(a) === JSON.stringify(b) ? [] : [`${path}: Node ${JSON.stringify(a)} vs Laravel ${JSON.stringify(b)}`];
}

async function call(base, { method = 'GET', path, headers = {}, body, raw }) {
  const init = { method, headers: { ...headers }, redirect: 'manual' };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  if (raw !== undefined) { init.body = raw; init.headers['Content-Type'] = 'application/json'; }
  let res, text;
  try {
    res = await fetch(base + path, init);
    text = await res.text();
  } catch (e) {
    // A dropped connection is a result to report, not a crash that hides every other case.
    return { status: 0, json: { networkError: String(e.cause?.code || e.message) }, cookies: [], headers: {} };
  }
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = { __notJson: text.slice(0, 80) }; }
  const cookies = (res.headers.getSetCookie?.() || []).map(c => c.split('=')[0]).sort();
  return {
    status: res.status, json, cookies,
    headers: Object.fromEntries(['cache-control', 'access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-expose-headers', 'access-control-max-age']
      .map(h => [h, res.headers.get(h)]).filter(([, v]) => v !== null)),
  };
}

// --- the cases ------------------------------------------------------------------------------------
// mode: 'exact' compares the JSON body; 'shape' its keys and types (error/msg still exactly).
// Cases run in order on each server; later ones may depend on earlier side effects (both servers
// get the same sequence, so they stay in step).
// The roster's `now` is each server's own clock: compared as a number, not a value.
const clockless = req => async base => {
  const r = await call(base, req);
  if (typeof r.json?.now === 'number') r.json.now = 'a number';
  return r;
};
const release = (uid, id) => ({ method: 'POST', path: '/api/coach/member/release', headers: bearer(uid), body: { id } });

// Invites are minted inside the run on each server (Laravel imports Node's with CHW-251), so a
// case that needs a code mints its own first and then asks about it.
const mint = async (base, uid, note = 'contract', route = '/api/coach/invites/new') =>
  (await call(base, { method: 'POST', path: route, headers: bearer(uid), body: { note } })).json?.invite?.code;
const coachCode = base => mint(base, 'cdCoach000000000');
const generalCode = base => mint(base, 'cdAdmin000000000', 'general', '/api/admin/invites/new');
const rowOf = async (base, uid, code, route = '/api/coach/invites') =>
  ((await call(base, { path: route, headers: bearer(uid) })).json?.invites || []).find(i => i.code === code);
// A row with its server-made values replaced by their type, so the rest compares exactly.
const typed = row => row && Object.fromEntries(Object.entries(row).map(([k, v]) =>
  [k, ['code', 'created', 'usedAt', 'revokedAt'].includes(k) && typeof v === 'string' ? 'a string' : v]));

// A saved program's clock fields as types; everything else, the stored bundle above all, exactly.
const clockFree = prog => prog && { ...prog, created: typeof prog.created, updated: typeof prog.updated };
const progReq = (uid, body) => ({ method: 'POST', path: '/api/coach/programs/save', headers: bearer(uid), body });
const PLAN = (over = {}) => ({ opengym_plan: 1, name: 'x', week: { 1: ['r1'] }, routines: [{ id: 'r1', name: '  Push  ', ex: [{ id: '0025', sets: 3 }] }], customEx: [], ...over });
// Just the saved row: for cases run after a program with a made-up id is in the library.
const savedOne = req => async base => {
  const r = await call(base, req);
  return { ...r, json: r.json?.error ? r.json : { program: clockFree(r.json?.program) } };
};
const saved = req => async base => {
  const r = await call(base, req);
  return { ...r, json: r.json?.error ? r.json : { program: clockFree(r.json?.program), programs: (r.json?.programs || []).map(clockFree) } };
};

// Assignments: ids and timestamps are each server's own, so they compare as a check of their form.
const assignReq = (uid, body) => ({ method: 'POST', path: '/api/coach/assign', headers: bearer(uid), body });
const offers = rows => Array.isArray(rows) ? rows.map(a => ({
  ...a, id: /^[A-Za-z0-9_-]{16}$/.test(a.id) ? 'an id' : a.id, created: typeof a.created,
  ...('decidedAt' in a ? { decidedAt: typeof a.decidedAt } : {}),
})) : rows;
const listOf = path => uid => async base => {
  const r = await call(base, { path, headers: bearer(uid) });
  return { ...r, json: r.json?.error ? r.json : { assignments: offers(r.json?.assignments) } };
};
const inboxOf = listOf('/api/assignments');
const historyOf = listOf('/api/assignments/history');
const firstOffer = async (base, uid) => ((await call(base, { path: '/api/assignments', headers: bearer(uid) })).json?.assignments || [])[0]?.id;
const withdrawReq = (uid, id) => ({ method: 'POST', path: '/api/coach/assignments/withdraw', headers: bearer(uid), body: { id } });
const decideReq = (uid, id, accept) => ({ method: 'POST', path: '/api/assignments/decide', headers: bearer(uid), body: { id, accept } });

// Admin account controls: one request, then whatever it changed, read back.
const adminReq = (path, body) => ({ method: 'POST', path: '/api/admin/user/' + path, headers: bearer('cdAdmin000000000'), body });
const usersOf = async (base, pred) => ((await call(base, { path: '/api/admin/users', headers: bearer('cdAdmin000000000') })).json?.users || []).filter(pred).map(u => u.id);
const codesOf = async (base, coachId) => ((await call(base, { path: '/api/admin/invites', headers: bearer('cdAdmin000000000') })).json?.invites || [])
  .filter(i => i.coachId === coachId).map(typed);

const fat = JSON.stringify({ state: { pad: 'x'.repeat(17 * 1024 * 1024) } });
const CASES = [
  { name: 'health', req: { path: '/api/health' }, mode: 'exact' },
  { name: 'config', req: { path: '/api/config' }, mode: 'exact' },
  { name: 'unknown route', req: { path: '/api/nope' }, mode: 'exact' },
  { name: 'wrong method', req: { method: 'DELETE', path: '/api/me' }, mode: 'exact' },
  { name: 'preflight', req: { method: 'OPTIONS', path: '/api/anything', headers: { Origin: 'https://localhost' } }, mode: 'exact', headers: true },
  { name: 'me, anonymous', req: { path: '/api/me' }, mode: 'exact' },
  { name: 'me, forged token', req: { path: '/api/me', headers: { Authorization: 'Bearer cdAdmin000000000:9999999999999:0.AAAA' } }, mode: 'exact' },
  { name: 'me, admin', req: { path: '/api/me', headers: bearer('cdAdmin000000000') }, mode: 'exact', headers: true },
  { name: 'me, coach', req: { path: '/api/me', headers: bearer('cdCoach000000000') }, mode: 'exact' },
  { name: 'me, member with a coach', req: { path: '/api/me', headers: bearer('cdMember00000000') }, mode: 'exact' },
  { name: 'me, by cookie', req: { path: '/api/me', headers: { Cookie: 'gymsid=' + token('cdCoach000000000') } }, mode: 'exact' },
  { name: 'me, disabled', req: { path: '/api/me', headers: bearer('cdGone0000000000') }, mode: 'exact' },
  { name: 'me, stale session version', req: { path: '/api/me', headers: bearer('cdWipe0000000000', 0) }, mode: 'exact' },
  { name: 'data, member', req: { path: '/api/data', headers: bearer('cdMember00000000') }, mode: 'exact' },
  { name: 'data, no state yet', req: { path: '/api/data', headers: bearer('cdBare0000000000') }, mode: 'exact' },
  { name: 'data, anonymous', req: { path: '/api/data' }, mode: 'exact' },
  { name: 'data put', req: { method: 'PUT', path: '/api/data', headers: bearer('cdSync0000000000'), body: { state: { week: {}, list: [], active: { x: 1 }, _ts: 1790000000123 } } }, mode: 'exact' },
  { name: 'data read back ({} kept, active stripped)', req: { path: '/api/data', headers: bearer('cdSync0000000000') }, mode: 'exact' },
  { name: 'data put without state', req: { method: 'PUT', path: '/api/data', headers: bearer('cdSync0000000000'), body: { nope: 1 } }, mode: 'exact' },
  // Node answers 413 at 16 MB and then resets the socket while the rest is still uploading; its
  // own comment warns a client may see the reset instead of the 413. A reset is retried, not
  // compared: what is being checked is the 413 both servers send when it is read.
  { name: 'data put past the cap', run: async base => {
    let r;
    for (let i = 0; i < 3 && (!r || r.status === 0); i++) r = await call(base, { method: 'PUT', path: '/api/data', headers: bearer('cdSync0000000000'), raw: fat });
    return r;
  }, mode: 'exact' },
  { name: 'register options, invite-only without a code', req: { method: 'POST', path: '/api/register/options', body: { name: 'Stranger' } }, mode: 'exact' },
  { name: 'register options, empty name', req: { method: 'POST', path: '/api/register/options', body: { name: '  ' } }, mode: 'exact' },
  { name: 'register verify, unknown challenge', req: { method: 'POST', path: '/api/register/verify', body: { cid: 'nope', credential: {} } }, mode: 'exact' },
  // Exact, except the two values that must differ: the challenge and the cid are random. rpId,
  // userVerification and timeout are compared — a wrong rpId breaks every passkey login.
  { name: 'login options', run: async base => {
    const r = await call(base, { method: 'POST', path: '/api/login/options', body: {} });
    if (r.json?.options) r.json = { cid: typeof r.json.cid, options: { ...r.json.options, challenge: typeof r.json.options.challenge } };
    return r;
  }, mode: 'exact' },
  { name: 'login verify, unknown challenge', req: { method: 'POST', path: '/api/login/verify', body: { cid: 'nope', credential: {} } }, mode: 'exact' },
  { name: 'login verify, unknown passkey', run: async base => {
    const { json } = await call(base, { method: 'POST', path: '/api/login/options', body: {} });
    return call(base, { method: 'POST', path: '/api/login/verify', body: { cid: json.cid, credential: { id: 'bm8tc3VjaC1wYXNza2V5', rawId: 'bm8tc3VjaC1wYXNza2V5', type: 'public-key', response: {} } } });
  }, mode: 'exact' },
  { name: 'pair create, anonymous', req: { method: 'POST', path: '/api/pair/create' }, mode: 'exact' },
  { name: 'pair create', req: { method: 'POST', path: '/api/pair/create', headers: bearer('cdCoach000000000') }, mode: 'shape' },
  { name: 'pair redeem', run: async base => {
    const created = await call(base, { method: 'POST', path: '/api/pair/create', headers: bearer('cdMember00000000') });
    if (typeof created.json?.code !== 'string') return created;   // reported as a difference, not a TypeError
    const code = created.json.code;
    const first = await call(base, { method: 'POST', path: '/api/pair/redeem', body: { code: code.toLowerCase() }, headers: { Origin: 'https://localhost', 'Sec-Fetch-Site': 'cross-site' } });
    if (typeof first.json?.token !== 'string') return first;
    const again = await call(base, { method: 'POST', path: '/api/pair/redeem', body: { code } });
    const phone = await call(base, { path: '/api/me', headers: { Authorization: 'Bearer ' + first.json.token } });
    return { status: first.status, json: { user: first.json.user, tokenType: typeof first.json.token, again: [again.status, again.json], phone: [phone.status, phone.json] } };
  }, mode: 'exact' },
  // The body as Node's readBody read it (CHW-252): not JSON is 400, past 5 MB is 413, and
  // login/options, which never read one, does not care.
  { name: 'register options, bad json', req: { method: 'POST', path: '/api/register/options', raw: '{"name":' }, mode: 'exact' },
  { name: 'register options, a body over 5 MB', req: { method: 'POST', path: '/api/register/options', raw: ' '.repeat(5 * 1024 * 1024 + 1) }, mode: 'exact' },
  { name: 'register options, a name of JS whitespace only', req: { method: 'POST', path: '/api/register/options', body: { name: '\u00a0\ufeff\u2028' } }, mode: 'exact' },
  { name: 'register options, a name ending in U+0085 (not whitespace to JS)', run: async base => {
    const r = await call(base, { method: 'POST', path: '/api/register/options', body: { name: 'Bob\u0085', code: 'SEEDGENERAL00000' } });
    return { status: r.status, json: { name: r.json?.options?.user?.name ?? r.json } };
  }, mode: 'exact' },
  { name: 'register options, a key that starts with NUL', run: async base => {
    const r = await call(base, { method: 'POST', path: '/api/register/options', raw: '{"name":"Bob","code":"SEEDGENERAL00000","\\u0000x":1}' });
    return { status: r.status, json: {} };
  }, mode: 'exact' },
  { name: 'register verify, bad json', req: { method: 'POST', path: '/api/register/verify', raw: '{"cid":' }, mode: 'exact' },
  { name: 'login verify, bad json', req: { method: 'POST', path: '/api/login/verify', raw: '{"cid":' }, mode: 'exact' },
  { name: 'login options, a malformed body is never read', run: async base => {
    const r = await call(base, { method: 'POST', path: '/api/login/options', raw: '{nope' });
    return { status: r.status, json: { hasCid: typeof r.json?.cid === 'string' } };
  }, mode: 'exact' },
  { name: 'pair redeem, bad json', req: { method: 'POST', path: '/api/pair/redeem', raw: '{"code":' }, mode: 'exact' },
  { name: 'pair redeem, bad code', req: { method: 'POST', path: '/api/pair/redeem', body: { code: 'ZZZZZZZZ' } }, mode: 'exact' },
  { name: 'csrf: a hostile page posting with the cookie', req: { method: 'POST', path: '/api/logout/all', headers: { Cookie: 'gymsid=' + token('cdCoach000000000'), Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } }, mode: 'exact' },
  { name: 'admin audit, anonymous', req: { path: '/api/admin/audit' }, mode: 'exact' },
  { name: 'admin audit, not an admin', req: { path: '/api/admin/audit', headers: bearer('cdCoach000000000') }, mode: 'exact' },
  { name: 'admin audit', req: { path: '/api/admin/audit?limit=5', headers: bearer('cdAdmin000000000') }, mode: 'shape' },
  { name: 'admin audit, failures only', req: { path: '/api/admin/audit?cat=fail&limit=1', headers: bearer('cdAdmin000000000') }, mode: 'shape' },
  { name: 'admin audit clear', req: { method: 'POST', path: '/api/admin/audit/clear', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  // R2 — the coach's clients (CHW-246).
  { name: 'members, anonymous', req: { path: '/api/coach/members' }, mode: 'exact' },
  { name: 'members, a member', req: { path: '/api/coach/members', headers: bearer('cdMember00000000') }, mode: 'exact' },
  { name: 'members, coach', run: clockless({ path: '/api/coach/members', headers: bearer('cdCoach000000000') }), mode: 'exact' },
  { name: 'members, the other coach', run: clockless({ path: '/api/coach/members', headers: bearer('cdCoachB00000000') }), mode: 'exact' },
  { name: 'members, admin (everyone but the disabled)', run: clockless({ path: '/api/coach/members', headers: bearer('cdAdmin000000000') }), mode: 'exact' },
  { name: 'member, own client', req: { path: '/api/coach/member?id=cdMember00000000', headers: bearer('cdCoach000000000') }, mode: 'exact' },
  { name: 'member, admin reads a client with no state', req: { path: '/api/coach/member?id=cdBare0000000000', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: "member, admin reads the other coach's client", req: { path: '/api/coach/member?id=cdMemberB0000000', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: "member, another coach's client", req: { path: '/api/coach/member?id=cdMemberB0000000', headers: bearer('cdCoach000000000') }, mode: 'exact' },
  { name: 'member, nobody', req: { path: '/api/coach/member?id=nope', headers: bearer('cdCoach000000000') }, mode: 'exact' },
  { name: 'member, disabled', req: { path: '/api/coach/member?id=cdGone0000000000', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: 'member, no id', req: { path: '/api/coach/member', headers: bearer('cdCoach000000000') }, mode: 'exact' },
  { name: "release, another coach's client", req: release('cdCoach000000000', 'cdMemberB0000000'), mode: 'exact' },
  { name: 'release, nobody', req: release('cdCoach000000000', 'nobody'), mode: 'exact' },
  { name: 'release, by a member', req: release('cdMember00000000', 'cdMemberB0000000'), mode: 'exact' },
  { name: 'release, by an admin', req: release('cdAdmin000000000', 'cdMemberB0000000'), mode: 'exact' },
  { name: 'members, the other coach after the release', run: clockless({ path: '/api/coach/members', headers: bearer('cdCoachB00000000') }), mode: 'exact' },
  // R2 — invites (CHW-247).
  { name: 'invite, no code', req: { path: '/api/invite' }, mode: 'exact' },
  { name: 'invite, made-up code', req: { path: '/api/invite?code=NOSUCHCODE000000' }, mode: 'exact' },
  { name: 'invite, a coach’s code (lower-cased, trailing space)', run: async base => {
    const code = await coachCode(base);
    return call(base, { path: '/api/invite?code=' + code.toLowerCase() + '%20' });
  }, mode: 'exact' },
  { name: 'invite, a general code names nobody', run: async base => call(base, { path: '/api/invite?code=' + await generalCode(base) }), mode: 'exact' },
  { name: 'coach invites, anonymous', req: { path: '/api/coach/invites' }, mode: 'exact' },
  { name: 'coach invites, a member', req: { path: '/api/coach/invites', headers: bearer('cdMember00000000') }, mode: 'exact' },
  { name: 'coach invites new', run: async base => {
    const r = await call(base, { method: 'POST', path: '/api/coach/invites/new', headers: bearer('cdCoach000000000'), body: { note: 'for Nadia' } });
    return { ...r, json: { invite: typed(r.json?.invite) } };
  }, mode: 'exact' },
  { name: 'coach invites, a fresh code in the list', run: async base => {
    const code = await coachCode(base);
    const r = await call(base, { path: '/api/coach/invites', headers: bearer('cdCoach000000000') });
    return { ...r, json: { max: r.json?.max, row: typed(r.json?.invites?.find(i => i.code === code)) } };
  }, mode: 'exact' },
  { name: 'coach invites, not the other coach’s', run: async base => {
    const code = await coachCode(base);
    return { status: 200, json: { seen: !!await rowOf(base, 'cdCoachB00000000', code) } };
  }, mode: 'exact' },
  { name: 'coach invites revoke, by the other coach', run: async base =>
    call(base, { method: 'POST', path: '/api/coach/invites/revoke', headers: bearer('cdCoachB00000000'), body: { code: await coachCode(base) } }), mode: 'exact' },
  { name: 'coach invites revoke, an admin’s general code', run: async base =>
    call(base, { method: 'POST', path: '/api/coach/invites/revoke', headers: bearer('cdCoach000000000'), body: { code: await generalCode(base) } }), mode: 'exact' },
  { name: 'coach invites revoke, by the owner (then flagged in the list)', run: async base => {
    const code = await coachCode(base);
    const r = await call(base, { method: 'POST', path: '/api/coach/invites/revoke', headers: bearer('cdCoach000000000'), body: { code: code.toLowerCase() } });
    return { ...r, json: { body: r.json, row: typed(await rowOf(base, 'cdCoach000000000', code)), admin: typed(await rowOf(base, 'cdAdmin000000000', code, '/api/admin/invites')) } };
  }, mode: 'exact' },
  { name: 'admin invites new, then as listed', run: async base => {
    const r = await call(base, { method: 'POST', path: '/api/admin/invites/new', headers: bearer('cdAdmin000000000'), body: { note: 'for Sara' } });
    return { ...r, json: { invite: typed(r.json?.invite), row: typed(await rowOf(base, 'cdAdmin000000000', r.json?.invite?.code, '/api/admin/invites')) } };
  }, mode: 'exact' },
  { name: 'admin invites, invite_only flag', run: async base => {
    const r = await call(base, { path: '/api/admin/invites', headers: bearer('cdAdmin000000000') });
    return { ...r, json: { invite_only: r.json?.invite_only } };
  }, mode: 'exact' },
  { name: 'admin invites, not an admin', req: { path: '/api/admin/invites', headers: bearer('cdCoach000000000') }, mode: 'exact' },
  { name: 'admin invites revoke, no such code', req: { method: 'POST', path: '/api/admin/invites/revoke', headers: bearer('cdAdmin000000000'), body: { code: 'NOPE' } }, mode: 'exact' },
  { name: 'redeem, anonymous', req: { method: 'POST', path: '/api/invite/redeem', body: { code: 'X' } }, mode: 'exact' },
  { name: 'redeem, someone who has a coach', run: async base =>
    call(base, { method: 'POST', path: '/api/invite/redeem', headers: bearer('cdMember00000000'), body: { code: await coachCode(base) } }), mode: 'exact' },
  { name: 'redeem, a general code', run: async base =>
    call(base, { method: 'POST', path: '/api/invite/redeem', headers: bearer('cdBare0000000000'), body: { code: await generalCode(base) } }), mode: 'exact' },
  { name: 'redeem, your own link', run: async base =>
    call(base, { method: 'POST', path: '/api/invite/redeem', headers: bearer('cdCoach000000000'), body: { code: await coachCode(base) } }), mode: 'exact' },
  { name: 'redeem, joins the coach; the code is spent', run: async base => {
    const code = await coachCode(base);
    const r = await call(base, { method: 'POST', path: '/api/invite/redeem', headers: bearer('cdBare0000000000'), body: { code } });
    const again = await call(base, { method: 'POST', path: '/api/invite/redeem', headers: bearer('cdSync0000000000'), body: { code } });
    const row = await rowOf(base, 'cdCoach000000000', code);
    return { ...r, json: { body: r.json, again: [again.status, again.json], usedByName: row?.usedByName } };
  }, mode: 'exact' },
  { name: 'coach invites new, a note kept as sent (spaces, a number)', run: async base => {
    const spaced = await call(base, { method: 'POST', path: '/api/coach/invites/new', headers: bearer('cdCoach000000000'), body: { note: '  for Nadia' } });
    const number = await call(base, { method: 'POST', path: '/api/coach/invites/new', headers: bearer('cdCoach000000000'), body: { note: 42 } });
    return { status: spaced.status, json: { spaced: spaced.json?.invite?.note, number: number.json?.invite?.note } };
  }, mode: 'exact' },
  { name: 'coach invites revoke, a padded code is no such code', run: async base =>
    call(base, { method: 'POST', path: '/api/coach/invites/revoke', headers: bearer('cdCoach000000000'), body: { code: ' ' + await coachCode(base) + ' ' } }), mode: 'exact' },
  { name: 'coach invites, the open-code cap', run: async base => {
    let r;
    for (let i = 0; i < 25; i++) {
      r = await call(base, { method: 'POST', path: '/api/coach/invites/new', headers: bearer('cdCoachB00000000'), body: {} });
      if (r.status !== 200) break;
    }
    return r;
  }, mode: 'exact' },
  // R2 — the program library (CHW-248).
  { name: 'programs, a member', req: { path: '/api/coach/programs', headers: bearer('cdMember00000000') }, mode: 'exact' },
  { name: 'programs, empty library', req: { path: '/api/coach/programs', headers: bearer('cdCoach000000000') }, mode: 'exact' },
  { name: 'programs save', run: saved(progReq('cdCoach000000000', { id: 'p-contract', name: '  Block A  ', bundle: PLAN({ evil: 'x', week: {}, nutrition: { kcal: '2200.6', p: 170, c: 0, note: '  rest days  ' }, checkinDay: '3' }) })), mode: 'exact' },
  { name: 'programs save, the same id again (in place)', run: saved(progReq('cdCoach000000000', { id: 'p-contract', name: 'Block A v2', bundle: PLAN() })), mode: 'exact' },
  { name: 'programs save, no id (one is made)', run: async base => {
    const r = await call(base, progReq('cdCoach000000000', { name: 'Fresh', bundle: PLAN() }));
    return { status: r.status, json: { uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(r.json?.program?.id), count: r.json?.programs?.length } };
  }, mode: 'exact' },
  { name: 'programs, the other coach’s library', req: { path: '/api/coach/programs', headers: bearer('cdCoachB00000000') }, mode: 'exact' },
  { name: 'programs save, no name', req: progReq('cdCoach000000000', { id: 'x', name: '   ', bundle: PLAN() }), mode: 'exact' },
  { name: 'programs save, no bundle', req: progReq('cdCoach000000000', { id: 'x', name: 'N' }), mode: 'exact' },
  { name: 'programs save, not a plan', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: {} }), mode: 'exact' },
  { name: 'programs save, no routines', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ routines: [] }) }), mode: 'exact' },
  { name: 'programs save, too many routines', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ routines: Array.from({ length: 21 }, (_, i) => ({ id: 'r' + i, ex: [] })) }) }), mode: 'exact' },
  { name: 'programs save, a malformed routine', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ routines: [[]] }) }), mode: 'exact' },
  { name: 'programs save, a malformed exercise', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ routines: [{ id: 'r', ex: [{}] }] }) }), mode: 'exact' },
  { name: 'programs save, too many exercises', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ routines: [{ id: 'r', ex: Array.from({ length: 61 }, () => ({ id: '0025' })) }] }) }), mode: 'exact' },
  { name: 'programs save, too many custom exercises', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ customEx: Array.from({ length: 101 }, () => ({ id: 'c' })) }) }), mode: 'exact' },
  { name: 'programs save, malformed nutrition', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ nutrition: [] }) }), mode: 'exact' },
  { name: 'programs save, calories out of range', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ nutrition: { kcal: 'lots' } }) }), mode: 'exact' },
  { name: 'programs save, protein out of range', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ nutrition: { p: 2001 } }) }), mode: 'exact' },
  { name: 'programs save, carbs out of range', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ nutrition: { c: -1 } }) }), mode: 'exact' },
  { name: 'programs save, fat out of range', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ nutrition: { f: '0x7D1' } }) }), mode: 'exact' },
  { name: 'programs save, a check-in day that is no weekday', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ checkinDay: [] }) }), mode: 'exact' },
  { name: 'programs save, too large', req: progReq('cdCoach000000000', { id: 'x', name: 'N', bundle: PLAN({ name: 'é'.repeat(70000) }) }), mode: 'exact' },
  { name: 'programs save, an id that is not a plain string', req: progReq('cdCoach000000000', { id: { a: 1 }, name: 'N', bundle: PLAN() }), mode: 'exact' },
  { name: 'programs save, bad json', req: { method: 'POST', path: '/api/coach/programs/save', headers: bearer('cdCoach000000000'), raw: '{"id":' }, mode: 'exact' },
  { name: 'programs save, bad json, anonymous', req: { method: 'POST', path: '/api/coach/programs/save', raw: '{"id":' }, mode: 'exact' },
  { name: 'programs save, a body over 5 MB', req: { method: 'POST', path: '/api/coach/programs/save', headers: bearer('cdCoach000000000'), raw: ' '.repeat(5 * 1024 * 1024 + 1) }, mode: 'exact' },
  { name: 'programs save, an id ending in a newline', req: progReq('cdCoach000000000', { id: 'abc\n', name: 'N', bundle: PLAN() }), mode: 'exact' },
  { name: 'release, bad json', req: { method: 'POST', path: '/api/coach/member/release', headers: bearer('cdCoach000000000'), raw: '{nope' }, mode: 'exact' },
  { name: 'coach invites new, bad json', req: { method: 'POST', path: '/api/coach/invites/new', headers: bearer('cdCoach000000000'), raw: '{nope' }, mode: 'exact' },
  { name: 'programs save, a name cut through an emoji (lone surrogate)', run: savedOne(progReq('cdCoachB00000000', { id: 'p-emoji', name: 'Push \ud83d', bundle: PLAN() })), mode: 'exact' },
  { name: 'programs save, invalid UTF-8 bytes', run: savedOne({ method: 'POST', path: '/api/coach/programs/save', headers: bearer('cdCoach000000000'),
    raw: Buffer.concat([Buffer.from('{"id":"p-bytes","name":"x'), Buffer.from([0xc3]), Buffer.from('","bundle":{\"opengym_plan\":1,\"routines\":[{\"id\":\"r\",\"ex\":[{\"id\":\"e\",\"sets\":1e400,\"rest\":0.00001}]}]}}')]) }), mode: 'exact' },
  { name: 'programs save, Infinity in a bundle', run: savedOne({ method: 'POST', path: '/api/coach/programs/save', headers: bearer('cdCoach000000000'),
    raw: '{"id":"p-inf","name":"Inf","bundle":{\"opengym_plan\":1,\"routines\":[{\"id\":\"r\",\"ex\":[{\"id\":\"e\",\"sets\":1e400,\"rest\":0.00001}]}]}}' }), mode: 'exact' },
  { name: 'data put, bad json', req: { method: 'PUT', path: '/api/data', headers: bearer('cdSync0000000000'), raw: '{"state":' }, mode: 'exact' },
  { name: 'programs delete, no such program', req: { method: 'POST', path: '/api/coach/programs/delete', headers: bearer('cdCoach000000000'), body: { id: 'nope' } }, mode: 'exact' },
  { name: 'programs delete, by the other coach', req: { method: 'POST', path: '/api/coach/programs/delete', headers: bearer('cdCoachB00000000'), body: { id: 'p-contract' } }, mode: 'exact' },
  { name: 'programs delete', run: async base => {
    const r = await call(base, { method: 'POST', path: '/api/coach/programs/delete', headers: bearer('cdCoach000000000'), body: { id: 'p-contract' } });
    return { ...r, json: { programs: (r.json?.programs || []).map(p => p.name) } };
  }, mode: 'exact' },
  { name: 'programs, the library cap', run: async base => {
    let r;
    for (let i = 0; i < 52; i++) {
      r = await call(base, progReq('cdCoachB00000000', { id: 'cap' + i, name: 'P' + i, bundle: PLAN() }));
      if (r.status !== 200) break;
    }
    return r;
  }, mode: 'exact' },
  // R2 — assignments (CHW-249). Every offer is sent inside the run (CHW-251 imports Node's).
  { name: 'assign, anonymous', req: { method: 'POST', path: '/api/coach/assign', body: {} }, mode: 'exact' },
  { name: 'assign, a member', req: assignReq('cdMember00000000', { memberIds: ['cdMember00000000'], bundle: PLAN() }), mode: 'exact' },
  { name: 'assign, bad json', req: { method: 'POST', path: '/api/coach/assign', headers: bearer('cdCoach000000000'), raw: '{"memberIds":' }, mode: 'exact' },
  { name: 'assign, not a plan (checked before the members)', req: assignReq('cdCoach000000000', { memberIds: [], bundle: { nope: 1 } }), mode: 'exact' },
  { name: 'assign, no members', req: assignReq('cdCoach000000000', { memberIds: [], bundle: PLAN() }), mode: 'exact' },
  { name: 'assign, members not a list', req: assignReq('cdCoach000000000', { memberIds: 'cdMember00000000', bundle: PLAN() }), mode: 'exact' },
  { name: 'assign, another coach’s client', req: assignReq('cdCoachB00000000', { memberIds: ['cdMember00000000'], bundle: PLAN() }), mode: 'exact' },
  { name: 'assign, a batch with one stranger is refused whole', req: assignReq('cdCoach000000000', { memberIds: ['cdMember00000000', 'cdSync0000000000'], bundle: PLAN() }), mode: 'exact' },
  { name: 'assign, admin to a disabled member', req: assignReq('cdAdmin000000000', { memberIds: ['cdGone0000000000'], bundle: PLAN() }), mode: 'exact' },
  { name: 'inbox, still empty after refusals', run: inboxOf('cdMember00000000'), mode: 'exact' },
  { name: 'assign, own client (twice in the list)', req: assignReq('cdCoach000000000', { memberIds: ['cdMember00000000', 'cdMember00000000'], note: '  go  ', schedule: 1,
    bundle: PLAN({ evil: 'x', week: {}, nutrition: { kcal: '2200.6', p: 170, note: '  rest days  ' }, checkinDay: 0 }) }), mode: 'exact' },
  { name: 'inbox, anonymous', req: { path: '/api/assignments' }, mode: 'exact' },
  { name: 'inbox, the member', run: inboxOf('cdMember00000000'), mode: 'exact' },
  { name: 'inbox, another member', run: inboxOf('cdSync0000000000'), mode: 'exact' },
  { name: 'history, anonymous', req: { path: '/api/assignments/history' }, mode: 'exact' },
  { name: 'history, nothing answered yet', run: historyOf('cdMember00000000'), mode: 'exact' },
  { name: 'withdraw, by the other coach', run: async base => call(base, withdrawReq('cdCoachB00000000', await firstOffer(base, 'cdMember00000000'))), mode: 'exact' },
  { name: 'withdraw, by a member', run: async base => call(base, withdrawReq('cdMember00000000', await firstOffer(base, 'cdMember00000000'))), mode: 'exact' },
  { name: 'withdraw, a made-up id', req: withdrawReq('cdCoach000000000', 'nope'), mode: 'exact' },
  { name: 'withdraw, an id that is not a string', req: withdrawReq('cdCoach000000000', ['x']), mode: 'exact' },
  { name: 'decide, anonymous', req: { method: 'POST', path: '/api/assignments/decide', body: {} }, mode: 'exact' },
  { name: 'decide, by the coach', run: async base => call(base, decideReq('cdCoach000000000', await firstOffer(base, 'cdMember00000000'), true)), mode: 'exact' },
  { name: 'decide, by another member', run: async base => call(base, decideReq('cdSync0000000000', await firstOffer(base, 'cdMember00000000'), true)), mode: 'exact' },
  { name: 'decide, bad json', req: { method: 'POST', path: '/api/assignments/decide', headers: bearer('cdMember00000000'), raw: '{nope' }, mode: 'exact' },
  { name: 'decide, accept', run: async base => call(base, decideReq('cdMember00000000', await firstOffer(base, 'cdMember00000000'), 'yes')), mode: 'exact' },
  { name: 'history, after accepting', run: historyOf('cdMember00000000'), mode: 'exact' },
  { name: 'withdraw, an answered offer', run: async base => {
    const id = ((await call(base, { path: '/api/assignments/history', headers: bearer('cdMember00000000') })).json?.assignments || [])[0]?.id;
    const w = await call(base, withdrawReq('cdCoach000000000', id));
    const d = await call(base, decideReq('cdMember00000000', id, false));
    return { status: w.status, json: { withdraw: w.json, decideAgain: [d.status, d.json] } };
  }, mode: 'exact' },
  { name: 'withdraw, a pending offer', run: async base => {
    await call(base, assignReq('cdCoach000000000', { memberIds: ['cdMember00000000'], bundle: PLAN({ name: 'Oops' }) }));
    const id = await firstOffer(base, 'cdMember00000000');
    const w = await call(base, withdrawReq('cdCoach000000000', id));
    const again = await call(base, withdrawReq('cdCoach000000000', id));
    const hist = await historyOf('cdMember00000000')(base);
    return { status: w.status, json: { withdraw: w.json, again: [again.status, again.json], history: hist.json } };
  }, mode: 'exact' },
  { name: 'decide, decline', run: async base => {
    await call(base, assignReq('cdAdmin000000000', { memberIds: ['cdMember00000000'], bundle: PLAN({ name: 'From the owner' }), note: 'n' }));
    const d = await call(base, decideReq('cdMember00000000', await firstOffer(base, 'cdMember00000000'), 0));
    return { status: d.status, json: { decide: d.json, history: (await historyOf('cdMember00000000')(base)).json } };
  }, mode: 'exact' },
  { name: 'assign, the pending cap', run: async base => {
    let r;
    for (let i = 0; i < 7; i++) {
      r = await call(base, assignReq('cdCoach000000000', { memberIds: ['cdMember00000000'], bundle: PLAN({ name: 'Cap ' + i }) }));
      if (r.status !== 200) break;
    }
    return r;
  }, mode: 'exact' },
  { name: 'inbox, full', run: inboxOf('cdMember00000000'), mode: 'exact' },
  { name: 'members, coach, with offers out', run: async base => {
    const r = await clockless({ path: '/api/coach/members', headers: bearer('cdCoach000000000') })(base);
    const members = (r.json?.members || []).map(m => ({ ...m, pending: offers(m.pending),
      lastDecision: m.lastDecision && { ...m.lastDecision, at: typeof m.lastDecision.at } }));
    return { ...r, json: { ...r.json, members } };
  }, mode: 'exact' },
  // R2 — the owner's account controls and detachCoach (CHW-250).
  { name: 'admin users, anonymous', req: { path: '/api/admin/users' }, mode: 'exact' },
  { name: 'admin users, a coach', req: { path: '/api/admin/users', headers: bearer('cdCoach000000000') }, mode: 'exact' },
  { name: 'admin users', run: clockless({ path: '/api/admin/users', headers: bearer('cdAdmin000000000') }), mode: 'exact' },
  { name: 'admin user, a client', req: { path: '/api/admin/user?id=cdMember00000000', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: 'admin user, the admin', req: { path: '/api/admin/user?id=cdAdmin000000000', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: 'admin user, nobody', req: { path: '/api/admin/user?id=nope', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: 'admin user, no id', req: { path: '/api/admin/user', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: 'admin disable, nobody', req: adminReq('disable', { id: 'nope', disabled: true }), mode: 'exact' },
  { name: 'admin disable, an id that is not a string', req: adminReq('disable', { id: ['cdSync0000000000'], disabled: true }), mode: 'exact' },
  { name: 'admin disable, an admin', req: adminReq('disable', { id: 'cdAdmin000000000', disabled: true }), mode: 'exact' },
  { name: 'admin disable, bad json', req: { method: 'POST', path: '/api/admin/user/disable', headers: bearer('cdAdmin000000000'), raw: '{nope' }, mode: 'exact' },
  { name: 'admin disable, by a coach', req: { method: 'POST', path: '/api/admin/user/disable', headers: bearer('cdCoach000000000'), body: { id: 'cdSync0000000000', disabled: true } }, mode: 'exact' },
  { name: 'admin coach, nobody', req: adminReq('coach', { id: 'nope', coach: true }), mode: 'exact' },
  { name: 'admin assign-coach, nobody', req: adminReq('assign-coach', { id: 'nope', coachId: 'cdCoachB00000000' }), mode: 'exact' },
  { name: 'admin assign-coach, not a coach', req: adminReq('assign-coach', { id: 'cdSync0000000000', coachId: 'cdBare0000000000' }), mode: 'exact' },
  { name: 'admin assign-coach, a coach that does not exist', req: adminReq('assign-coach', { id: 'cdSync0000000000', coachId: 'nope' }), mode: 'exact' },
  { name: 'admin assign-coach, their own coach', req: adminReq('assign-coach', { id: 'cdCoachB00000000', coachId: ' cdCoachB00000000 ' }), mode: 'exact' },
  { name: 'admin assign-coach, onto the other coach', run: async base => {
    const r = await call(base, adminReq('assign-coach', { id: 'cdSync0000000000', coachId: 'cdCoachB00000000' }));
    return { ...r, json: { body: r.json, roster: (await clockless({ path: '/api/coach/members', headers: bearer('cdCoachB00000000') })(base)).json } };
  }, mode: 'exact' },
  { name: 'admin assign-coach, a move retires the old coach’s offers', run: async base => {
    const r = await call(base, adminReq('assign-coach', { id: 'cdMember00000000', coachId: 'cdCoachB00000000' }));
    return { ...r, json: { body: r.json, inbox: (await inboxOf('cdMember00000000')(base)).json } };
  }, mode: 'exact' },
  { name: 'admin assign-coach, blank unassigns', req: adminReq('assign-coach', { id: 'cdSync0000000000', coachId: '   ' }), mode: 'exact' },
  { name: 'admin coach, revoking the role detaches', run: async base => {
    const r = await call(base, adminReq('coach', { id: 'cdCoachB00000000', coach: false }));
    const members = await call(base, { path: '/api/coach/members', headers: bearer('cdCoachB00000000') });
    return { ...r, json: { body: r.json, theirs: await usersOf(base, u => u.coachId === 'cdCoachB00000000'), members: [members.status, members.json] } };
  }, mode: 'exact' },
  { name: 'admin coach, granted again, nothing comes back', run: async base => {
    const r = await call(base, adminReq('coach', { id: 'cdCoachB00000000', coach: 'yes' }));
    return { ...r, json: { body: r.json, roster: (await clockless({ path: '/api/coach/members', headers: bearer('cdCoachB00000000') })(base)).json } };
  }, mode: 'exact' },
  { name: 'admin disable, a coach detaches', run: async base => {
    const r = await call(base, adminReq('disable', { id: 'cdCoach000000000', disabled: true }));
    const members = await call(base, { path: '/api/coach/members', headers: bearer('cdCoach000000000') });
    return { ...r, json: { body: r.json, theirs: await usersOf(base, u => u.coachId === 'cdCoach000000000'), codes: await codesOf(base, 'cdCoach000000000'), members: [members.status, members.json] } };
  }, mode: 'exact' },
  { name: 'admin assign-coach, a disabled coach', req: adminReq('assign-coach', { id: 'cdSync0000000000', coachId: 'cdCoach000000000' }), mode: 'exact' },
  { name: 'admin disable, enabled again, the roster stays empty', run: async base => {
    const r = await call(base, adminReq('disable', { id: 'cdCoach000000000', disabled: 0 }));
    return { ...r, json: { body: r.json, roster: (await clockless({ path: '/api/coach/members', headers: bearer('cdCoach000000000') })(base)).json } };
  }, mode: 'exact' },
  { name: 'admin coach, an admin keeps coaching with the flag off', run: async base => {
    const r = await call(base, adminReq('coach', { id: 'cdAdmin000000000', coach: false }));
    return { ...r, json: { body: r.json, user: (await call(base, { path: '/api/admin/user?id=cdAdmin000000000', headers: bearer('cdAdmin000000000') })).json?.user } };
  }, mode: 'exact' },
  // Query values as searchParams.get read them: untrimmed, the first of repeated names.
  { name: 'admin user, a padded id', req: { path: '/api/admin/user?id=%20cdSync0000000000%20', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: 'admin user, a repeated id (the first counts)', req: { path: '/api/admin/user?id=nope&id=cdSync0000000000', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: 'admin user, a repeated id (the first is real)', req: { path: '/api/admin/user?id=cdSync0000000000&id=nope', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: 'member, a padded id', req: { path: '/api/coach/member?id=%20cdSync0000000000', headers: bearer('cdAdmin000000000') }, mode: 'exact' },
  { name: 'invite, a code padded with an NBSP and a BOM', run: async base => call(base, { path: '/api/invite?code=%C2%A0' + await coachCode(base) + '%EF%BB%BF' }), mode: 'exact' },
  { name: 'admin users, after it all', run: clockless({ path: '/api/admin/users', headers: bearer('cdAdmin000000000') }), mode: 'exact' },
  { name: 'logout', req: { method: 'POST', path: '/api/logout', headers: bearer('cdMember00000000') }, mode: 'exact', cookies: true },
  { name: 'logout everywhere', run: async base => {
    const old = token('cdWipe0000000000', 2);
    const r = await call(base, { method: 'POST', path: '/api/logout/all', headers: { Authorization: 'Bearer ' + old } });
    const after = await call(base, { path: '/api/me', headers: { Authorization: 'Bearer ' + old } });
    return { status: r.status, json: { body: r.json, oldTokenAfter: [after.status, after.json] }, cookies: r.cookies };
  }, mode: 'exact', cookies: true },
];

// --- run ---------------------------------------------------------------------------------------
const results = [];
for (const c of CASES) {
  const run = c.run ?? (base => call(base, c.req));
  const [n, l] = [await run(opt.node), await run(opt.laravel)];
  const problems = [];
  if (n.status !== l.status) problems.push(`status: Node ${n.status} vs Laravel ${l.status}`);
  for (const k of ['error', 'msg']) {
    if (JSON.stringify(n.json?.[k]) !== JSON.stringify(l.json?.[k])) problems.push(`$.${k}: Node ${JSON.stringify(n.json?.[k])} vs Laravel ${JSON.stringify(l.json?.[k])}`);
  }
  const body = c.mode === 'shape' ? diffs(shape(n.json), shape(l.json)) : diffs(n.json, l.json);
  // error and msg were compared exactly above; drop only THOSE keys' body diffs — not `errors`,
  // `errorCode` or `msgs`, which a prefix test would also have swallowed.
  problems.push(...body.filter(d => !/^\$\.(error|msg)([.[:]|$)/.test(d)));
  if (c.headers) problems.push(...diffs(n.headers, l.headers, 'headers'));
  if (c.cookies) problems.push(...diffs(n.cookies, l.cookies, 'set-cookie'));

  const unexpected = problems.filter(p => !INTENDED[`${c.name} ${p}`]);
  const intended = problems.filter(p => INTENDED[`${c.name} ${p}`]);
  results.push({ c, n, unexpected, intended });
  console.log(`${unexpected.length ? 'DIFF' : 'same'}  ${String(n.status).padEnd(3)} ${c.name}${intended.length ? `  (intended: ${intended.map(p => p.split(':')[0]).join(', ')})` : ''}`);
  for (const p of unexpected) console.log('        ' + p);
}

const bad = results.filter(r => r.unexpected.length);
console.log(`\n${results.length} cases, ${results.length - bad.length} the same, ${bad.length} different.`);
for (const [k, why] of Object.entries(INTENDED)) console.log(`intended  ${k} — ${why}`);
process.exit(bad.length ? 1 : 0);
