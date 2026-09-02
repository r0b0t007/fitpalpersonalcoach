/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import webpush from 'web-push';
import {
  normPhone, hasPendingPhone, pruneRequests, decideRequest, REQ_MAX_PENDING,
  validateSession, expandRepeats, pruneSessions, sessionSort, addDaysISO, SESSION_WINDOW_DAYS,
  bootstrapMatches, BOOTSTRAP_MIN,
  canCoachMember, validateAssignmentBundle, pruneAssignments, decideAssignment,
  pendingAssignmentsFor, ASSIGN_MAX_PENDING, ASSIGN_NOTE_MAX,
  findSessionConflicts
} from './domain.mjs';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// Guest mode ("Continue without account") keeps everything in the browser and never touches this
// server — but on an instance meant for a known set of people, an entrance nobody can walk back
// out of is still the wrong front door (#42). Default ON, so existing instances are unchanged;
// the polarity is inverted from INVITE_ONLY because the safe default here is the permissive one.
const ALLOW_GUEST = !/^(0|false|no|off)$/i.test(process.env.ALLOW_GUEST || '');
// "Request access": visitors without an invite code can ask for one from the sign-in screen;
// the admin approves a request into an invite code. Off by default, like the other gates.
const REQUEST_ACCESS = /^(1|true|yes|on)$/i.test(process.env.REQUEST_ACCESS || '');
// One-shot code that lets the very first account in and makes it an admin, so INVITE_ONLY on an
// empty database isn't a lockout with no key (see bootstrapMatches in domain.mjs). Meaningful only
// alongside INVITE_ONLY=1 — without it there is no deadlock to break.
const BOOTSTRAP_CODE = (process.env.BOOTSTRAP_CODE || '').trim();
if (BOOTSTRAP_CODE && BOOTSTRAP_CODE.length < BOOTSTRAP_MIN)
  console.warn(`[bootstrap] BOOTSTRAP_CODE is under ${BOOTSTRAP_MIN} characters and will be ignored — use a long random string.`);
// Without INVITE_ONLY the sign-in form never renders the code field, so the operator has nowhere
// to type this and registers as an ordinary user instead. That failure looks exactly like the
// feature being broken, so say it out loud rather than letting them find out from the dashboard.
if (BOOTSTRAP_CODE && !INVITE_ONLY)
  console.warn('[bootstrap] BOOTSTRAP_CODE is set but INVITE_ONLY is off — the sign-in form will not ask for a code, and the first account will NOT be made an admin. Set INVITE_ONLY=1.');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

fs.mkdirSync(DATA, { recursive: true });

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
db.requests = db.requests || [];   // access requests: pending → approved (mints an invite) | rejected
db.sessions = db.sessions || [];   // group sessions (coached classes) — public read, admin write
db.assignments = db.assignments || [];  // programs a coach pushed: pending → accepted | declined
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
// A coach programs for the members assigned to them. Admins are coaches implicitly — they run the
// gym — but the reverse is deliberately not true: the point of the role is handing a trainer
// programming duties WITHOUT invites, access requests or account control.
const isCoach = user => !!user && (user.coach === true || isAdmin(user));
// One shape for "who am I", used by /api/me and by both verify handlers, so a client never sees
// three subtly different user objects depending on how it got there.
const publicUser = u => {
  const coach = u.coachId ? db.users.find(x => x.id === u.coachId) : null;
  return {
    id: u.id, name: u.name, admin: isAdmin(u), coach: isCoach(u),
    // The member is told who can see their training. A coach reading someone's history is a real
    // privacy change and should never be invisible to the person being read.
    coachName: coach ? coach.name : null
  };
};
// Re-evaluated per request rather than cached: it must go false the instant the first user lands,
// including between a registration's options and verify calls.
const isBootstrapCode = code => bootstrapMatches(code, BOOTSTRAP_CODE, db.users.length);
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  await Promise.all(subs.map(async sub => {
    // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
    // low-urgency background push more aggressively under battery-saving modes. TTL is left
    // at the library default (long) so a briefly-offline device still gets it once reconnected,
    // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
    // actually control anyway.
    try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { urgency: 'high' }); }
    catch (e) {
      console.error('push send failed', userId, e.statusCode, e.body || e.message);
      if (e.statusCode === 404 || e.statusCode === 410) {
        db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
      }
    }
  }));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, { title: 'Rest over 💪', body: 'Time for your next set.', tag: 'rest-timer' });
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}
// Computes "now" in an arbitrary IANA zone (e.g. "Europe/Lisbon") instead of the server's own —
// each user's reminder fires by their own clock, wherever they and their phone actually are.
function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; } // unknown/invalid tz string — skip this user rather than guess
}
setInterval(() => {
  for (const user of db.users) {
    if (!db.subs.some(s => s.userId === user.id)) continue;
    const S = readState(user.id);
    if (!S?.reminder?.on) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (user.lastReminder === now.date) continue;
    if ((S.workouts || []).some(w => w.d === now.date)) continue;
    const rid = effectiveRoutineId(S, now.date);
    if (!rid) continue; // rest day — nothing planned
    const routine = (S.routines || []).find(r => r.id === rid);
    console.log('reminder firing', user.id, rid);
    user.lastReminder = now.date;
    saveDb();
    sendPush(user.id, {
      title: routine ? `${routine.emoji || '🏋️'} ${routine.name} today` : 'Workout planned today',
      body: "It's on your plan — let's go 💪",
      tag: 'day-reminder'
    });
  }
// Checked every 10s (not 60s) — ticks aren't aligned to the top of the minute, so a 60s
// interval could sit on your target minute for up to 59s before noticing. 10s caps that at ~9s.
}, 10000).unref();

/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}
// Session payload is `<uid>:<expiry>:<version>`, where the version is the user's `sv` counter.
// Bumping `sv` (POST /api/logout/all) makes every cookie ever handed out for that account stop
// verifying, which is the only revocation there was before short of deleting ./data/secret and
// signing out the whole instance. Cookies minted before `sv` existed have no third field and are
// read as version 0, matching a user who has never bumped — they stay valid until they expire.
const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}
function readSession(req) {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => {
    const i = c.indexOf('='); return i < 0 ? ['', ''] : [c.slice(0, i).trim(), c.slice(i + 1).trim()];
  }));
  const tok = cookies.gymsid;
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = db.users.find(u => u.id === uid) || null;
  if (!user) return null;
  if (user.disabled) return null;           // disabled accounts are locked out everywhere
  // Missing third field = pre-versioning cookie = version 0. Anything non-numeric is a malformed
  // payload (it still had to pass the HMAC, so this is belt-and-braces) and is refused outright.
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}
// Guard for /api/admin/* — resolves the caller and 401/403s if they aren't an admin.
function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
// Guard for /api/coach/* — being a coach only gets you through the door. Every one of these
// routes must ALSO check canCoachMember for the specific member it touches, because the role
// says "may coach someone", never "may coach this person".
function requireCoach(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isCoach(user)) { json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}
// The member summary the admin list and the coach list both render.
const memberCard = u => {
  const S = readState(u.id) || {};
  const workouts = S.workouts || [];
  const last = workouts[workouts.length - 1];
  return {
    id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled,
    workouts: workouts.length, lastWorkout: last ? last.d : null,
    lastSync: S._ts || null, live: livePresence(u.id)
  };
};
function sessionCookie(user) {
  return `gymsid=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
}
const clearCookie = `gymsid=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;

/* ---------- challenge store (in-memory, 5 min TTL) ---------- */
const challenges = new Map(); // cid -> {challenge, name?, uid?, exp}
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence (in-memory) ---------- */
// Clients heartbeat /api/activity while a workout is on screen; the admin dashboard reads who's
// live. Purely ephemeral — never persisted. Expires shortly after the last ping.
const presence = new Map();               // uid -> { name, exIdx, exTotal, setsDone, setsTotal, startedAt, updatedAt }
const PRESENCE_TTL = 70000;               // ~3.5× the 20s client heartbeat
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- invites ---------- */
// 16 hex chars = 64 bits, up from 8 chars / 32 bits. The app has no rate limiting by design
// (that's the reverse proxy's job) and /api/register/options tells a caller whether a code is
// good, so the code itself has to be the thing that isn't worth guessing. Codes already in
// db.json keep working — validation is an exact string compare, never a length or format check.
// Caller saves; approval of an access request passes requestId so redemption stays traceable.
function mintInvite(adminId, note, requestId) {
  let code;
  do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
  const invite = { code, note: String(note || '').slice(0, 60), createdBy: adminId, created: new Date().toISOString() };
  if (requestId) invite.requestId = requestId;
  db.invites.push(invite);
  return invite;
}

const isoTodayUTC = () => new Date().toISOString().slice(0, 10);

// Whole days from a to b, UTC-noon so DST can never make it 0.999 and floor to the wrong number.
const daysBetweenISO = (a, b) => {
  const t = iso => Date.parse(iso + 'T12:00:00Z');
  const d = (t(b) - t(a)) / 86400000;
  return Number.isFinite(d) ? Math.round(d) : 0;
};

// The assigned coach is told when a class lands on them, moves, or is called off. Deliberately
// only the coach: with no booking there is no attendee list, and pushing every cancelled yoga
// class to everyone who installed the app is the kind of noise that gets notifications muted.
// Members find out from the struck-through row on the timetable.
// The timetable is public, so a session leaves here with a resolved coach NAME and no ids: the
// name follows the account (rename a coach and every class updates), while an anonymous reader
// learns nothing about who holds an account. Falls back to the free-text `coach` for guests.
const publicSession = s => {
  const { coachId, createdBy, ...rest } = s;
  const acct = coachId ? db.users.find(u => u.id === coachId) : null;
  return { ...rest, coachName: acct ? acct.name : (s.coach || '') };
};

function notifyCoachOfSession(session, what) {
  if (!session || !session.coachId) return;
  const when = `${session.date} ${session.time}`;
  const body = what === 'cancelled' ? `${session.title} on ${when} was cancelled`
    : what === 'moved' ? `${session.title} moved to ${when}`
    : `You're teaching ${session.title} on ${when}`;
  sendPush(session.coachId, { title: RP_NAME, body, tag: 'session' }).catch(() => {});
}

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in.
  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST, request_access: REQUEST_ACCESS }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: publicUser(user) });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY && !isBootstrapCode(code) && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked))
      return json(res, 403, { error: 'a valid invite code is required' });
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) return json(res, 400, { error: 'challenge expired — try again' });
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) return json(res, 409, { error: 'credential already registered' });
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    // The bootstrap code is re-checked here too rather than trusted from the challenge: if someone
    // else finished registering in between, the database is no longer empty and the code is spent.
    // From here to db.users.push there is no await, so that check can't go stale under concurrency.
    const bootstrap = isBootstrapCode(c.code);
    let invite = null;
    if (INVITE_ONLY && !bootstrap) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created; }
    // Stored on the row, which isAdmin already honours — so the operator never has to find their
    // uid and set ADMIN_UIDS by hand, and the code is inert from here on.
    if (bootstrap) {
      user.admin = true;
      // JSON.stringify, not raw: the name is caller-supplied and may carry newlines, which would
      // otherwise let a registration forge extra lines in the log.
      console.log(`[bootstrap] first account ${JSON.stringify(user.name)} (${user.id}) created via BOOTSTRAP_CODE and granted admin — clear BOOTSTRAP_CODE now.`);
    }
    db.users.push(user);
    db.creds.push({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    saveDb();
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) return json(res, 400, { error: 'challenge expired — try again' });
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) return json(res, 404, { error: 'unknown passkey — create a profile first' });
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.publicKey),
          counter: cred.counter,
          transports: cred.transports
        }
      });
    } catch (e) { return json(res, 400, { error: 'verification failed: ' + e.message }); }
    if (!verification.verified) return json(res, 400, { error: 'not verified' });
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) return json(res, 500, { error: 'user missing' });
    if (user.disabled) return json(res, 403, { error: 'this account has been disabled' });
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/logout': async (req, res) => json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie }),

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    try {
      const state = JSON.parse(fs.readFileSync(stateFile(user.id), 'utf8'));
      json(res, 200, { state });
    } catch { json(res, 200, { state: null }); }
  },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;              // in-progress workouts stay device-local
    atomicWrite(stateFile(user.id), JSON.stringify(body.state));
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    db.subs = db.subs.filter(s => !(s.userId === user.id && s.endpoint === body.endpoint));
    saveDb();
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, { title: 'openGym', body: 'Test notification ✅ — this is what alerts look like.', tag: 'test' });
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  // Live-workout heartbeat: client pings while a workout is on screen; { active:false } drops it.
  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // One row per user, cheap enough for a personal instance (reads each state file once).
  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const users = db.users.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || null,
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invitedBy || null,
        coach: isCoach(u), coachId: u.coachId || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: db.subs.some(s => s.userId === u.id),
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  // Drill-down: full workout history + body-weight log for one user.
  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: {
        id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled,
        admin: isAdmin(u), invitedBy: u.invitedBy || null,
        coach: isCoach(u), ownCoachFlag: u.coach === true, coachId: u.coachId || null
      },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()   // newest first for display
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) presence.delete(u.id);   // drop them off "training now" at once
    saveDb();
    json(res, 200, { ok: true, id: u.id, disabled: u.disabled });
  },

  // Granting/revoking the coach role, and pointing a member at their coach. Admin-only: the
  // whole point of the role is that a coach cannot widen their own reach.
  'POST /api/admin/user/coach': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    u.coach = !!body.coach;
    // Revoking leaves their members coachless rather than silently pointing at a non-coach —
    // otherwise re-granting the role later would hand back a roster nobody reviewed.
    if (!u.coach) db.users.forEach(m => { if (m.coachId === u.id) delete m.coachId; });
    saveDb();
    json(res, 200, { ok: true, id: u.id, coach: u.coach });
  },

  'POST /api/admin/user/assign-coach': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const coachId = String(body.coachId || '').trim();
    if (!coachId) { delete u.coachId; saveDb(); return json(res, 200, { ok: true, id: u.id, coachId: null }); }
    const c = db.users.find(x => x.id === coachId);
    if (!c || !isCoach(c)) return json(res, 400, { error: 'that user is not a coach' });
    if (c.id === u.id) return json(res, 400, { error: 'a member cannot be their own coach' });
    u.coachId = c.id;
    saveDb();
    json(res, 200, { ok: true, id: u.id, coachId: c.id });
  },

  /* ---------- coaching ---------- */
  // Being a coach gets you through requireCoach; canCoachMember decides each individual member,
  // so a coach can never read or write someone who isn't theirs.
  'GET /api/coach/members': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const admin = isAdmin(coach);
    const members = db.users
      .filter(u => canCoachMember(coach, u, { isAdmin: admin }))
      .map(memberCard);
    json(res, 200, { members, now: Date.now() });
  },

  'GET /api/coach/member': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === id);
    // Same 403 whether the member doesn't exist or isn't theirs — a different answer for each
    // would let a coach enumerate the gym's membership.
    if (!u || !canCoachMember(coach, u, { isAdmin: isAdmin(coach) })) return json(res, 403, { error: 'forbidden' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()
    });
  },

  // Push a plan to one or more members. The bundle is stored on the assignment and merged by the
  // MEMBER's client on accept — never written into their state here. Their app syncs by
  // whole-state replacement, so a server-side write would be clobbered by the next push from any
  // device that had an unsynced change.
  // The classes this coach is teaching. Mirrors GET /api/sessions but scoped to them, so a coach
  // opening the app sees their own week rather than the whole club's timetable.
  'GET /api/coach/sessions': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const from = isoTodayUTC();
    const sessions = db.sessions
      .filter(s => s.coachId === coach.id && s.date >= from)
      .sort(sessionSort);
    json(res, 200, { sessions });
  },

  'POST /api/coach/assign': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const { bundle, error } = validateAssignmentBundle(body.bundle);
    if (error) return json(res, 400, { error });
    const ids = Array.isArray(body.memberIds) ? [...new Set(body.memberIds.map(String))] : [];
    if (!ids.length) return json(res, 400, { error: 'pick at least one member' });
    const admin = isAdmin(coach);
    const targets = [];
    for (const id of ids) {
      const u = db.users.find(x => x.id === id);
      if (!u || !canCoachMember(coach, u, { isAdmin: admin })) return json(res, 403, { error: 'forbidden' });
      if (pendingAssignmentsFor(db.assignments, u.id).length >= ASSIGN_MAX_PENDING)
        return json(res, 429, { error: `${u.name} already has ${ASSIGN_MAX_PENDING} programs waiting` });
      targets.push(u);
    }
    const note = String(body.note || '').trim().slice(0, ASSIGN_NOTE_MAX);
    const created = new Date().toISOString();
    const rows = targets.map(u => ({
      id: crypto.randomBytes(12).toString('base64url'),
      coachId: coach.id, coachName: coach.name, memberId: u.id,
      bundle, note, schedule: !!body.schedule, created, status: 'pending'
    }));
    db.assignments = pruneAssignments(db.assignments.concat(rows));
    saveDb();
    // Best-effort: a member who never enabled push simply finds it next time they open the app.
    targets.forEach(u => sendPush(u.id, {
      title: RP_NAME,
      body: `${coach.name} sent you a program`,
      tag: 'assignment'
    }).catch(() => {}));
    json(res, 200, { ok: true, sent: rows.length });
  },

  // The member's own inbox. Pending only — a decided assignment has already been merged locally,
  // and re-offering it would invite a duplicate.
  'GET /api/assignments': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const mine = pendingAssignmentsFor(db.assignments, user.id).map(a => ({
      id: a.id, coachName: a.coachName, note: a.note, created: a.created,
      schedule: !!a.schedule, bundle: a.bundle
    }));
    json(res, 200, { assignments: mine });
  },

  'POST /api/assignments/decide': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const a = db.assignments.find(x => x.id === body.id);
    // Only the recipient answers, and only their own — never the coach, never another member.
    if (!a || a.memberId !== user.id) return json(res, 404, { error: 'no such assignment' });
    const { error } = decideAssignment(a, !!body.accept);
    if (error) return json(res, 409, { error });
    saveDb();
    json(res, 200, { ok: true, status: a.status });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    // resolve usedBy uid → name for display
    const invites = db.invites.map(i => ({
      ...i, usedByName: i.usedBy ? (db.users.find(u => u.id === i.usedBy) || {}).name || null : null
    }));
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const invite = mintInvite(admin.id, body.note);
    saveDb();
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    db.invites = db.invites.filter(i => i.code !== inv.code);
    saveDb();
    json(res, 200, { ok: true });
  },

  /* ---------- access requests (REQUEST_ACCESS) ---------- */
  // The app's only unauthenticated write. The real guard is per-identity — one pending request
  // per phone number, so an attacker's spam is capped by the numbers they invent, not by a
  // global counter that would lock real members out. The global cap is a backstop; pending
  // requests also expire on their own (pruneRequests). Rate limiting stays at the reverse
  // proxy, like everywhere else in this file.
  'POST /api/access/request': async (req, res) => {
    if (!REQUEST_ACCESS) return json(res, 404, { error: 'not found' });
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    const phone = String(body.phone || '').trim().slice(0, 30);
    const note = String(body.note || '').trim().slice(0, 200);
    if (!name) return json(res, 400, { error: 'name required' });
    if (!normPhone(phone)) return json(res, 400, { error: 'phone required' });
    const kept = pruneRequests(db.requests);
    let dirty = kept.length !== db.requests.length;
    db.requests = kept;
    // Same phone asking again reads as ok without a new row — the first request is already in
    // the queue, and telling a caller "this phone already asked" would leak who has.
    if (!hasPendingPhone(db.requests, phone)) {
      if (db.requests.filter(r => r.status === 'pending').length >= REQ_MAX_PENDING)
        return json(res, 429, { error: 'too many open requests — try again later' });
      db.requests.push({
        id: crypto.randomBytes(12).toString('base64url'),
        name, phone, note, created: new Date().toISOString(), status: 'pending'
      });
      dirty = true;
    }
    // Skip the whole-db rewrite when nothing changed — this is the one endpoint anonymous
    // callers can hit in a loop, and the dedupe path would otherwise hand them free disk I/O.
    if (dirty) saveDb();
    json(res, 200, { ok: true });
  },

  'GET /api/admin/requests': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    db.requests = pruneRequests(db.requests);
    // redeemed = the minted code was actually used to register, via the invite's usedBy.
    const requests = db.requests.map(r => ({
      ...r, redeemed: !!(r.code && db.invites.find(i => i.code === r.code)?.usedBy)
    })).reverse();   // newest first for display
    json(res, 200, { requests, request_access: REQUEST_ACCESS });
  },

  'POST /api/admin/requests/decide': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const r = db.requests.find(x => x.id === body.id);
    const out = decideRequest(r, !!body.approve, () => mintInvite(admin.id, 'access: ' + r.name, r.id).code);
    if (out.error) return json(res, r ? 400 : 404, { error: out.error });
    saveDb();
    json(res, 200, { request: out.request });
  },

  // One-tap recovery from a spam wave: drops every pending request, keeps decided history.
  'POST /api/admin/requests/clear': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    db.requests = db.requests.filter(r => r.status !== 'pending');
    saveDb();
    json(res, 200, { ok: true });
  },

  /* ---------- group sessions (coached classes) ---------- */
  // Public BY DECISION, not omission: the class calendar is the gym's timetable and guests see
  // it too (this router has no default auth, so every other new route here must guard itself).
  // Windowed to the recent past — old sessions also age out of db.json on save (pruneSessions).
  'GET /api/sessions': async (req, res) => {
    const from = addDaysISO(isoTodayUTC(), -SESSION_WINDOW_DAYS);
    const rows = db.sessions.filter(s => s.date >= from).sort(sessionSort);
    // The admin dashboard edits these, so it needs the raw row (coachId prefills the picker).
    // Everyone else — including anonymous readers, since this endpoint is deliberately public —
    // gets the resolved name and no ids.
    const admin = isAdmin(readSession(req));
    json(res, 200, { sessions: admin ? rows : rows.map(publicSession) });
  },

  // Create (repeatWeeks spawns dated copies sharing a seriesId) or edit. Editing with
  // body.series applies everything but the date to this and all later sessions in the series —
  // without it, fixing a weekly class would mean editing up to 26 copies by hand.
  'POST /api/admin/sessions/save': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const v = validateSession(body.session || {});
    if (v.error) return json(res, 400, { error: v.error });
    const s = v.session;
    // A named coach must be a real coach account. Same rule and wording as assign-coach, so the
    // two places that attach a coach to something cannot drift apart.
    if (s.coachId) {
      const c = db.users.find(x => x.id === s.coachId);
      if (!c || !isCoach(c)) return json(res, 400, { error: 'that user is not a coach' });
      s.coach = '';   // the display fallback is for guests only; an account owns its own name
    }
    const existing = s.id && db.sessions.find(x => x.id === s.id);

    // Warn about a double-booked room or coach, but let the admin proceed: real clubs overlap
    // deliberately, and a hard block would eventually stop something legitimate at the worst
    // moment. Two round trips — report, then commit with confirm.
    if (!body.confirm) {
      const seriesId = body.series && existing ? existing.seriesId : null;
      const conflicts = findSessionConflicts(db.sessions, { ...s, id: existing ? existing.id : null }, { skipSeriesId: seriesId });
      if (conflicts.length) return json(res, 200, { conflicts: conflicts.slice(0, 5) });
    }

    if (existing) {
      const patch = {
        title: s.title, coach: s.coach, room: s.room, time: s.time,
        minutes: s.minutes, note: s.note, updated: Date.now()
      };
      if (body.series && existing.seriesId) {
        // Dates move as a DELTA across the series, not as an absolute. Previously a date edit hit
        // only the clicked occurrence, so moving a weekly class from Tuesdays to Wednesdays meant
        // editing all 26 by hand. Shifting every sibling by the same number of days moves the
        // whole class while preserving its weekly spacing.
        const shift = daysBetweenISO(existing.date, s.date);
        const siblings = db.sessions.filter(x => x.seriesId === existing.seriesId && x.date >= existing.date);
        for (const x of siblings) {
          Object.assign(x, patch);
          if ('capacity' in s) x.capacity = s.capacity; else delete x.capacity;
          if (s.coachId) x.coachId = s.coachId; else delete x.coachId;
          if (shift) x.date = addDaysISO(x.date, shift);
        }
      } else {
        Object.assign(existing, patch, { date: s.date });
        if ('capacity' in s) existing.capacity = s.capacity; else delete existing.capacity;
        if (s.coachId) existing.coachId = s.coachId; else delete existing.coachId;
      }
      notifyCoachOfSession(existing, 'moved');
    } else {
      const created = expandRepeats(s, body.repeatWeeks, () => crypto.randomBytes(12).toString('base64url'));
      for (const x of created) db.sessions.push({ ...x, updated: Date.now(), createdBy: admin.id });
      notifyCoachOfSession(created[0], 'assigned');
    }
    db.sessions = pruneSessions(db.sessions, isoTodayUTC());
    saveDb();
    json(res, 200, { ok: true });
  },

  // Cancelling keeps the class visible, struck through with its reason, so a member who planned
  // around it finds an answer instead of an absence. Deleting stays available for a mistake.
  'POST /api/admin/sessions/cancel': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const s = db.sessions.find(x => x.id === body.id);
    if (!s) return json(res, 404, { error: 'no such session' });
    const reason = String(body.reason || '').trim().slice(0, 120);
    const targets = body.series && s.seriesId
      ? db.sessions.filter(x => x.seriesId === s.seriesId && x.date >= s.date)
      : [s];
    for (const x of targets) {
      if (body.restore) { delete x.cancelled; delete x.cancelReason; }
      else { x.cancelled = true; x.cancelReason = reason; }
      x.updated = Date.now();
    }
    saveDb();
    if (!body.restore) notifyCoachOfSession(s, 'cancelled');
    json(res, 200, { ok: true, cancelled: !body.restore, count: targets.length });
  },

  'POST /api/admin/sessions/delete': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const s = db.sessions.find(x => x.id === body.id);
    if (!s) return json(res, 404, { error: 'no such session' });
    db.sessions = body.series && s.seriesId
      ? db.sessions.filter(x => !(x.seriesId === s.seriesId && x.date >= s.date))
      : db.sessions.filter(x => x.id !== s.id);
    saveDb();
    json(res, 200, { ok: true });
  }
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  // Behind cPanel/Passenger (Namecheap shared hosting) the app is mounted under the site's
  // /api path and requests can arrive with the mount prefix already stripped ('/health'
  // instead of '/api/health'). Accept both shapes; a bare-path request that matches nothing
  // still falls through to the same 404 it always got.
  const pathname = url.pathname.startsWith('/api/') ? url.pathname : '/api' + url.pathname;
  const key = req.method + ' ' + pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
