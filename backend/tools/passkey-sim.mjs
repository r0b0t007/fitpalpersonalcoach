#!/usr/bin/env node
// A software passkey, for the WebAuthn spike and the import test.
//
// It does what navigator.credentials does for the React app (frontend/src/lib/api.js:124-168):
// takes the options JSON from /register/options or /login/options, produces a P-256 credential
// with attestation "none", and posts back the same JSON shape credToJSON builds. The key pair is
// kept in a file, so a credential registered against the Node API can later be asserted against
// the Laravel API after the import, which is the thing the spike has to prove.
//
//   node tools/passkey-sim.mjs register http://127.0.0.1:3000 "Nadia" [inviteCode] [--keys FILE]
//   node tools/passkey-sim.mjs login    http://127.0.0.1:8000 [--keys FILE] [--uv 0]
//
// Prints the server's JSON and the Set-Cookie header. Exit 1 on any non-2xx.

import { createHash, createPrivateKey, createPublicKey, createSign, generateKeyPairSync, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const [, , cmd, base, ...rest] = process.argv
const opt = (name, def) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : def }
const positional = rest.filter((a, i) => !a.startsWith('--') && (i === 0 || !rest[i - 1].startsWith('--')))
const keysFile = opt('--keys', 'tools/.passkey-sim.json')
const uv = opt('--uv', '1') !== '0'
if (!cmd || !base) { console.error('usage: passkey-sim.mjs register|login <base> ...'); process.exit(2) }

const b64u = buf => Buffer.from(buf).toString('base64url')
const fromB64u = s => Buffer.from(s, 'base64url')
const sha256 = buf => createHash('sha256').update(buf).digest()
const origin = new URL(base).origin

// Minimal CBOR encoder: enough for the attestation object and a COSE EC2 key.
function cbor(v) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n])
    if (n < 256) return Buffer.from([(major << 5) | 24, n])
    if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255])
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v])
  if (typeof v === 'string') { const s = Buffer.from(v, 'utf8'); return Buffer.concat([head(3, s.length), s]) }
  if (Number.isInteger(v)) return v >= 0 ? head(0, v) : head(1, -1 - v)
  if (v instanceof Map) {
    // Canonical order: shorter keys first, then bytewise. COSE keys here are small ints.
    const entries = [...v.entries()].map(([k, val]) => [cbor(k), cbor(val)])
      .sort((a, b) => a[0].length - b[0].length || Buffer.compare(a[0], b[0]))
    return Buffer.concat([head(5, entries.length), ...entries.flat()])
  }
  throw new Error('cbor: unsupported ' + typeof v)
}

function loadKeys() {
  if (!existsSync(keysFile)) throw new Error(`no credential yet in ${keysFile} — register first`)
  return JSON.parse(readFileSync(keysFile, 'utf8'))
}

async function post(path, body) {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
  const text = await r.text()
  let data; try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { status: r.status, data, cookie: r.headers.get('set-cookie') }
}

function clientData(type, challengeB64u) {
  return Buffer.from(JSON.stringify({ type, challenge: challengeB64u, origin, crossOrigin: false }), 'utf8')
}
const flags = (at) => (uv ? 0x05 : 0x01) | (at ? 0x40 : 0)   // UP, UV, AT

if (cmd === 'register') {
  const [name, code] = positional
  const { status, data } = await post('/api/register/options', { name: name || 'Sim User', code: code || '' })
  if (status !== 200) { console.error('options', status, JSON.stringify(data)); process.exit(1) }
  const { cid, options } = data
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = publicKey.export({ format: 'jwk' })
  const credId = randomBytes(16)
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, fromB64u(jwk.x)], [-3, fromB64u(jwk.y)]]))
  const rpIdHash = sha256(Buffer.from(options.rp.id, 'utf8'))
  const authData = Buffer.concat([rpIdHash, Buffer.from([flags(true)]), Buffer.from([0, 0, 0, 0]), Buffer.alloc(16), Buffer.from([credId.length >> 8, credId.length & 255]), credId, cose])
  const attObj = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]))
  const credential = {
    id: b64u(credId), rawId: b64u(credId), type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
    response: { clientDataJSON: b64u(clientData('webauthn.create', options.challenge)), attestationObject: b64u(attObj), transports: ['internal'] },
  }
  const v = await post('/api/register/verify', { cid, credential })
  console.log(v.status, JSON.stringify(v.data)); if (v.cookie) console.log('set-cookie:', v.cookie.split(';')[0])
  if (v.status !== 200) process.exit(1)
  writeFileSync(keysFile, JSON.stringify({
    credId: b64u(credId), userHandle: options.user.id, rpId: options.rp.id, counter: 0,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), cosePublicKey: b64u(cose), userId: v.data.user?.id,
  }, null, 2))
  console.log('credential saved to', keysFile)
} else if (cmd === 'login') {
  const k = loadKeys()
  const { status, data } = await post('/api/login/options', {})
  if (status !== 200) { console.error('options', status, JSON.stringify(data)); process.exit(1) }
  const { cid, options } = data
  const rpIdHash = sha256(Buffer.from(options.rpId || k.rpId, 'utf8'))
  k.counter += 1
  const counter = Buffer.alloc(4); counter.writeUInt32BE(k.counter)
  const authData = Buffer.concat([rpIdHash, Buffer.from([flags(false)]), counter])
  const cdj = clientData('webauthn.get', options.challenge)
  const signature = createSign('sha256').update(Buffer.concat([authData, sha256(cdj)])).sign(createPrivateKey(k.privateKeyPem))
  const credential = {
    id: k.credId, rawId: k.credId, type: 'public-key', clientExtensionResults: {}, authenticatorAttachment: 'platform',
    response: { clientDataJSON: b64u(cdj), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: k.userHandle },
  }
  const v = await post('/api/login/verify', { cid, credential })
  console.log(v.status, JSON.stringify(v.data)); if (v.cookie) console.log('set-cookie:', v.cookie.split(';')[0])
  if (v.status !== 200) process.exit(1)
  writeFileSync(keysFile, JSON.stringify(k, null, 2))
} else if (cmd === 'pem') {
  // The SPKI PEM of the stored key, to compare with what the import produces from the COSE bytes.
  const k = loadKeys()
  console.log(createPublicKey(createPrivateKey(k.privateKeyPem)).export({ type: 'spki', format: 'pem' }))
} else {
  console.error('unknown command', cmd); process.exit(2)
}
