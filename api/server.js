/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   No framework, JSON-file storage, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns';
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
import * as coachConfig from './coach/config.js';
import * as coachJobs from './coach/jobs.js';
import { coachRoutes } from './coach/routes.js';
import { startCadence } from './coach/cadence.js';
import { startWarmup } from './coach/warmup.js';
import { dayReminderPush, restTimerPush, testPush } from './push-messages.js';
import { verifyError } from './verify-error.js';

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
/* The secrets are locked down file by file rather than by sealing the whole directory.
 *
 * A blanket `chmod 0700` on DATA looks stronger and is worse: ./data is a host bind mount and
 * this container runs as root, so it lands on the host as root-owned 0700 and anything else
 * the owner runs against their own data directory — a backup script, the MCP server in #19,
 * their own `jq` — gets EACCES on files that are theirs. Locking the four files that actually
 * hold secrets keeps the Coach runtime out of them without taking the directory hostage.
 *
 * Best-effort throughout: a bind-mounted host filesystem may refuse chmod, and that is not a
 * reason to refuse to boot. The privilege drop in adapters/spawn.js is the control that does
 * fail closed. */
const lock = f => { try { fs.chmodSync(path.join(DATA, f), 0o600); } catch { /* not present yet, or host says no */ } };
['secret', 'db.json', 'coach.json'].forEach(lock);

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
// 0600: db.json holds passkey credential material. It used to be covered by a blanket 0700 on
// the whole directory; now that the directory stays traversable, the file carries its own mode.
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2), 0o600); }
function atomicWrite(file, content, mode) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, mode ? { mode } : undefined);
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

/* A push subscription's `endpoint` is a URL this server connects out to, chosen by whoever is
   signed in — so without a check /api/push/* is a request-forgery lever, and the api container
   sits on the same Docker network as the rest of the self-hoster's stack. Three limits below:

   1. PUSH_AGENT rejects any connection to a private/loopback/link-local address at the moment
      the socket is opened. Validating the URL alone would leave a DNS-rebinding window — the
      name is resolved a second time inside web-push — so the check has to live in the lookup
      the request itself uses, not in a prior pass.
   2. PUSH_TIMEOUT_MS: an endpoint that accepts TCP and then stalls used to hang the request
      handler that awaited it, indefinitely. web-push sets no timeout of its own.
   3. PUSH_CONCURRENCY: one small request must not turn into an unbounded burst of outbound
      connections (with MAX_SUBS_PER_USER below, that is the other half of the same problem). */
const PUSH_TIMEOUT_MS = 10000;
const PUSH_CONCURRENCY = 6;
const MAX_SUBS_PER_USER = 20;

function isPrivateAddr(ip) {
  const v = String(ip).toLowerCase();
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m4) {
    const a = +m4[1], b = +m4[2];
    if (a === 0 || a === 10 || a === 127) return true;            // this-network, private, loopback
    if (a === 169 && b === 254) return true;                      // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true;             // private
    if (a === 192 && b === 168) return true;                      // private
    if (a === 192 && b === 0) return true;                        // 192.0.0.0/24, 192.0.2.0/24
    if (a === 100 && b >= 64 && b <= 127) return true;            // CGNAT
    if (a >= 224) return true;                                    // multicast + reserved
    return false;
  }
  const m6 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(v);
  if (m6) return isPrivateAddr(m6[1]);                            // IPv4-mapped IPv6
  if (v === '::' || v === '::1') return true;                     // unspecified, loopback
  if (/^fe[89ab]/.test(v)) return true;                           // link-local
  if (/^f[cd]/.test(v)) return true;                              // unique local
  return false;
}

// Same shape as dns.lookup, so https.Agent can use it directly.
function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (list.some(a => isPrivateAddr(a.address))) {
      return cb(Object.assign(new Error('refusing to connect to a private address: ' + hostname), { code: 'EPUSHBLOCKED' }));
    }
    cb(null, address, family);
  });
}
const PUSH_AGENT = new https.Agent({ lookup: guardedLookup, keepAlive: false });

// Cheap pre-check so a bad endpoint is refused at subscribe time with a useful message, rather
// than silently never delivering. PUSH_AGENT is what actually enforces the address rule.
function pushEndpointError(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'endpoint is not a valid URL'; }
  if (u.protocol !== 'https:') return 'endpoint must be an https:// URL';
  if (u.username || u.password) return 'endpoint must not carry credentials';
  // A literal address can be judged right here, which turns the common case into a clear error
  // at subscribe time instead of a delivery that quietly never happens. Hostnames are left to
  // PUSH_AGENT, which is the check that actually has to hold.
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[0-9.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddr(host)) return 'endpoint must not point at a private address';
  }
  return null;
}

async function sendPush(userId, payload) {
  const subs = db.subs.filter(s => s.userId === userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let dirty = false;
  let next = 0;
  const worker = async () => {
    while (next < subs.length) {
      const sub = subs[next++];
      // urgency 'high' is the one lever we have over delivery speed — iOS/Android throttle
      // low-urgency background push more aggressively under battery-saving modes. TTL is left
      // at the library default (long) so a briefly-offline device still gets it once reconnected,
      // rather than risking it being dropped for the sake of shaving off latency that TTL doesn't
      // actually control anyway.
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body,
          { urgency: 'high', timeout: PUSH_TIMEOUT_MS, agent: PUSH_AGENT });
      } catch (e) {
        console.error('push send failed', userId, e.statusCode, e.body || e.message);
        if (e.statusCode === 404 || e.statusCode === 410) {
          db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint); dirty = true;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, subs.length) }, worker));
  if (dirty) saveDb();
}

// Rest-timer alerts: client schedules on start/extend, cancels on skip or on-screen completion —
// this only fires when the tab was backgrounded/suspended and never got to cancel it itself.
const restTimers = new Map(); // userId -> Timeout
function scheduleRestTimer(userId, sec, lang) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, restTimerPush(lang));
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

// "Workout planned today" reminder — one per user per day, at their chosen time.
// Duplicated (not imported) from frontend/src/lib/history.js effectiveRoutineId — tiny pure helper, not worth sharing across the two runtimes.
// A weekday can hold a routine-id list (combine routines); the reminder only needs the first.
function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return [].concat(S.week?.[wd] || []).find(id => S.routines?.some(r => r.id === id)) || null;
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
    const date = `${g('year')}-${g('month')}-${g('day')}`;
    // Weekday is derived from the zone's own date, not the server's — a Sunday-evening review
    // has to be Sunday where the user is, which is what the reminder already assumes for time.
    return { date, hhmm: `${g('hour')}:${g('minute')}`, weekday: new Date(date + 'T12:00:00Z').getUTCDay() };
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
    sendPush(user.id, dayReminderPush(S.lang, routine));
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
// With the __Host- prefix the *browser* guarantees the cookie is host-only (no Domain attribute
// is even allowed) — which is what stops a sibling subdomain, e.g. anything-else.example.com
// against gym.example.com, from planting a second session cookie for the shared parent domain
// and having it shadow the real one. The prefix also requires Secure, so it only works on an
// https ORIGIN; over plain http://localhost the old name stays, and localhost has no sibling
// subdomains to worry about. Both names are accepted on the way in, so upgrading an instance
// does not sign anybody out — they move onto the prefixed cookie at their next sign-in.
const COOKIE = SECURE ? '__Host-gymsid' : 'gymsid';
const LEGACY_COOKIE = 'gymsid';
// Every value for a given name, in the order the browser sent them. Not an object: reducing
// duplicates to one entry silently picks a winner, and picking the *last* one handed a shadowing
// cookie the session outright.
function cookieValues(req, name) {
  const out = [];
  for (const c of (req.headers.cookie || '').split(';')) {
    const i = c.indexOf('=');
    if (i < 0) continue;
    if (c.slice(0, i).trim() === name) out.push(c.slice(i + 1).trim());
  }
  return out;
}
function cookieToken(req) {
  for (const name of (COOKIE === LEGACY_COOKIE ? [COOKIE] : [COOKIE, LEGACY_COOKIE])) {
    const vals = cookieValues(req, name);
    if (!vals.length) continue;
    // Two different values under one name is not something a browser does on its own — it means
    // somebody else got to set one. There is no safe way to guess which is the real session, so
    // refuse both: a signed-out user signs back in, a shadowing attempt gets nothing.
    if (vals.some(v => v !== vals[0])) return null;
    return vals[0];
  }
  return null;
}
function readSession(req) {
  // The paired mobile app has no cookie jar shared with the API's origin, so it carries the same
  // signed token in an Authorization header instead — same payload, same verification below.
  const auth = req.headers.authorization || '';
  const tok = cookieToken(req) || (auth.startsWith('Bearer ') ? auth.slice(7).trim() : null);
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
  // Only the 403 is recorded: a 401 is any unauthenticated bot poking /api/admin/*, and
  // logging those would bury the events an operator actually wants to see.
  if (!isAdmin(user)) { audit(req, 'admin.denied', { ok: false, user }); json(res, 403, { error: 'forbidden' }); return null; }
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
// A pending offer outlives the relationship it came from unless something retires it. Without
// this a member could accept a program from an ex-coach up to 30 days later — with that person's
// name still on the card — and those dead rows also consume the per-member pending cap, blocking
// the NEW coach with "already has 5 programs waiting" and clearable by nobody but the member.
// Everything that stops being true when someone can no longer coach: their roster, their
// unanswered offers, and their name on upcoming classes. Both losing the role and being disabled
// mean exactly this, so neither path gets to remember only half of it.
function detachCoach(coachId) {
  db.users.forEach(m => { if (m.coachId === coachId) delete m.coachId; });
  expireAssignmentsWhere(a => a.coachId === coachId);
  // Classes deliberately keep their coachId. Stripping it off every future occurrence — up to a
  // 26-week series — is unrecoverable, and disabling is often temporary (a coach off sick for a
  // week). Instead, eligibility is applied at the two places it is observable: coachOf() below
  // refuses to NAME someone who can no longer coach, and notifyCoachOfSession refuses to push to
  // them. Re-enabling restores the timetable exactly as it was, and the admin can reassign in
  // the meantime.
}

function expireAssignmentsWhere(pred) {
  let n = 0;
  for (const a of db.assignments) {
    if (a.status === 'pending' && pred(a)) {
      a.status = 'expired';
      a.decidedAt = new Date().toISOString();
      n++;
    }
  }
  return n;
}

// The member summary the admin list and the coach list both render.
const memberCard = (u, viewerId = null) => {
  const S = readState(u.id) || {};
  const workouts = S.workouts || [];
  const last = workouts[workouts.length - 1];
  // Sending used to be a black hole — a decline looked exactly like "hasn't opened the app".
  const mine = db.assignments.filter(a => a.memberId === u.id);
  const lastDecided = mine.filter(a => a.status === 'accepted' || a.status === 'declined')
    .sort((a, b) => String(b.decidedAt).localeCompare(String(a.decidedAt)))[0];
  return {
    id: u.id, name: u.name, created: u.created || null, disabled: !!u.disabled,
    workouts: workouts.length, lastWorkout: last ? last.d : null,
    lastSync: S._ts || null, live: livePresence(u.id),
    // Only the viewer's own offers: withdraw is theirs to press, and another coach's pending
    // program is not their business to see or cancel.
    pending: mine.filter(a => a.status === 'pending' && (!viewerId || a.coachId === viewerId))
      .map(a => ({ id: a.id, created: a.created, coachId: a.coachId })),
    lastDecision: lastDecided ? { status: lastDecided.status, at: lastDecided.decidedAt } : null
  };
};
const expireCookie = name => `${name}=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;
function sessionCookie(user) {
  const fresh = `${COOKIE}=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
  // Signing in also retires any pre-upgrade cookie, so nobody is left carrying an unprefixed one
  // (or a shadowing copy of it) alongside the new session.
  return COOKIE === LEGACY_COOKIE ? [fresh] : [fresh, expireCookie(LEGACY_COOKIE)];
}
const clearCookie = COOKIE === LEGACY_COOKIE
  ? [expireCookie(LEGACY_COOKIE)]
  : [expireCookie(COOKIE), expireCookie(LEGACY_COOKIE)];

/* ---------- CSRF ---------- */
// SameSite=Lax keeps the session cookie off a genuinely cross-*site* request. It does not keep it
// off a *sibling subdomain*: gym.example.com and anything-else.example.com are the same site, and
// that is the ordinary self-hosting layout — one domain, one reverse proxy, several apps. Nothing
// else in a request was being checked either; readBody() JSON.parse's the body whatever the
// Content-Type claims, so a hostile page could reach the state-changing routes with a form-style
// POST that needs no CORS preflight at all.
//
// So a state-changing request that came from a browser has to come from ORIGIN. The exemptions
// below are not holes: each of those routes carries its own credential in the body (a WebAuthn
// challenge id, a one-shot pairing code), none of them acts on the caller's existing session, and
// they have to keep working from the mobile WebView, whose origin is never ORIGIN.
const CSRF_EXEMPT = new Set([
  'POST /api/register/options', 'POST /api/register/verify',
  'POST /api/login/options', 'POST /api/login/verify',
  'POST /api/pair/redeem'
]);
const originsMatch = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
function csrfOk(req, key) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  if (CSRF_EXEMPT.has(key)) return true;
  // The paired mobile app authenticates with a Bearer token. A browser never attaches one on its
  // own, so there is no ambient authority for a hostile page to borrow and no origin to check.
  if ((req.headers.authorization || '').startsWith('Bearer ')) return true;
  // Sec-Fetch-Site is set by the browser itself and no page can forge it, and it states exactly
  // the property wanted here — more precisely than comparing origins can. 'same-origin' is the
  // app talking to its own backend; a hostile page reports 'cross-site'; a sibling subdomain,
  // the case SameSite=Lax misses entirely, reports 'same-site'. It is also what keeps the Vite
  // dev server working, where the page is on another port and its Origin is legitimately not
  // ORIGIN. Absent on older Safari and on proxies that strip it, hence the fallback below.
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.origin;
  // No Origin header at all means no browser sent this — curl, a script, a monitoring check.
  // Browsers put an Origin on every state-changing request and a page cannot suppress it, so the
  // forgery this exists to stop always carries one.
  if (!origin) return true;
  return originsMatch(origin, ORIGIN);
}

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

// ---------- device pairing (mobile app "connect to my server", no WebAuthn ceremony) ----------
// A passkey ceremony can't run inside the app's WebView (its origin never matches RP_ID), so the
// app authenticates by redeeming a short code minted from an already signed-in browser tab —
// same 5-min-TTL/one-shot shape as the WebAuthn challenge store above.
const pairings = new Map(); // code -> {uid, exp}
const PAIR_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — read off a screen
function makePairCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(8)).map(b => PAIR_CODE_ALPHABET[b % PAIR_CODE_ALPHABET.length]).join('');
  } while (pairings.has(code));
  return code;
}
setInterval(() => { for (const [k, v] of pairings) if (v.exp < Date.now()) pairings.delete(k); }, 60000).unref();

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
// Naming someone who is disabled or no longer a coach would be worse than naming nobody: a member
// reading "taught by Ana" turns up expecting Ana. Blank until an admin reassigns.
const coachOf = s => {
  const acct = s.coachId ? db.users.find(u => u.id === s.coachId) : null;
  if (acct && isCoach(acct) && !acct.disabled) return acct.name;
  return acct ? '' : (s.coach || '');
};
const publicSession = s => {
  const { coachId, createdBy, ...rest } = s;
  return { ...rest, coachName: coachOf(s) };
};

function notifyCoachOfSession(session, what) {
  if (!session || !session.coachId) return;
  const acct = db.users.find(u => u.id === session.coachId);
  if (!acct || acct.disabled || !isCoach(acct)) return;   // their access is gone; so is the ping
  const when = `${session.date} ${session.time}`;
  const body = what === 'cancelled' ? `${session.title} on ${when} was cancelled`
    : what === 'moved' ? `${session.title} moved to ${when}`
    : `You're teaching ${session.title} on ${when}`;
  sendPush(session.coachId, { title: RP_NAME, body, tag: 'session' }).catch(() => {});
}

/* ---------- audit log ---------- */
// Who signed in, who tried and failed, and what an admin changed. One JSON object per line in
// ./data/audit.log, appended and never rewritten in place. It deliberately does not live in
// db.json: that file is rewritten whole on every save, and the login/register handshakes are
// unauthenticated and unthrottled by design (see SECURITY.md), so an audit trail in there would
// turn one bogus request into a full db.json rewrite. A line torn by a crash costs one event and
// is dropped on read.
//
// On by default. It records strictly less than the instance already holds — every account is in
// db.json and every workout is in state-<uid>.json, both readable by any admin — and a security
// feature that ships switched off protects nobody. IP addresses are the exception: off unless you
// ask for them, because they are the one field here that says where somebody physically is.
const AUDIT_ON = !/^(0|false|no|off)$/i.test(process.env.AUDIT_LOG || '');
const AUDIT_MAX = Math.max(0, +(process.env.AUDIT_MAX || 5000) || 0);     // 0 = no count cap
const AUDIT_DAYS = Math.max(0, +(process.env.AUDIT_DAYS || 90) || 0);     // 0 = no age cap
const AUDIT_IP = /^full$/i.test(process.env.AUDIT_IP || '') ? 'full'
  : /^(1|true|yes|on|net)$/i.test(process.env.AUDIT_IP || '') ? 'net' : 'off';
const auditFile = path.join(DATA, 'audit.log');
let auditSeq = 0;      // never reset, not even by a clear — a wiped log leaves a visible id gap
let auditCount = 0;

// Which header holds the caller depends on what is in front of the API. CF-Connecting-IP comes
// first because a Cloudflare tunnel does NOT forward the client in X-Forwarded-For — that header
// then only carries the tunnel's own container, which looks like a valid answer and isn't. After
// that, the first entry of X-Forwarded-For is the client and everything behind it is our own hops.
// All three are only as trustworthy as the proxy in front: it has to overwrite them rather than
// pass a client-supplied one through. In 'net' mode only the network survives — enough to tell
// one source from another, not enough to point at a person.
function clientIp(req) {
  if (AUDIT_IP === 'off') return null;
  const raw = String(req.headers['cf-connecting-ip'] || '').trim()
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers['x-real-ip'] || '').trim()
    // Nothing in front at all: the socket peer is the client, and it cannot be forged. Behind
    // the bundled web container a header always wins before this is reached.
    || String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '').trim();
  const ip = raw.replace(/^\[|\]$/g, '').slice(0, 45);
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return null;    // never store a header verbatim
  if (AUDIT_IP === 'full') return ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0/24');
  const g = ip.split(':').filter(Boolean).slice(0, 3).join(':');
  return g ? g + '::/48' : null;
}

function auditLines() {
  let text;
  try { text = fs.readFileSync(auditFile, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && r.id && r.ev) rows.push(r); } catch { /* torn line */ }
  }
  return rows;
}
// Retention is a cap, not an archive: age first, then the newest AUDIT_MAX of what's left.
function auditKeep(rows) {
  let out = rows;
  if (AUDIT_DAYS) { const cut = Date.now() - AUDIT_DAYS * 86400000; out = out.filter(r => r.ts >= cut); }
  if (AUDIT_MAX && out.length > AUDIT_MAX) out = out.slice(out.length - AUDIT_MAX);
  return out;
}
function compactAudit() {
  const rows = auditLines();
  for (const r of rows) if (+r.id > auditSeq) auditSeq = +r.id;
  const keep = auditKeep(rows);
  auditCount = keep.length;
  if (keep.length === rows.length) return;
  try { atomicWrite(auditFile, keep.map(r => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '')); }
  catch (e) { console.error('audit compact failed', e.message); }
}

// Never throws: a log that can't be written must not break signing in.
function audit(req, ev, f = {}) {
  if (!AUDIT_ON) return;
  const rec = { id: ++auditSeq, ts: Date.now(), ev, ok: f.ok !== false };
  if (f.user) { rec.uid = f.user.id; rec.name = String(f.user.name || '').slice(0, 40); }
  else {
    if (f.uid) rec.uid = f.uid;
    if (f.name) rec.name = String(f.name).slice(0, 40);
  }
  if (f.target) { rec.tgt = f.target.id; rec.tname = String(f.target.name || '').slice(0, 40); }
  if (f.msg) rec.msg = String(f.msg).slice(0, 120);
  const ip = clientIp(req);
  if (ip) rec.ip = ip;
  try { fs.appendFileSync(auditFile, JSON.stringify(rec) + '\n'); }
  catch (e) { return console.error('audit write failed', e.message); }
  // Amortized: a 5000-event cap rewrites the file once per ~1250 events.
  if (AUDIT_MAX && ++auditCount > AUDIT_MAX * 1.25) compactAudit();
}
if (AUDIT_ON) {
  compactAudit();                                // prune on boot, seed auditSeq/auditCount
  setInterval(compactAudit, 3600000).unref();    // honour AUDIT_DAYS on an idle instance too
}

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: db.users.length }),

  // Public config the login screen needs before anyone is signed in. `coach` is absent unless
  // the instance has both switched the Coach on and successfully connected a provider — the
  // single flag every piece of Coach UI hangs off, so an unconfigured instance is byte-for-byte
  // the app it was before the feature existed.
  'GET /api/config': async (req, res) => {
    const coach = coachConfig.publicConfig();
    json(res, 200, { invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST, request_access: REQUEST_ACCESS, ...(coach ? { coach } : {}) });
  },

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
    if (INVITE_ONLY && !isBootstrapCode(code) && !db.invites.some(i => i.code === code && !i.usedBy && !i.revoked)) {
      // The rejected code itself is never recorded — a near-miss guess in the log is a liability.
      audit(req, 'auth.register.denied', { ok: false, name, msg: 'invite-rejected' });
      return json(res, 403, { error: 'a valid invite code is required' });
    }
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
    if (!c || !c.uid) {
      audit(req, 'auth.register.fail', { ok: false, msg: 'challenge-expired' });
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) {
      // e.message can echo attacker-supplied response fields, so only the reason code is kept.
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'verify-error' });
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'not-verified' });
      return json(res, 400, { error: 'not verified' });
    }
    const { credential } = verification.registrationInfo;
    if (db.creds.find(x => x.id === credential.id)) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'credential-exists' });
      return json(res, 409, { error: 'credential already registered' });
    }
    // Re-check the invite at the last moment (it may have been used/revoked since options), then burn it.
    // The bootstrap code is re-checked here too rather than trusted from the challenge: if someone
    // else finished registering in between, the database is no longer empty and the code is spent.
    // From here to db.users.push there is no await, so that check can't go stale under concurrency.
    const bootstrap = isBootstrapCode(c.code);
    let invite = null;
    if (INVITE_ONLY && !bootstrap) {
      invite = db.invites.find(i => i.code === c.code && !i.usedBy && !i.revoked);
      if (!invite) {
        audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'invite-invalid' });
        return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
      }
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
    audit(req, 'auth.register.ok', { user, msg: invite ? invite.code : null });
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
    if (!c) {
      audit(req, 'auth.login.fail', { ok: false, msg: 'challenge-expired' });
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    const cred = db.creds.find(x => x.id === body.credential?.id);
    if (!cred) {
      // No credential id goes in the log: it is a stable handle for one passkey, and recording it
      // would let an admin correlate an unknown device across attempts. Nothing here identifies
      // the caller beyond the timestamp (and the network, if AUDIT_IP is on).
      audit(req, 'auth.login.fail', { ok: false, msg: 'unknown-credential' });
      return json(res, 404, { error: 'unknown passkey — create a profile first' });
    }
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
    } catch (e) {
      audit(req, 'auth.login.fail', { ok: false, user: db.users.find(u => u.id === cred.userId), uid: cred.userId, msg: 'verify-error' });
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      audit(req, 'auth.login.fail', { ok: false, user: db.users.find(u => u.id === cred.userId), uid: cred.userId, msg: 'not-verified' });
      return json(res, 400, { error: 'not verified' });
    }
    cred.counter = verification.authenticationInfo.newCounter;
    saveDb();
    const user = db.users.find(u => u.id === cred.userId);
    if (!user) {
      audit(req, 'auth.login.fail', { ok: false, uid: cred.userId, msg: 'user-missing' });
      return json(res, 500, { error: 'user missing' });
    }
    if (user.disabled) {
      audit(req, 'auth.login.fail', { ok: false, user, msg: 'account-disabled' });
      return json(res, 403, { error: 'this account has been disabled' });
    }
    audit(req, 'auth.login.ok', { user });
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': sessionCookie(user) });
  },

  // Reads the session purely so the sign-out can be recorded; the cookie is cleared either way.
  // A logout with no valid cookie is a no-op and isn't worth an entry.
  'POST /api/logout': async (req, res) => {
    const user = readSession(req);
    if (user) audit(req, 'auth.logout', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  // "Sign out everywhere" — bumps this user's session version, which invalidates every cookie
  // ever issued for the account, on every device, including a copy someone else walked off with.
  // The caller's own cookie is cleared here too, so the browser doing it doesn't sit on a token
  // it no longer accepts. Passkeys are untouched: signing back in works immediately.
  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    user.sv = sessionVersion(user) + 1;
    saveDb();
    audit(req, 'auth.logout.all', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  // Mobile app pairing: called from an already signed-in browser tab (Settings → "Pair the
  // mobile app") to mint a short code the phone can redeem below.
  'POST /api/pair/create': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const code = makePairCode();
    pairings.set(code, { uid: user.id, exp: Date.now() + 5 * 60000 });
    audit(req, 'auth.pair.create', { user });
    json(res, 200, { code });
  },

  // Called from the mobile app itself with the code shown in the browser. No session required —
  // the code IS the credential, one-shot and 5-minute-lived like a WebAuthn challenge.
  'POST /api/pair/redeem': async (req, res) => {
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    const p = pairings.get(code);
    if (p) pairings.delete(code);
    if (!p || p.exp < Date.now()) {
      audit(req, 'auth.pair.fail', { ok: false, msg: 'code-invalid' });
      return json(res, 400, { error: 'invalid or expired code' });
    }
    const user = db.users.find(u => u.id === p.uid);
    if (!user || user.disabled) {
      audit(req, 'auth.pair.fail', { ok: false, uid: p.uid, msg: 'user-unavailable' });
      return json(res, 400, { error: 'invalid or expired code' });
    }
    audit(req, 'auth.pair.ok', { user });
    json(res, 200, { token: makeSession(user), user: { id: user.id, name: user.name, admin: isAdmin(user) } });
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
    const bad = pushEndpointError(sub.endpoint);
    if (bad) return json(res, 400, { error: bad });
    // Only the two keys the push protocol needs are kept: `sub` is caller-supplied and would
    // otherwise put arbitrary fields into db.json, which every admin route reads back out.
    const keys = { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) };
    db.subs = db.subs.filter(s => s.endpoint !== sub.endpoint);
    // A browser holds one subscription per device, so this cap is far above real use. Without
    // it a single account could pile up endpoints without limit — every one of them a target
    // sendPush() would then contact, and a whole rewrite of db.json per addition.
    const mine = db.subs.filter(s => s.userId === user.id);
    if (mine.length >= MAX_SUBS_PER_USER) {
      const drop = new Set(mine.slice(0, mine.length - MAX_SUBS_PER_USER + 1).map(s => s.endpoint));
      db.subs = db.subs.filter(s => !drop.has(s.endpoint));
    }
    db.subs.push({ userId: user.id, endpoint: sub.endpoint, keys, created: new Date().toISOString() });
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
    await sendPush(user.id, testPush(readState(user.id)?.lang));
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec, readState(user.id)?.lang);
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
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    u.disabled = !!body.disabled;
    if (u.disabled) {
      presence.delete(u.id);   // drop them off "training now" at once
      // Disabling a coach has to do what revoking the role does. It used to lock the account and
      // stop there, which left their members still pointing at them and their pending programs
      // still acceptable — and because a disabled coach drops out of the admin dropdown, those
      // members rendered as "— none —" while in fact still assigned. Invisible and wrong.
      if (isCoach(u)) detachCoach(u.id);
    }
    saveDb();
    audit(req, u.disabled ? 'admin.user.disable' : 'admin.user.enable', { user: admin, target: u });
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
    // An admin is still a coach with the flag off, so nothing is detached — their roster and
    // offers stay valid because they never lost the ability to coach.
    if (!u.coach && !isCoach(u)) detachCoach(u.id);
    saveDb();
    json(res, 200, { ok: true, id: u.id, coach: u.coach });
  },

  'POST /api/admin/user/assign-coach': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const u = db.users.find(x => x.id === body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const coachId = String(body.coachId || '').trim();
    if (!coachId) {
      const had = u.coachId;
      delete u.coachId;
      if (had) expireAssignmentsWhere(a => a.memberId === u.id && a.coachId === had);
      saveDb();
      return json(res, 200, { ok: true, id: u.id, coachId: null });
    }
    const c = db.users.find(x => x.id === coachId);
    if (!c || !isCoach(c)) return json(res, 400, { error: 'that user is not a coach' });
    // The dropdown filters disabled coaches out of a snapshot taken when the sheet opened, so
    // without this a coach disabled in the meantime is still selectable — and lands the member
    // in the "reads as unassigned but isn't" state this release exists to remove.
    if (c.disabled) return json(res, 400, { error: 'that coach is disabled' });
    if (c.id === u.id) return json(res, 400, { error: 'a member cannot be their own coach' });
    const previous = u.coachId;
    u.coachId = c.id;
    // Offers from whoever had them before are no longer this coach's to stand behind.
    if (previous && previous !== c.id) expireAssignmentsWhere(a => a.memberId === u.id && a.coachId === previous);
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
      .map(u => memberCard(u, coach.id));
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

  // Pull back a program that hasn't been answered yet. Only the coach who sent it, and only
  // while it is still pending — once a member has acted on it, it is their data, not the
  // coach's, and unsending would mean reaching into their plan.
  'POST /api/coach/assignments/withdraw': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const a = db.assignments.find(x => x.id === body.id);
    if (!a || a.coachId !== coach.id) return json(res, 404, { error: 'no such assignment' });
    if (a.status !== 'pending') return json(res, 409, { error: 'already decided' });
    a.status = 'withdrawn';
    a.decidedAt = new Date().toISOString();
    saveDb();
    json(res, 200, { ok: true });
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
    // Re-checked here, not only at send: an admin may have moved this member to another coach
    // between the offer arriving and them answering it. expireAssignmentsWhere covers the normal
    // path; this closes the race.
    const sender = db.users.find(x => x.id === a.coachId);
    if (a.status === 'pending' && body.accept && (!sender || !canCoachMember(sender, user, { isAdmin: isAdmin(sender) }))) {
      a.status = 'expired';
      a.decidedAt = new Date().toISOString();
      saveDb();
      return json(res, 409, { error: 'that program is no longer available' });
    }
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
    audit(req, 'admin.invite.create', { user: admin, msg: code });
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    // Flagged, not deleted. The registration gate already refuses a revoked code, and dropping
    // the row destroyed the only record that this code was ever issued — including the note
    // saying who it went to, and the link an approved request still offered to text them.
    inv.revoked = true;
    inv.revokedAt = new Date().toISOString();
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
      ...r,
      redeemed: !!(r.code && db.invites.find(i => i.code === r.code)?.usedBy),
      // Dead = revoked, or the row is gone entirely (older data, before revoke kept a record).
      // Either way there is nothing left worth texting to the requester.
      codeDead: !!(r.code && (() => { const i = db.invites.find(x => x.code === r.code); return !i || !!i.revoked })())
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
    // Everyone gets the resolved coachName — the view renders that and nothing else, so handing
    // admins the raw row alone made the coach disappear from their own timetable. Admins
    // additionally keep coachId, which the edit sheet needs to prefill the picker; anonymous
    // readers get no ids at all, since this endpoint is deliberately public.
    const admin = isAdmin(readSession(req));
    json(res, 200, {
      sessions: rows.map(r => admin ? { ...publicSession(r), coachId: r.coachId || null } : publicSession(r))
    });
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
      const unchanged = s.id && db.sessions.find(x => x.id === s.id)?.coachId === s.coachId;
      if (c.disabled && !unchanged) return json(res, 400, { error: 'that coach is disabled' });
      s.coach = '';   // the display fallback is for guests only; an account owns its own name
    }
    const existing = s.id && db.sessions.find(x => x.id === s.id);

    // Every date this save will actually land on, not just the one on screen. Checking only the
    // edited occurrence made the warning useless for the two cases it exists for: a 26-week
    // series validated week 1 and dropped the other 25 wherever they fell, and "move the weekly
    // class to Wednesdays" validated the first Wednesday only.
    const seriesId = body.series && existing ? existing.seriesId : null;
    const shift = existing && seriesId ? daysBetweenISO(existing.date, s.date) : 0;
    const occurrences = existing
      ? (seriesId
        ? db.sessions.filter(x => x.seriesId === seriesId && x.date >= existing.date)
          .map(x => ({ ...s, id: x.id, date: shift ? addDaysISO(x.date, shift) : x.date }))
        : [{ ...s, id: existing.id }])
      : expandRepeats(s, body.repeatWeeks, () => 'candidate').map(x => ({ ...x, id: null }));

    // Warn about a double-booked room or coach, but let the admin proceed: real clubs overlap
    // deliberately, and a hard block would eventually stop something legitimate at the worst
    // moment. Two round trips — report, then commit with confirm.
    if (!body.confirm) {
      const seen = new Set();
      const conflicts = [];
      for (const occ of occurrences) {
        // A cancelled class holds no room; without this, reopening one to fix a typo warns
        // against whatever legitimately took the slot it freed.
        const candidate = { ...occ, cancelled: existing ? !!existing.cancelled : false };
        for (const c of findSessionConflicts(db.sessions, candidate, { skipSeriesId: seriesId })) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          conflicts.push(c);
        }
      }
      if (conflicts.length) return json(res, 200, { conflicts: conflicts.slice(0, 5) });
    }

    if (existing) {
      const patch = {
        title: s.title, coach: s.coach, room: s.room, time: s.time,
        minutes: s.minutes, note: s.note, updated: Date.now()
      };
      // Told before the row is overwritten: after this, existing.coachId is the NEW coach and
      // whoever the class was taken off would never hear about it.
      const previousCoach = existing.coachId || null;
      const rescheduled = existing.date !== s.date || existing.time !== s.time;
      if (body.series && existing.seriesId) {
        // Dates move as a DELTA across the series, not as an absolute. Previously a date edit hit
        // only the clicked occurrence, so moving a weekly class from Tuesdays to Wednesdays meant
        // editing all 26 by hand. Shifting every sibling by the same number of days moves the
        // whole class while preserving its weekly spacing.
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
      // Only when something they'd act on changed. Pushing "Yoga moved to …" because the capacity
      // was edited is how a coach learns to ignore these.
      if (previousCoach && previousCoach !== (existing.coachId || null))
        notifyCoachOfSession({ ...existing, coachId: previousCoach }, 'cancelled');
      if (existing.coachId && (rescheduled || previousCoach !== (existing.coachId || null)))
        notifyCoachOfSession(existing, previousCoach === existing.coachId ? 'moved' : 'assigned');
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
    audit(req, 'admin.invite.revoke', { user: admin, msg: inv.code });
    json(res, 200, { ok: true });
  },

  /* ---------- activity log ---------- */
  // Newest first, paged by id. Not by offset: the log grows at the front of this view, so an
  // offset cursor would repeat a row whenever an event lands between two pages; and not by
  // timestamp, because two events can share a millisecond. auditKeep() runs on read as well as
  // on the hourly compaction, so nothing past its retention is ever served.
  'GET /api/admin/audit': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const limit = Math.max(1, Math.min(200, +q.get('limit') || 100));
    const before = +q.get('before') || Infinity;
    const cat = q.get('cat') || '';
    let rows = auditKeep(auditLines()).reverse();
    if (cat === 'fail') rows = rows.filter(r => !r.ok);
    else if (cat) rows = rows.filter(r => String(r.ev).startsWith(cat + '.'));
    const page = rows.filter(r => r.id < before).slice(0, limit);
    json(res, 200, {
      events: page,
      total: rows.length,
      nextBefore: page.length === limit ? page[page.length - 1].id : null,
      enabled: AUDIT_ON, ip_mode: AUDIT_IP,
      retention: { max: AUDIT_MAX, days: AUDIT_DAYS },
      now: Date.now()
    });
  },

  // Deleting the log is itself logged, and auditSeq is not reset — so a clear always leaves a
  // visible gap in the ids and can't be used to quietly erase a trace. There is no export route:
  // ./data/audit.log already is the export, in a format jq reads directly.
  'POST /api/admin/audit/clear': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    try { fs.unlinkSync(auditFile); } catch { /* nothing logged yet */ }
    auditCount = 0;
    audit(req, 'admin.audit.clear', { user: admin });
    json(res, 200, { ok: true });
  },

  /* ---------- AI Coach ---------- */
  // Routes live in coach/routes.js and are handed the helpers above rather than importing
  // them: they are closures over db and SECRET, and passing them in keeps that module free of
  // a cycle. Every one of them is inert while the feature is unconfigured.
  ...coachRoutes({ json, readBody, readSession, requireAdmin })
};

/* ---------- Coach: boot recovery, notifications, scheduled reviews ---------- */
// A job that was running when the process died is not coming back; say so rather than leaving
// a spinner that never resolves.
coachJobs.recoverOnBoot();
// A ready proposal is the one Coach event worth a notification. Failures and "nothing to
// change" stay silent on purpose (FR-38/E4).
coachJobs.setProposalHook((uid, pending) => {
  const n = (pending?.changes || []).length;
  if (!n) return;
  sendPush(uid, {
    title: 'Your Coach has been reading',
    body: n === 1 ? '1 suggestion after this week' : `${n} suggestions after this week`,
    tag: 'coach-proposal', url: '#/coach'
  });
});
startCadence({ users: () => db.users, userNow });
startWarmup();

http.createServer(async (req, res) => {
  // Same-origin (the deployed nginx-proxied web app) never triggers CORS, so this only matters
  // for the paired mobile app calling in from its own WebView origin. It carries no cookie
  // (auth is the Authorization header instead), so Allow-Credentials is deliberately never set —
  // reflecting the origin here can't expose the cookie session to anyone.
  const origin = req.headers.origin;
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  const url = new URL(req.url, 'http://x');
  // Behind cPanel/Passenger (Namecheap shared hosting) the app is mounted under the site's
  // /api path and requests can arrive with the mount prefix already stripped ('/health'
  // instead of '/api/health'). Accept both shapes; a bare-path request that matches nothing
  // still falls through to the same 404 it always got.
  const pathname = url.pathname.startsWith('/api/') ? url.pathname : '/api' + url.pathname;
  const key = req.method + ' ' + pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  if (!csrfOk(req, key)) {
    // Logged, not audited: this is reachable without a session, and an audit entry per attempt
    // would let anyone fill the log. An operator who has genuinely mis-set ORIGIN needs to see
    // the mismatch, and the container log is where they will look.
    console.warn('refused cross-origin', key, 'origin=' + req.headers.origin, 'expected=' + ORIGIN);
    return json(res, 403, { error: 'cross-origin request refused' });
  }
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
