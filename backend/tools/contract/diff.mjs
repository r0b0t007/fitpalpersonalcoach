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
const saved = req => async base => {
  const r = await call(base, req);
  return { ...r, json: r.json?.error ? r.json : { program: clockFree(r.json?.program), programs: (r.json?.programs || []).map(clockFree) } };
};

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
