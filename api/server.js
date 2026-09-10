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
  findSessionConflicts, isRealDate,
  validateUpload, MEDIA_SNIFF_BYTES, safeMediaFile,
  coachBinding, checkinReminderDue, checkinPeriodStart
} from './domain.mjs';
import * as coachConfig from './coach/config.js';
import * as coachJobs from './coach/jobs.js';
import { coachRoutes } from './coach/routes.js';
import { startCadence } from './coach/cadence.js';
import { startWarmup } from './coach/warmup.js';
import { checkinReminderPush, dayReminderPush, restTimerPush, testPush } from './push-messages.js';
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
// PUT /api/data alone gets a bigger one. It is the only route whose body is not a request but a
// person's entire history — every workout, every set, every weigh-in and now every meal — and it
// is the only one that grows on its own with no user action that looks like "uploading". 5 MB is
// years for a lifter and it is NOT years for someone logging four foods a day: meals are the
// first thing in the blob written several times daily, and hitting the cap does not degrade, it
// stops the profile syncing altogether. 16 MB buys the same decade back.
//
// Deliberately not a wider MAX_BODY. Every other route takes a request someone typed, and a
// video-sized JSON body must not become bufferable in the heap on all forty of them just because
// one of them legitimately grew.
//
// NGINX_MAX_BODY (128m by default, sized for the video cap) already sits above this, so the
// invariant in web/nginx.conf.template still holds: node's limit is the one meant to fire,
// because node answers it in JSON the client can read.
const STATE_MAX_BODY = 16 * 1024 * 1024;
// Uploaded media has its own caps and never touches MAX_BODY — the upload routes stream straight
// to disk instead of calling readBody, so a 90 MB video is never a 90 MB Buffer in the heap and
// no JSON route inherits the larger number.
//
// The video default is chosen by the EDGE, not by what node could accept. coach.fitpal.ma is
// proxied by Cloudflare, which refuses request bodies over 100 MB on the free and pro tiers, so
// a cap above that is not a cap: the upload dies at the edge with an HTML error page the client's
// api() helper cannot parse, and the app reports a limit it never actually enforced. 90 leaves
// room for the request's own overhead. Self-hosters behind their own nginx can raise it.
const mb = n => Math.round(n / (1024 * 1024));
const MEDIA_MAX_VIDEO = Math.max(1, +(process.env.MEDIA_MAX_VIDEO_MB || 90) || 90) * 1024 * 1024;
const MEDIA_MAX_PHOTO = Math.max(1, +(process.env.MEDIA_MAX_PHOTO_MB || 12) || 12) * 1024 * 1024;
const MEDIA_DIR = path.join(DATA, 'media');
// A flood guard, not a product rule: several angles of one lift is reasonable, an unbounded
// upload endpoint on a shared-hosting quota is not.
const MEDIA_MAX_PER_EX = 6;
// Unredeemed codes per coach, and it bounds exactly that: how many codes can be usable at once.
// It is NOT a bound on the size of db.invites, which an earlier version of this comment claimed —
// revoking frees a slot, so mint-revoke-repeat grows the table without limit, and db.invites is
// scanned on every registration and rewritten whole on every mint. COACH_MAX_LIFETIME_INVITES is
// the bound on that. Both are flood guards, not product rules: a coach onboarding real people
// comes near neither.
const COACH_MAX_OPEN_INVITES = 20;
const COACH_MAX_LIFETIME_INVITES = 500;
// Progress photos: a closed set of angles rather than a free-text label, because the entire
// value of the feature is comparing like with like — this week's front against March's front.
// A typo'd label does not fail, it quietly starts a fourth series nobody ever looks at.
const PHOTO_POSES = ['front', 'side', 'back'];
// One photo per pose per check-in period: a retake REPLACES the previous file rather than piling
// up beside it. That is the retention rule, and something has to be, because there is no delete
// route for any media in this file and weekly photos across a roster otherwise grow forever on a
// shared-hosting quota nobody can reclaim. The total below is a backstop against a script rather
// than a product limit — three angles a week for over three years.
const MEDIA_MAX_PHOTOS = 500;
// And a byte budget beside it, because a count is only a bound if a row is small. The client
// resizes to ~400 KB before sending (lib/photo.js), but this is a raw-bytes route open to every
// signed-in member and curl does not run lib/photo.js — the row cap ALONE permits 500 ×
// MEDIA_MAX_PHOTO, six gigabytes per member, on a cPanel quota this product shares with a
// sibling deployment. 300 MB is ~750 photos at the size the app actually sends, so it never
// reaches a real client; it is what stops someone posting full-size originals in a loop.
const MEDIA_MAX_PHOTO_TOTAL = 300 * 1024 * 1024;
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
// Coach exercise demos. Coach-global rather than per-user — one coach, and a demo of a barbell
// row is the same file for everyone — so db.json is the right home; ~400 rows is under 90 KB.
// Keying on exId is also what finally gives CUSTOM exercises media, which the stock dataset
// never could.
db.media = db.media || [];
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
/* Stream a request body straight to disk. The same write-temp-then-rename split as atomicWrite,
 * with a stream as the source instead of a string — but the rename is the CALLER's, because the
 * final name is not known until the bytes are in: an exercise demo is content-addressed on the
 * hash of what actually arrived, and the extension comes from sniffing rather than from anything
 * the client said. So this resolves with the file sitting at `tmp`, validated and hashed, and the
 * caller commits it.
 *
 * Three things it must get right, none of which are the happy path:
 *
 *  · **Refuse early.** The head is sniffed as soon as MEDIA_SNIFF_BYTES have arrived, not at the
 *    end — otherwise a 90 MB HEIC is fully uploaded and fully written before anyone looks at it.
 *  · **Leave nothing behind.** Every failure unlinks the temp file. On shared hosting a partial
 *    upload that survives its own rejection is a disk quota filling up with files nothing
 *    references and nothing will ever clean.
 *  · **Do NOT destroy the request on refusal.** The obvious way to stop a sender mid-upload is
 *    req.destroy(), and it silently defeats the entire point of this module: destroying the
 *    request destroys the socket, so the JSON explaining the refusal never reaches the client,
 *    which sees a dropped connection instead. Every carefully worded "convert to MP4 first"
 *    became a connection reset. The caller answers with `Connection: close` instead and lets
 *    node tear the socket down after the response has flushed.
 *    Honest about how far that goes: because the request body was never drained, the close is a
 *    TCP RST rather than a clean FIN. A client that reads the response while still uploading —
 *    curl, and fetch() in the ordinary case — gets the message. A browser tens of MB into a
 *    large upload when the RST lands may still surface a network error instead of the 413. That
 *    is strictly better than losing the message every time, not a guarantee of delivering it.
 *
 * `check` is handed the head and returns validateUpload's shape: `{ error }` refuses, anything
 * else is resolved back to the caller as `meta`.
 */
function streamToFile(req, tmp, maxBytes, check) {
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    const sha = crypto.createHash('sha256');
    let size = 0, head = [], headLen = 0, meta = null, settled = false;

    const fail = (status, message) => {
      if (settled) return; settled = true;
      req.pause();   // stop reading; the response, not a socket teardown, is what answers this
      // Unlink only once the stream has really closed, and reject only once the unlink has run.
      // createWriteStream opens its fd ASYNCHRONOUSLY, so removing the file the instant
      // destroy() is called races that open: the unlink can land first and the pending open then
      // re-creates the file, leaving an orphan nothing will ever clean. Sequencing it this way
      // also means the rejection — and therefore the HTTP response — happens after the file is
      // actually gone, which is what makes "every failure cleans up" a property a test can
      // observe rather than one that is merely usually true.
      out.on('close', () => fs.rm(tmp, { force: true },
        () => reject(Object.assign(new Error(message), { status, clientSafe: true }))));
      out.destroy();
    };
    // Deferred until the head is complete, so it runs once whether that took one chunk or five.
    const sniff = () => {
      const r = check(Buffer.concat(head, headLen));
      head = null;
      if (r && r.error) { fail(415, r.error); return false; }
      meta = r;
      return true;
    };

    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) return fail(413, `file is larger than the ${mb(maxBytes)} MB limit`);
      if (meta === null) {
        head.push(chunk); headLen += chunk.length;
        if (headLen >= MEDIA_SNIFF_BYTES && !sniff()) return;
      }
      sha.update(chunk);
      if (!out.write(chunk)) { req.pause(); out.once('drain', () => req.resume()); }
    });
    req.on('end', () => {
      if (settled) return;
      // Emptiness is judged before format. Both are refusals, but "empty upload" tells the
      // uploader something true and actionable, where sniffing nothing yields the generic
      // "not a recognised image or video file" about a file they never actually sent.
      if (!size) return fail(400, 'empty upload');
      // A file shorter than the sniff window still has to be judged; sniffMedia's own length
      // guard turns a genuinely tiny body into "not a recognised file" rather than a crash.
      if (meta === null && !sniff()) return;
      out.end(() => {
        if (settled) return; settled = true;
        resolve({ bytes: size, meta, sha: sha.digest('hex') });
      });
    });
    req.on('error', () => fail(400, 'upload interrupted'));
    out.on('error', () => fail(500, 'could not write the file'));
  });
}

/* Serve a stored media file, honouring HTTP range requests.
 *
 * This is the first byte-level READ in the API, and it exists because the deployment that takes
 * real clients has no nginx to hand it off to: coach.fitpal.ma is cPanel + LiteSpeed + Passenger,
 * which never renders web/nginx.conf.template. The original design leaned on X-Accel-Redirect and
 * let nginx do the sendfile; that is a Docker-only optimisation here, not the mechanism, so the
 * fallback is the path and node does the work.
 *
 * Range handling is not optional decoration. <video> seeks by issuing range requests, and a
 * server that answers every one of them with the whole file from byte zero makes scrubbing
 * unusable on anything longer than a few seconds — and Safari will refuse to start playback at
 * all unless it gets a 206 for its opening probe.
 *
 * Deliberately narrow: ONE range, not the multipart/byteranges reply a comma-separated list calls
 * for. No browser's media element asks for several. What a request this cannot serve gets is the
 * WHOLE file with a 200 — never a 416 — because 416 means "that range does not exist in this
 * file" and is a lie about a multi-range or an unknown unit, which the spec says to ignore.
 * Everything else — open ranges, suffix ranges, over-long ends — is clamped the way the spec says
 * rather than rejected.
 */
function serveMedia(req, res, file, mime) {
  let st;
  try { st = fs.statSync(file); }
  catch { return json(res, 404, { error: 'not found' }); }
  if (!st.isFile()) return json(res, 404, { error: 'not found' });

  const total = st.size;
  // Names are content-addressed, so a URL cannot change meaning and may be cached forever.
  // `private`, not `public`: the route is behind a session, and a shared cache holding a copy
  // would serve it to whoever asked next, which would quietly undo that check.
  const base = {
    'Content-Type': mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=31536000, immutable'
  };
  // `base` is deliberately NOT spread here. A 416 carrying `max-age=31536000, immutable` is a
  // year-long, unrevalidatable cache entry saying "this file cannot be read" — and the URL has no
  // Vary: Range, so a browser can serve that stored 416 back for an ordinary GET and the demo
  // never plays again for that viewer, with no way to recover. Errors are no-store, like json().
  const unsatisfiable = () => {
    res.writeHead(416, {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${total}`
    });
    res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'range not satisfiable' }));
  };
  const send = (code, headers, opts) => {
    res.writeHead(code, headers);
    if (req.method === 'HEAD') return res.end();
    const s = fs.createReadStream(file, opts);
    // The client going away mid-stream is ordinary (a seek aborts the previous request), so it
    // must not reach the dispatcher's 500 path or fill the log with stack traces.
    s.on('error', () => res.destroy());
    res.on('close', () => s.destroy());
    s.pipe(res);
  };

  const raw = req.headers.range;
  const whole = () => send(200, { ...base, 'Content-Length': total });
  if (!raw) return whole();

  const m = /^bytes=(\d*)-(\d*)$/.exec(String(raw).trim());
  // A Range this server cannot act on is IGNORED, and the whole entity is sent — RFC 9110 §14.2
  // for an unknown unit, and the same answer is the right one for a comma-separated multi-range:
  // the reply that asks for would be multipart/byteranges, a partial version of which is worse
  // than not implementing it, and every client copes with a 200 carrying everything.
  //
  // An earlier revision answered 416 here, reasoning that an honest refusal beats a half
  // implementation. The first half of that is right and the second does not follow: 416 means
  // "the range you asked for does not exist in this file", so saying it to a download manager
  // sending `bytes=0-9,20-29`, or to a proxy sending a unit we do not know, fails a request that
  // a 200 would have served. 416 is now only for a range that parsed and cannot be met.
  if (!m || (m[1] === '' && m[2] === '')) return whole();
  let start, end;
  if (m[1] === '') {
    // A suffix range ("give me the last N bytes"), which is how some players read a trailing
    // index. N larger than the file is the whole file, not an error.
    const n = parseInt(m[2], 10);
    if (!n) return unsatisfiable();
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] === '' ? total - 1 : Math.min(parseInt(m[2], 10), total - 1);
  }
  // Covers the empty file too: total 0 makes every range unsatisfiable, which is correct and is
  // otherwise an off-by-one that serves a 206 promising bytes that do not exist.
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) return unsatisfiable();
  send(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': end - start + 1 }, { start, end });
}

const safeUid = uid => String(uid || '').replace(/[^a-zA-Z0-9_-]/g, '');
const stateFile = uid => path.join(DATA, 'state-' + safeUid(uid) + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

/* Per-user media the SERVER owns, in its own file beside the state one.
 *
 * The naming and the atomic write are deliberately identical to stateFile above; the separation
 * is the whole point. PUT /api/data replaces state-<uid>.json wholesale with whatever the client
 * last held, so a row this process writes into that file survives exactly until the next sync
 * from any device the member owns — including a stale tab. Progress-photo metadata is written
 * here, by the upload route, and the client never pushes this file at all.
 *
 * Bytes are not in it. This holds `{ photos: [ { id, d, pose, file, bytes, mime, created } ] }`
 * and the files themselves live under MEDIA_DIR/photo/<uid>/.
 */
const mediaFile = uid => path.join(DATA, 'media-' + safeUid(uid) + '.json');
const photoDir = uid => path.join(MEDIA_DIR, 'photo', safeUid(uid));
function userPhotos(uid) {
  try {
    const m = JSON.parse(fs.readFileSync(mediaFile(uid), 'utf8'));
    return Array.isArray(m && m.photos) ? m.photos : [];
  } catch { return []; }
}
// What is allowed to leave the server. `file` never is: an unguessable filename stops being
// unguessable the moment it is published, and nothing outside this module needs it — every
// reader addresses a photo by row id.
const publicPhoto = p => ({ id: p.id, d: p.d, pose: p.pose, bytes: p.bytes, mime: p.mime, created: p.created });
/* Both caps in one predicate, because the upload route has to ask twice: once before it reads
 * the body, to refuse a doomed upload without draining it, and once after — where it is the ask
 * that actually binds. `incoming` is 0 on the first call, since nothing is known about the file
 * yet.
 *
 * A retake of a slot that already exists is measured against the rows WITHOUT that slot: it
 * replaces a file rather than adding one, so neither cap can ever stop someone correcting this
 * week's photo — only opening a new slot.
 */
const photoBytes = rows => rows.reduce((n, p) => n + (Number(p.bytes) || 0), 0);
function photoCapError(rows, d, pose, incoming = 0) {
  const rest = rows.filter(p => !(p.d === d && p.pose === pose));
  if (rest.length >= MEDIA_MAX_PHOTOS) return `that is ${MEDIA_MAX_PHOTOS} photos already stored`;
  if (photoBytes(rest) + incoming > MEDIA_MAX_PHOTO_TOTAL)
    return `that is ${mb(MEDIA_MAX_PHOTO_TOTAL)} MB of photos already stored`;
  return null;
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

    // The weekly check-in nudge rides this loop rather than getting a schedule of its own: the
    // hard part — resolving each member's own clock and firing once per day at a time they chose —
    // is already solved here, and a second timer would solve it a second way. It also inherits the
    // right consent: a member who turned reminders off is not pushed about anything.
    //
    // Before the workout guards below on purpose. Those return early on a rest day or a session
    // already logged, and the check-in is owed regardless of whether they trained.
    // Compared against the PERIOD, not the date. The trigger is one ~60s window on one weekday a
    // week, so an exact-date match means any restart spanning that minute costs every affected
    // member the whole week's nudge — and deploy-api.yml restarts the app on every push to main,
    // so a Sunday-morning deploy would silently do exactly that. A DST spring-forward that skips
    // the reminder hour does the same. Late is better than never for something weekly.
    const period = checkinPeriodStart(S, now.date);
    if (user.lastCheckinReminder !== period && checkinReminderDue(S, now.date)) {
      user.lastCheckinReminder = period;
      saveDb();
      sendPush(user.id, checkinReminderPush(S.lang));
    }

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
// `headers` is for callers that refuse WITHOUT reading the request body — the upload routes. Node
// dumps an unread body on a keep-alive socket, so without a `Connection: close` there they would
// drain an arbitrarily large upload from someone who failed the auth check. Every other caller
// reads through readBody, which is bounded, and passes nothing.
function requireCoach(req, res, headers) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }, headers); return null; }
  if (!isCoach(user)) { json(res, 403, { error: 'forbidden' }, headers); return null; }
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
  // Their outstanding codes die with the role, and this is new with coach-minted invites. While
  // only admins could mint, every live code was under the gym's direct control; a code minted by
  // a role that can be TAKEN AWAY is different. The registration gate only asks whether a code is
  // unused and unrevoked, so without this a coach who was let go on Monday still hands out working
  // signups on Tuesday — they would land unassigned, but on an INVITE_ONLY instance they would get
  // in, which is the whole thing INVITE_ONLY is for.
  //
  // Revoked, not deleted, like every other path here: the row is the record that the code was
  // issued and to whom. Only unredeemed ones — a used code is history, not a key.
  db.invites.forEach(i => {
    if (i.coachId === coachId && !i.usedBy && !i.revoked) {
      i.revoked = true;
      i.revokedAt = new Date().toISOString();
      i.revokedReason = 'coach detached';
    }
  });
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
    lastDecision: lastDecided ? { status: lastDecided.status, at: lastDecided.decidedAt } : null,
    // What frontend/src/lib/adherence.js needs to score "are they showing up" without the roster
    // pulling every member's full state. The state is already read at the top of this function,
    // so it costs no extra I/O — only these four fields on the wire.
    adherence: adherenceParts(S, u)
  };
};

// Trimmed to the adherence window on purpose. `dayPlan` holds an entry for every date a member
// has ever rescheduled, so an untrimmed roster payload grows for the life of the account; and
// `workouts` carries whole sessions where only the dates matter here. Nothing outside the window
// can change the answer — adherence.test.js holds that property, which is what makes the trim
// safe rather than merely smaller.
//
// SEND_DAYS is deliberately "at least what the client needs", not "exactly": the client windows
// on the browser's local date and this runs on the server's UTC date, which differ by up to a
// day either way. Trimming to exactly 28 would, for any coach west of UTC between UTC midnight
// and their own, drop the oldest day of the window they are about to score — silently, because
// a stripped date reads as "did not train" rather than as missing data. The extra day costs one
// more short string per member; the client still decides where the window starts.
const ADHERENCE_SEND_DAYS = 30;   // >= frontend/src/lib/adherence.js ADHERENCE_WINDOW_DAYS + 1
const adherenceParts = (S, u) => {
  const since = addDaysISO(isoTodayUTC(), -(ADHERENCE_SEND_DAYS - 1));
  const dayPlan = {};
  for (const [iso, v] of Object.entries(S.dayPlan || {})) if (iso >= since) dayPlan[iso] = v;
  return {
    week: S.week || {},
    dayPlan,
    // Only routines that can actually be trained. An empty one is skipped by nextTrainingDay
    // and refused by the start button, so a day holding nothing else is not a day this member
    // could have turned up for, and scoring it as missed would mark them absent from a session
    // their own app would not let them begin.
    routineIds: (S.routines || []).filter(r => (r.ex || []).length).map(r => r.id),
    trainedDays: [...new Set((S.workouts || []).map(w => w.d).filter(d => d && d >= since))],
    // Clamps the near end of the window: nobody misses sessions from before they joined.
    created: u.created || null
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
// Both refusals below carry a `.status`, which the dispatcher's catch turns into that status and
// this exact message. Before, an over-size body rejected with a bare Error and the request was
// DESTROYED in the same breath: the 500 the dispatcher then wrote went to an already-dead socket,
// so the client saw a connection reset and never read a word of it — and pushState swallows that,
// sets gym_dirty, and the profile silently stops syncing forever. streamToFile above documents
// exactly this trap for the upload routes; readBody never got the same treatment. It does now:
// pause, answer, and let node tear the socket down after the response has flushed.
function readBody(req, limit = MAX_BODY, tooLargeMsg) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > limit) {
        req.pause();   // stop reading; the response, not a socket teardown, is what answers this
        reject(Object.assign(
          new Error(tooLargeMsg || `request body is larger than the ${mb(limit)} MB limit`),
          { status: 413, clientSafe: true }));
        return;
      }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(Object.assign(new Error('bad json'), { status: 400, clientSafe: true })); }
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
// `coachId` is what puts a redeemed code on a coach's roster, and it is an EXPLICIT field rather
// than something inferred from createdBy at redemption. Inferring would be a real bug: isCoach()
// counts admins as coaches implicitly, so every general invite an admin mints — including the ones
// minted automatically when an access request is approved — would silently bind that admin as the
// new member's coach. Only the coach route sets it.
function mintInvite(creatorId, note, { requestId, coachId } = {}) {
  let code;
  do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (db.invites.some(i => i.code === code));
  const invite = { code, note: String(note || '').slice(0, 60), createdBy: creatorId, created: new Date().toISOString() };
  if (requestId) invite.requestId = requestId;
  if (coachId) invite.coachId = coachId;
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
    if (invite) {
      user.invitedBy = invite.code; invite.usedBy = user.id; invite.usedAt = user.created;
      // A coach's code carries who it belongs to, so redeeming it puts this client straight onto
      // that coach's roster — the whole point, since the only other way onto one is an admin
      // running assign-coach by hand.
      //
      // Re-checked HERE rather than trusted from mint time, because a code can sit unread in a
      // message for a fortnight: a coach disabled or demoted in between must not keep acquiring
      // clients. When that happens the signup still SUCCEEDS and the member simply lands
      // unassigned, which is a state the roster already handles. Refusing the registration would
      // punish the client for something only the gym can see and only the gym can fix.
      const bound = invite.coachId ? db.users.find(u => u.id === invite.coachId) : null;
      const boundId = coachBinding(invite, bound, { isCoach: isCoach(bound) });
      if (boundId) user.coachId = boundId;
    }
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
    // Named, not generic: the client shows whatever this says, and "body too large" tells someone
    // whose phone has quietly stopped syncing nothing they can act on.
    const body = await readBody(req, STATE_MAX_BODY,
      `your training data is over the ${mb(STATE_MAX_BODY)} MB limit for one sync, so this device could not save to the server. Delete some old workouts, or export a backup and start a fresh profile.`);
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
      // The tape, same shape and same panel as the client's own screen (lib/measurements.js).
      measurements: S.measurements || [],
      // Weekly check-ins the client authored. Read-only here by construction: the server never
      // writes into a client's state file, because their next whole-state push would erase it.
      checkins: S.checkins || [],
      checkinDay: S.checkinDay ?? null,
      // What they ate, and what they were told to eat. Same rule as the check-ins above: the
      // client authors all three of these and the server only reads them back, because the
      // target itself reached them through an assignment they accepted, not through this file.
      // Without these three keys the whole feature is invisible on the coach dashboard, and the
      // omission is silent — this allow-list is hand-written on purpose (see below).
      meals: S.meals || [],
      mealDays: S.mealDays && typeof S.mealDays === 'object' && !Array.isArray(S.mealDays) ? S.mealDays : {},
      nutriTarget: S.nutriTarget ?? null,
      // Progress photos, and the one field here that does NOT come from readState. They are
      // server-owned (media-<uid>.json), so they arrive from the sidecar instead — and metadata
      // only. The bytes are one authenticated request each against GET /api/media/photo, which
      // re-checks canCoachMember per image, so this payload stays the size it was.
      photos: userPhotos(u.id).map(publicPhoto),
      workouts: (S.workouts || []).slice().reverse(),
      // The rest of what <StatsPanels> reads, so a coach sees the same charts their client does
      // rather than a count. Deliberately narrow: these are display preferences and training
      // data, not the whole state blob — a coach has no business with someone's session
      // secrets, reminders or device settings, and widening this to `...S` would hand them over.
      body: S.body || 'male',
      targetW: S.targetW ?? null,
      effort: S.effort ?? null,
      showRir: S.showRir ?? null,     // legacy field effortOf() still falls back to
      // The plan itself, so the opened client's adherence is scored against every workout above
      // rather than the roster's trimmed window. Untrimmed here because this is one member, and
      // a coach looking at one person should see the whole picture.
      week: S.week || {},
      dayPlan: S.dayPlan || {}
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

  /* ---------- coaching: taking a client on ---------- */
  // Until now the only way onto a coach's roster was POST /api/admin/user/assign-coach — an admin
  // wiring each client by hand, after they had already signed up some other way. A coach could
  // program for people but could not acquire them. This is the same invite machinery the admin
  // dashboard uses, scoped to one coach and carrying who the code belongs to.
  'GET /api/coach/invites': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    json(res, 200, {
      // Scoped on coachId, NOT createdBy: an admin's general invites carry no coachId and must
      // stay invisible here, and a code minted FOR this coach is theirs whoever typed it.
      invites: db.invites.filter(i => i.coachId === coach.id).map(i => ({
        code: i.code, note: i.note, created: i.created, revoked: !!i.revoked,
        usedAt: i.usedAt || null,
        // The name is the point of the list: it is how a coach sees which code the person in
        // front of them used. But "redeeming put them on my roster" is NOT reliably true, which
        // an earlier version of this comment asserted and this same feature makes false: if the
        // coach was disabled or demoted at the moment of redemption, coachBinding() returns null
        // and the member lands unassigned while the invite keeps its coachId — and an admin can
        // reassign anyone afterwards. Either way the name would be of a person who is not theirs,
        // handed out on a screen whose sibling route answers 403 precisely to stop a coach
        // enumerating the gym. So the roster is re-checked here, and a code redeemed by someone
        // who is no longer theirs still shows as used, just not by whom.
        usedByName: (() => {
          if (!i.usedBy) return null
          const u = db.users.find(x => x.id === i.usedBy)
          return u && canCoachMember(coach, u, { isAdmin: isAdmin(coach) }) ? u.name : null
        })()
      })),
      // A coach code only binds anything on an instance that actually gates signup on codes —
      // with INVITE_ONLY off, registration never looks at an invite at all. Said out loud rather
      // than letting a coach hand out codes that quietly do nothing.
      inviteOnly: INVITE_ONLY,
      max: COACH_MAX_OPEN_INVITES
    });
  },

  'POST /api/coach/invites/new': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const mine = db.invites.filter(i => i.coachId === coach.id);
    if (mine.filter(i => !i.usedBy && !i.revoked).length >= COACH_MAX_OPEN_INVITES)
      return json(res, 429, { error: `you already have ${COACH_MAX_OPEN_INVITES} unused codes — revoke one before making another` });
    // The one a coach cannot revoke their way around. Unreachable by hand; it exists so a stuck
    // client looping mint-and-revoke cannot grow the table every registration scans.
    if (mine.length >= COACH_MAX_LIFETIME_INVITES)
      return json(res, 429, { error: 'too many codes made on this account — ask an admin' });
    const invite = mintInvite(coach.id, body.note, { coachId: coach.id });
    saveDb();
    audit(req, 'coach.invite.create', { user: coach, msg: invite.code });
    json(res, 200, { invite });
  },

  'POST /api/coach/invites/revoke': async (req, res) => {
    const coach = requireCoach(req, res); if (!coach) return;
    const body = await readBody(req);
    const inv = db.invites.find(i => i.code === String(body.code || '').toUpperCase());
    // The SAME 404 for "no such code" and "not yours". A distinguishable answer would let any
    // coach probe for the admin's codes, or another coach's, by watching which ones reply
    // differently — the same reasoning as the 403 on GET /api/coach/member.
    if (!inv || inv.coachId !== coach.id) return json(res, 404, { error: 'no such code' });
    if (inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    // Flagged, not deleted, matching the admin route: the registration gate already refuses a
    // revoked code, and dropping the row would destroy the record that it was ever issued.
    inv.revoked = true;
    inv.revokedAt = new Date().toISOString();
    saveDb();
    audit(req, 'coach.invite.revoke', { user: coach, msg: inv.code });
    json(res, 200, { ok: true });
  },

  /* ---------- coach media: exercise demos ---------- */
  // The file is the ENTIRE body and its metadata rides in the query string. There is no multipart
  // parser and there will not be one: multipart exists so an HTML <form> can send several fields
  // at once, we have our own client sending one file and two scalars, and a correct boundary
  // state machine is ~150 lines of the most bug-prone code imaginable in a codebase that parses
  // nothing else. Base64-in-JSON was the other option and is worse — 33% inflation, and the whole
  // video buffered in the node heap.
  //
  // Query params also mean the exact-match route table needs no change; a path parameter would
  // force it to become a regex table.
  'POST /api/media/exercise': async (req, res) => {
    // `Connection: close` on EVERY refusal here, not only the ones after streaming starts. These
    // paths answer without reading the body, so node would otherwise dump it — draining an
    // arbitrarily large upload from a caller who is not even signed in, with neither MAX_BODY nor
    // MEDIA_MAX_VIDEO applying, because streamToFile never ran. Every other POST route is bounded
    // by readBody; this one has to say so itself.
    const shut = { Connection: 'close' };
    const coach = requireCoach(req, res, shut); if (!coach) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const exId = String(q.get('ex') || '').trim();
    // Whitelisted, not escaped: this ends up in a filename, and the set of ids that are valid is
    // far easier to state correctly than the set of traversal tricks that are not.
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(exId)) return json(res, 400, { error: 'bad exercise id' }, shut);
    const label = String(q.get('label') || '').trim().slice(0, 40);
    const atCap = () => db.media.filter(m => m.exId === exId).length >= MEDIA_MAX_PER_EX;
    if (atCap()) return json(res, 429, { error: `that exercise already has ${MEDIA_MAX_PER_EX} videos` }, shut);

    const dir = path.join(MEDIA_DIR, 'ex');
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch { return json(res, 500, { error: 'media directory is not writable' }, shut); }
    const tmp = path.join(dir, '.up-' + crypto.randomBytes(8).toString('hex'));

    let up;
    try { up = await streamToFile(req, tmp, MEDIA_MAX_VIDEO, head => validateUpload(head, 'video')); }
    // `Connection: close` is load-bearing, not tidiness. A refusal happens with the client still
    // sending, so the request body is never fully read and the connection cannot be reused. Node
    // tears the socket down AFTER this response flushes, which is what gets the message out —
    // destroying the request instead loses it, and the uploader sees a dead connection.
    catch (e) { return json(res, e.status || 400, { error: e.message }, { Connection: 'close' }); }

    // Re-checked AFTER the upload, because the first check is a promise about the past: it ran
    // before an await, and db.media is only mutated after one. N concurrent uploads for the same
    // exercise all saw the same pre-upload count and all passed it, so a retry loop could store
    // ten files against a cap of six — and there is no delete route to undo that yet.
    if (atCap()) {
      fs.rm(tmp, { force: true }, () => {});
      return json(res, 429, { error: `that exercise already has ${MEDIA_MAX_PER_EX} videos` });
    }

    // Content-addressed on what actually arrived, never on what the client called it. Two
    // consequences worth having: the same file uploaded twice lands on the same name instead of
    // accumulating, and a name can be cached forever because it cannot change meaning.
    const file = `${exId}-${up.sha.slice(0, 16)}.${up.meta.ext}`;
    const stored = path.join(dir, file);
    try { fs.renameSync(tmp, stored); }
    catch { fs.rm(tmp, { force: true }, () => {}); return json(res, 500, { error: 'could not store the file' }); }

    const row = {
      id: crypto.randomBytes(12).toString('base64url'),
      exId, coachId: coach.id, file, label,
      bytes: up.bytes, mime: up.meta.mime,
      // 'raw' is not "broken" — it is "nothing has yet confirmed a client's browser can decode
      // this". An iPhone's HEVC/.mov lands here, and whatever converts it flips this to 'ready'.
      status: up.meta.needsTranscode ? 'raw' : 'ready',
      created: new Date().toISOString()
    };
    const before = db.media;
    db.media = db.media.filter(m => m.file !== file).concat(row);
    // The file is committed before the row that references it, so a failing save leaves an
    // orphan on disk that nothing lists and no route can delete — permanent, on exactly the
    // shared-hosting quota this route is careful about elsewhere. atomicWrite can genuinely
    // throw here (ENOSPC, EDQUOT), so unwind rather than letting the dispatcher's 500 hide it.
    try { saveDb(); }
    catch (e) {
      db.media = before;
      fs.rm(stored, { force: true }, () => {});
      console.error('media save failed', e);
      return json(res, 507, { error: 'could not record the upload — is the disk full?' });
    }
    json(res, 200, { ok: true, media: row });
  },

  // Signed-in, not coach-only, and deliberately so: the client needs this to know which exercises
  // have a demo before it can render one. Videos are public by design (one coach, no other
  // tenant, and the secret is a demo of a barbell row) — it is progress photos that are private,
  // and they are a different route with a different predicate.
  'GET /api/media/exercises': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, {
      media: db.media.map(m => ({
        id: m.id, exId: m.exId, file: m.file, label: m.label,
        mime: m.mime, bytes: m.bytes, status: m.status, created: m.created
      }))
    });
  },

  // The bytes. Addressed by ROW ID rather than by filename, which is what makes traversal
  // structurally impossible instead of merely filtered: the only paths reachable here are the
  // ones the upload route wrote into db.media, and nothing a caller types becomes part of a path.
  // The filename is still pattern-checked before use, because db.json is a plain file an operator
  // can edit and this is the one place a bad value in it would become a file read.
  'GET /api/media/ex': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const row = db.media.find(m => m.id === id);
    // safeMediaFile rather than a regex inlined here, because the identical guard sits on the
    // progress-photo route and the two drifted apart once already — the copy there rejected a
    // leading '-' or '_' that its own upload route generates. One predicate, one test, both
    // callers. It also absorbs the typeof, which is load-bearing: RegExp.test coerces, so a row
    // with no `file` matches as the string "undefined" and then throws a 500 on .includes().
    if (!row || !safeMediaFile(row.file)) return json(res, 404, { error: 'not found' });
    serveMedia(req, res, path.join(MEDIA_DIR, 'ex', row.file), row.mime);
  },
  // The dispatcher keys on method + path, so serveMedia's HEAD branch is unreachable without
  // this — and a HEAD that 404s while the GET beside it works is the kind of thing a player
  // probes with and then gives up on.
  'HEAD /api/media/ex': (req, res) => routes['GET /api/media/ex'](req, res),

  /* ---------- progress photos ---------- */
  /* The client's own photo of themselves, which is the opposite direction to every other media
   * route in this file, and the reason it gets its own store rather than another db.media row.
   *
   * GET /api/media/exercises hands EVERY db.media row to any signed-in member, deliberately: one
   * coach, no other tenant, and a demo of a barbell row is not a secret. Dropping progress photos
   * into that array would publish the whole gym's photos to the whole gym, and the mistake would
   * sit one field away from the correct code forever after. Separate array, separate route,
   * separate predicate.
   *
   * Metadata in the query string and the file as the entire body, same as the demo route above
   * and for the same reasons: no multipart parser, no base64 inflation, no regex route table.
   */
  'POST /api/media/photo': async (req, res) => {
    // Every refusal before the body is read closes the socket, or node drains an arbitrarily
    // large upload from someone who failed the check. See POST /api/media/exercise.
    const shut = { Connection: 'close' };
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' }, shut);
    const q = new URL(req.url, 'http://x').searchParams;
    // The check-in period this belongs to, computed client-side by periodStart() in
    // lib/checkins.js — the same value the check-in's own row is filed under. THAT is what joins
    // a photo to a check-in: a shared, client-authored natural key, and no new field on either
    // side. A reference stored on the check-in row instead would be silently dropped the next
    // time the client edited it, because upsertCheckin rebuilds the entry from the keys it knows.
    const d = String(q.get('d') || '').trim();
    if (!isRealDate(d)) return json(res, 400, { error: 'bad date' }, shut);
    const pose = String(q.get('pose') || '').trim();
    if (!PHOTO_POSES.includes(pose)) return json(res, 400, { error: 'bad pose' }, shut);

    // Cheap refusal before the body is read, so an upload that cannot be kept is not carried
    // across the wire first. It is not the check that binds — see the second call below.
    const early = photoCapError(userPhotos(user.id), d, pose);
    if (early) return json(res, 429, { error: early }, shut);

    const dir = photoDir(user.id);
    try { fs.mkdirSync(dir, { recursive: true }); }
    catch { return json(res, 500, { error: 'media directory is not writable' }, shut); }
    const tmp = path.join(dir, '.up-' + crypto.randomBytes(8).toString('hex'));

    let up;
    try { up = await streamToFile(req, tmp, MEDIA_MAX_PHOTO, head => validateUpload(head, 'photo')); }
    catch (e) { return json(res, e.status || 400, { error: e.message }, { Connection: 'close' }); }

    // Unguessable, NOT content-addressed — the exact inverse of the demo route, for the inverse
    // reason. A demo's name may be derived from its bytes because every signed-in member is
    // allowed to have it anyway. A progress photo's name must carry no information at all, so
    // that if this directory is ever reachable by something other than the route below (a static
    // handler somebody adds, a backup served over HTTP) the filenames are not an index of who
    // photographed themselves and when. It costs the dedupe the other route gets; that dedupe
    // would itself leak here, by making identical bytes collide across two people.
    //
    // base64url's alphabet includes '-' and '_', so 2 names in 64 begin with one. Whatever reads
    // these back has to accept that — safeMediaFile does, deliberately and with a test; a guard
    // that did not stored one photo in thirty-two and then refused to serve it.
    const file = crypto.randomBytes(16).toString('base64url') + '.' + up.meta.ext;
    const stored = path.join(dir, file);
    try { fs.renameSync(tmp, stored); }
    catch { fs.rm(tmp, { force: true }, () => {}); return json(res, 500, { error: 'could not store the file' }); }

    const row = {
      id: crypto.randomBytes(12).toString('base64url'),
      d, pose, file, bytes: up.bytes, mime: up.meta.mime,
      created: new Date().toISOString()
    };
    // Re-read rather than reusing the pre-upload snapshot: that one was taken before an await,
    // and a photo for a different pose may have landed in between. Only the one (d, pose) slot this request
    // owns is replaced, so two poses uploaded in parallel cannot erase each other.
    //
    // From here to atomicWrite there is no await, deliberately. readFileSync → filter → concat →
    // writeFileSync → renameSync all run in one tick, so on a single node process the whole
    // read-modify-write is atomic against every other request and a lost update is impossible.
    // Put an await anywhere in this run and a second upload can interleave and drop a row while
    // leaving its file behind, which nothing would ever notice.
    const before = userPhotos(user.id);
    // The caps, re-asked AFTER the upload, for the reason the demo route states in the same
    // place: the first ask ran before an await and is a promise about the past. N parallel
    // uploads with distinct (d, pose) all read the same pre-upload count and all passed it, and
    // there is no delete route to reclaim what that stores. This ask is a fact — `before` is the
    // post-await read and nothing awaits between here and the write.
    const capped = photoCapError(before, d, pose, up.bytes);
    if (capped) {
      fs.rm(stored, { force: true }, () => {});
      return json(res, 429, { error: capped });
    }
    const next = before.filter(p => !(p.d === d && p.pose === pose)).concat(row)
      .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
    try { atomicWrite(mediaFile(user.id), JSON.stringify({ photos: next })); }
    catch (e) {
      // Nothing shared was mutated — unlike the demo route there is no in-memory table to roll
      // back — so the whole unwind is the file that was just committed.
      fs.rm(stored, { force: true }, () => {});
      console.error('photo save failed', e);
      return json(res, 507, { error: 'could not record the upload — is the disk full?' });
    }
    // The replaced file goes only AFTER the row pointing at it is gone. The other order leaves a
    // row naming a file that no longer exists whenever that write fails — a permanently broken
    // image on the coach's screen with nothing in the product able to repair it.
    for (const old of before) {
      if (old.d === d && old.pose === pose && typeof old.file === 'string' && old.file !== file)
        fs.rm(path.join(dir, path.basename(old.file)), { force: true }, () => {});
    }
    json(res, 200, { ok: true, photo: publicPhoto(row) });
  },

  // The caller's OWN rows, so their check-in sheet can show which angles this week already has.
  // No `u` parameter and no coach path: a coach reads their client's list through
  // GET /api/coach/member, which is where the per-member predicate already lives.
  'GET /api/media/photos': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { photos: userPhotos(user.id).map(publicPhoto) });
  },

  /* The bytes — the only private media in this file.
   *
   * Every refusal that depends on WHO is asking or WHICH photo they asked for is the same 403
   * with the same body: not your client, no such member, no such photo. A 404 for the last of
   * those would let a coach holding one valid id walk the space and learn who else trains here —
   * the identical enumeration GET /api/coach/member refuses to allow, and the reasoning is
   * copied from there. Only "not signed in" answers differently, and it can leak nothing,
   * because it never looks at the parameters at all.
   *
   * The owner check comes FIRST, and that ordering is load-bearing rather than tidy:
   * canCoachMember returns false when coach and member are the same person (coaching yourself is
   * the ordinary Plan screen — domain.mjs), so a gate written the other way round would lock a
   * coach who files their own check-ins out of their own photos.
   */
  'GET /api/media/photo': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const q = new URL(req.url, 'http://x').searchParams;
    // Defaulting to the caller keeps a member's own thumbnails working without the client having
    // to know its own uid, and keeps one code path for both readers.
    const owner = db.users.find(x => x.id === String(q.get('u') || user.id));
    const mayRead = !!owner &&
      (owner.id === user.id || canCoachMember(user, owner, { isAdmin: isAdmin(user) }));
    const row = mayRead ? userPhotos(owner.id).find(p => p.id === q.get('id')) : null;
    // Shared with GET /api/media/ex, and shared BECAUSE of what happened when it was not: the
    // copy that used to sit here refused a leading '-' or '_', which base64url produces for 2
    // names in 64 — so one photo in thirty-two uploaded fine and then 403'd forever, a broken
    // tile on both screens with no delete route to clear it. domain.mjs argues the character
    // classes; safeMediaFile also does the typeof that keeps a damaged row from 500ing.
    if (!row || !safeMediaFile(row.file)) return json(res, 403, { error: 'forbidden' });
    serveMedia(req, res, path.join(photoDir(owner.id), row.file), row.mime);
  },
  // Same reason as the demo route: the dispatcher keys on method + path, so serveMedia's HEAD
  // branch is unreachable without an explicit alias.
  'HEAD /api/media/photo': (req, res) => routes['GET /api/media/photo'](req, res),

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
    audit(req, 'admin.invite.create', { user: admin, msg: invite.code });
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
    // This call existed since v1.2.9 — inside POST /api/admin/sessions/delete, where neither
    // `admin` nor `inv` is defined. It threw a ReferenceError on every class deletion, AFTER
    // saveDb() had persisted it: the class went and the dashboard reported a 500. Meanwhile
    // invite revocations went unlogged the whole time, despite the label existing and being
    // asserted in audit.test.js. Verbatim the same line, in the function it was written for.
    audit(req, 'admin.invite.revoke', { user: admin, msg: inv.code });
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
    const out = decideRequest(r, !!body.approve, () => mintInvite(admin.id, 'access: ' + r.name, { requestId: r.id }).code);
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
      // HEAD and Range are here for media playback from the paired mobile app, the one client
      // that is genuinely cross-origin. Range is not a CORS-safelisted request header, so a
      // ranged fetch preflights — and without both of these that preflight fails, which reads as
      // "the video does not load" with nothing in any log to say why.
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Range',
      // A cross-origin reader sees no response headers beyond the safelist unless they are named
      // here, so without this the client gets its 206 and cannot read how much of what it asked
      // for it actually received.
      'Access-Control-Expose-Headers': 'Content-Range, Accept-Ranges, Content-Length',
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
    // A refusal that named its own 4xx is an ANSWER, not a crash — readBody's 413 and 400 carry
    // a message written for whoever sent the request. Flattening those into "server error" is how
    // a client ends up retrying forever against a limit nobody told it about.
    //
    // Gated on `clientSafe`, NOT on `.status` alone, and the difference is the whole point of
    // the comment that used to sit here. `.status` is a field anyone can put on an Error and is
    // exactly what an HTTP client library sets: the day any helper here wraps `undici` or a
    // provider SDK, a 400 from THAT would have relayed its provider-authored message straight to
    // the requester, which is the internal detail this was written to withhold. Only the three
    // places that mint a deliberate refusal — readBody's 413 and 400, streamToFile's — set
    // clientSafe, so only sentences written to be read by a caller can reach one.
    // Logged as a warning either way, at the same volume as the cross-origin refusal above, so
    // an operator asked "why did my phone stop syncing" has a line to find. Not console.error:
    // a 400 from a scanner is not a fault in this server and must not read as one.
    if (e && e.clientSafe === true && Number.isInteger(e.status) && e.status >= 400 && e.status < 500) {
      console.warn('refused', key, e.status, e.message);
      // Connection: close for the same reason the upload routes send it: a refusal happens with
      // the client still sending, so the body was never fully read and the socket cannot be
      // reused. Node tears it down AFTER this response flushes, which is what gets the message
      // out — destroying the request instead is what loses it.
      if (!res.headersSent) json(res, e.status, { error: e.message }, { Connection: 'close' });
      return;
    }
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));
