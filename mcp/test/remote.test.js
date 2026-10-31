// Remote mode (CHW-316): the state from a server's GET /api/data with a paired token, which is
// how this reads a FitPal Coach account. fetch is stubbed with a fake server that checks the
// bearer token the way the backend does; state.js is re-imported per test so its module-level
// cache starts empty.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildDemoState } from '../../frontend/src/lib/demoSeed.js'
import { remoteBase, pair, savedPairing } from '../src/remote.js'

const BASE = 'https://coach.example.test'
const TOKEN = 'tok-123'
const USER = { id: 'u1', name: 'Ada', admin: false, coach: false, coachName: null }

let dir, file, requests, server

// A fake backend: /api/pair/redeem takes one code, the rest want `Bearer TOKEN`.
function fakeServer({ state = buildDemoState(), code = 'ABCD2345' } = {}) {
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body })
  return async (url, opts = {}) => {
    const u = new URL(url)
    requests.push({ url: u.pathname, auth: opts.headers && opts.headers.Authorization, body: opts.body, redirect: opts.redirect, signal: opts.signal })
    if (u.origin !== BASE) throw new Error('fetch to ' + u.origin)
    if (u.pathname === '/api/pair/redeem') {
      return JSON.parse(opts.body).code === code ? json(200, { token: TOKEN, user: USER }) : json(400, { error: 'invalid or expired code' })
    }
    if (opts.headers?.Authorization !== 'Bearer ' + TOKEN) return json(401, { error: 'not signed in' })
    if (u.pathname === '/api/me') return json(200, { user: USER })
    if (u.pathname === '/api/data') return json(200, { state: server.state })
    return json(404, { error: 'not found' })
  }
}

async function freshState() {
  vi.resetModules()
  return import('../src/state.js')
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opengym-mcp-'))
  file = path.join(dir, 'nested', 'token.json')
  requests = []
  server = { state: buildDemoState() }
  vi.stubGlobal('fetch', fakeServer())
  vi.stubEnv('OPENGYM_URL', BASE)
  vi.stubEnv('OPENGYM_TOKEN_FILE', file)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('remoteBase', () => {
  test('takes what people type: a bare host, a trailing slash, a path', () => {
    expect(remoteBase(' coach.example.test/ ')).toBe(BASE)
    expect(remoteBase('https://coach.example.test/api/')).toBe(BASE)
  })
  test('refuses plain http, except on this machine', () => {
    expect(() => remoteBase('http://coach.example.test')).toThrow(/not https/)
    expect(remoteBase('http://localhost:8000')).toBe('http://localhost:8000')
    expect(remoteBase('http://127.0.0.1:8000/')).toBe('http://127.0.0.1:8000')
  })
  test('refuses an empty address', () => {
    expect(() => remoteBase('  ')).toThrow(/no server address/)
  })
  test('a bare localhost means the dev server\'s plain http', () => {
    expect(remoteBase('localhost:8000')).toBe('http://localhost:8000')
    expect(remoteBase('127.0.0.1')).toBe('http://127.0.0.1')
    expect(remoteBase('localhost.example.test')).toBe('https://localhost.example.test')
  })
})

describe('what the server answers', () => {
  const html = async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <') } })

  test('no redirect is followed, and every request has a deadline', async () => {
    await pair(BASE, 'ABCD2345', file)
    const st = await freshState()
    await st.refresh()
    expect(requests.length).toBe(3)
    for (const r of requests) {
      expect(r.redirect).toBe('error')
      expect(r.signal).toBeInstanceOf(AbortSignal)
    }
  })

  test('a 200 that is not the API (the app\'s index.html) is an error, not "never synced"', async () => {
    await pair(BASE, 'ABCD2345', file)
    const st = await freshState()
    const api = fakeServer()
    vi.stubGlobal('fetch', (url, opts) => new URL(url).pathname === '/api/data' ? html() : api(url, opts))
    await expect(st.refresh()).rejects.toThrow(/did not answer as the API does/)
  })

  test('a /api/me without a user is an error, and leaves nothing behind once the server is right', async () => {
    await pair(BASE, 'ABCD2345', file)
    const st = await freshState()
    const api = fakeServer()
    vi.stubGlobal('fetch', async (url, opts) => new URL(url).pathname === '/api/me' ? { ok: true, status: 200, json: async () => ({}) } : api(url, opts))
    await expect(st.refresh()).rejects.toThrow(/did not answer as the API does/)
    vi.stubGlobal('fetch', api)
    await st.refresh()
    expect(st.getUser().name).toBe('Ada')
  })

  test('a server that never answers fails the call with the deadline, not a hang', async () => {
    await pair(BASE, 'ABCD2345', file)
    const st = await freshState()
    vi.stubGlobal('fetch', async () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') })
    await expect(st.refresh()).rejects.toThrow(/no answer in 15 s/)
  })
})

describe('pair', () => {
  test('redeems the code and keeps the token for that server, not printed anywhere', async () => {
    const user = await pair('coach.example.test', 'ABCD2345', file)
    expect(user.name).toBe('Ada')
    expect(JSON.parse(requests[0].body)).toEqual({ code: 'ABCD2345' })
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    expect(saved).toEqual({ url: BASE, token: TOKEN, user: { id: 'u1', name: 'Ada' } })
    expect(savedPairing(BASE, file).token).toBe(TOKEN)
  })
  test('a spent or wrong code is the server\'s own sentence, and nothing is written', async () => {
    await expect(pair(BASE, 'WRONG', file)).rejects.toThrow('invalid or expired code')
    expect(fs.existsSync(file)).toBe(false)
  })
})

describe('state in remote mode', () => {
  test('refresh() reads GET /api/data with the token, merged over the defaults like the app does', async () => {
    await pair(BASE, 'ABCD2345', file)
    const st = await freshState()
    await st.refresh()
    expect(requests.filter(r => r.url !== '/api/pair/redeem').every(r => r.auth === 'Bearer ' + TOKEN)).toBe(true)
    const S = st.getState()
    expect(S.routines.length).toBe(server.state.routines.length)
    expect(S.gifSize).toBe('full')                     // a default the stored state may lack
    expect(st.getUser()).toEqual({ id: 'u1', name: 'Ada', created: null })
  })

  test('each refresh reads the server again, so a sync on the phone shows on the next call', async () => {
    await pair(BASE, 'ABCD2345', file)
    const st = await freshState()
    await st.refresh()
    server.state = { ...server.state, routines: [] }
    await st.refresh()
    expect(st.getState().routines).toEqual([])
    expect(requests.filter(r => r.url === '/api/me').length).toBe(1)   // the user is read once
  })

  test('the tools answer from it', async () => {
    await pair(BASE, 'ABCD2345', file)
    const st = await freshState()
    const { TOOLS } = await import('../src/tools.js')
    await st.refresh()
    const list = TOOLS.find(t => t.name === 'list_routines').handler({})
    expect(JSON.stringify(list)).toContain(server.state.routines[0].name)
  })

  test('an account that never synced is null, as in file mode', async () => {
    await pair(BASE, 'ABCD2345', file)
    server.state = null
    const st = await freshState()
    await st.refresh()
    expect(st.getState()).toBe(null)
  })

  test('no token yet: says how to pair', async () => {
    const st = await freshState()
    await expect(st.refresh()).rejects.toThrow(`pair first: node scripts/pair.mjs ${BASE} <code>`)
  })

  test('a token for another server is not sent to this one', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ url: 'https://other.example.test', token: TOKEN }))
    const st = await freshState()
    await expect(st.refresh()).rejects.toThrow(/is for https:\/\/other\.example\.test/)
    expect(requests).toEqual([])
  })

  test('a token the server no longer accepts says to pair again', async () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ url: BASE, token: 'expired' }))
    const st = await freshState()
    await expect(st.refresh()).rejects.toThrow(/no longer accepts this token .* pair again/)
  })

  test('pairing again after the token is refused works without a restart', async () => {
    await pair(BASE, 'ABCD2345', file)
    const st = await freshState()
    await st.refresh()
    // Signed out everywhere: the server stops taking the old token and pairs a new one.
    const fresh = 'tok-456'
    const before = fakeServer()
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (opts.headers?.Authorization === 'Bearer ' + fresh) opts = { ...opts, headers: { Authorization: 'Bearer ' + TOKEN } }
      else if (opts.headers?.Authorization) opts = { ...opts, headers: { Authorization: 'Bearer revoked' } }
      return before(url, opts)
    })
    await expect(st.refresh()).rejects.toThrow(/pair again/)
    fs.writeFileSync(file, JSON.stringify({ url: BASE, token: fresh }))
    await st.refresh()
    expect(st.getState().routines.length).toBe(server.state.routines.length)
  })

  test('pairing again as someone else, while the old token still works, takes effect at once', async () => {
    await pair(BASE, 'ABCD2345', file)
    const st = await freshState()
    await st.refresh()
    const api = fakeServer()
    vi.stubGlobal('fetch', async (url, opts = {}) => {
      if (opts.headers?.Authorization === 'Bearer tok-bob' && new URL(url).pathname === '/api/me')
        return { ok: true, status: 200, json: async () => ({ user: { id: 'u2', name: 'Bob' } }) }
      if (opts.headers?.Authorization === 'Bearer tok-bob') opts = { ...opts, headers: { Authorization: 'Bearer ' + TOKEN } }
      return api(url, opts)
    })
    fs.writeFileSync(file, JSON.stringify({ url: BASE, token: 'tok-bob' }))
    await st.refresh()
    expect(st.getUser().name).toBe('Bob')
  })

  test('the data dir is not read in remote mode', async () => {
    const st = await freshState()
    expect(() => st.init()).toThrow(/remote mode/)
  })
})

describe('file mode is untouched', () => {
  test('refresh() is a no-op without OPENGYM_URL', async () => {
    vi.stubEnv('OPENGYM_URL', '')
    const st = await freshState()
    await st.refresh()
    expect(requests).toEqual([])
  })
})
