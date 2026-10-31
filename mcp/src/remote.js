/* opengym-mcp remote mode (CHW-316) — the state from a running server's own API instead of the
   files in DATA_DIR. FitPal Coach's Laravel backend keeps every account's state in its database,
   so there are no state-<uid>.json files for the file mode to read; what it does have is the
   route the app syncs through, GET /api/data, which answers a paired device's bearer token.

   The token comes the way the paired phone gets one (frontend/src/lib/remote.js): a one-time
   code from Settings → "Pair the mobile app", redeemed at POST /api/pair/redeem. scripts/pair.mjs
   does that once and keeps the token in a file of its own, so it is never typed into an LLM
   client's config and never printed. Read-only like the rest of this server: it only GETs. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Where the token is kept: OPENGYM_TOKEN_FILE, else ~/.opengym-mcp/token.json.
export function tokenFile() {
  return process.env.OPENGYM_TOKEN_FILE || path.join(os.homedir(), '.opengym-mcp', 'token.json')
}

// The server's origin from what someone types: a bare host, a trailing slash, stray spaces. The
// app and its /api share one origin, so a path is dropped. https only — the token is a session —
// except on this machine, where a dev server runs plain http.
export function remoteBase(raw) {
  let s = String(raw || '').trim()
  if (!s) throw new Error('no server address given')
  // No scheme typed: https, or http for this machine's dev server (localhost:8000).
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = (/^(?:localhost|127\.0\.0\.1|\[::1\])(?:[:/]|$)/i.test(s) ? 'http://' : 'https://') + s
  let u
  try { u = new URL(s) } catch { throw new Error(`not a server address: ${JSON.stringify(raw)}`) }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local))
    throw new Error(`${u.origin} is not https: the token would cross the network in the clear`)
  return u.origin
}

// Bounded, so a server that takes the connection and never answers fails the tool call in
// seconds rather than hanging the LLM client for undici's five minutes.
export const TIMEOUT_MS = 15_000

// No redirect is followed: the API never sends one, and following one could carry the token to
// another host, or turn a sign-in page into a 200 that reads like an answer.
async function call(base, route, opts = {}) {
  let r
  try {
    r = await fetch(base + route, { ...opts, redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (e) {
    throw new Error(`${base}${route}: ${e.name === 'TimeoutError' ? `no answer in ${TIMEOUT_MS / 1000} s` : e.cause?.message || e.message}`)
  }
  const data = await r.json().catch(() => null)
  if (r.status === 401) {
    throw new Error(`${base} no longer accepts this token (it expires after the server's SESSION_DAYS, ` +
      `and "sign out everywhere" ends it) — pair again: node scripts/pair.mjs ${base} <code>`)
  }
  if (!r.ok) throw new Error(`${route}: ${data?.error || 'HTTP ' + r.status}`)
  // A 200 that is not the API's JSON (the app's index.html while /api is missing, say) is an
  // error, not an empty answer: read as one, it would say the account never synced.
  if (!data || typeof data !== 'object') throw shapeError(base, route)
  return data
}

const shapeError = (base, route) => new Error(`${base}${route} did not answer as the API does — is ${base} the server's address?`)

// One-time: trade a pairing code for a token, and keep it (owner-only where the OS has modes).
export async function pair(raw, code, file) {
  const base = remoteBase(raw)
  const { token, user } = await call(base, '/api/pair/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: String(code || '') })
  })
  if (typeof token !== 'string' || !token || !user) throw new Error(`${base} answered the pairing without a token`)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  fs.writeFileSync(file, JSON.stringify({ url: base, token, user: { id: user.id, name: user.name } }, null, 2) + '\n', { mode: 0o600 })
  return user
}

// The saved pairing for `base` ({ url, token, user }), or an error saying what to do.
export function savedPairing(base, file) {
  let saved = null
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  if (!saved || typeof saved.token !== 'string') throw new Error(`no token in ${file} — pair first: node scripts/pair.mjs ${base} <code>`)
  if (saved.url !== base) throw new Error(`the token in ${file} is for ${saved.url}, not ${base} — pair again: node scripts/pair.mjs ${base} <code>`)
  return saved
}

const auth = token => ({ headers: { Authorization: 'Bearer ' + token } })

// GET /api/me: the public user ({ id, name, … }).
export async function fetchUser(base, token) {
  const { user } = await call(base, '/api/me', auth(token))
  if (!user || typeof user.id !== 'string') throw shapeError(base, '/api/me')
  return user
}

// GET /api/data: the state as the app last synced it, or null for an account that never has.
export async function fetchState(base, token) {
  const d = await call(base, '/api/data', auth(token))
  if (!('state' in d) || (d.state !== null && typeof d.state !== 'object')) throw shapeError(base, '/api/data')
  return d.state
}
