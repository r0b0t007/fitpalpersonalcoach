// Backend + WebAuthn helpers (ported from the vanilla app).
import { t } from './i18n-core.js'
import { serverText } from './server-messages.js'

export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
// Narrower than IS_APPLE (which also matches Mac desktops): true only on a touch iOS/iPadOS
// device, where "Add to Home Screen" via the Safari share sheet is the only way to install —
// there is no beforeinstallprompt API on that platform.
export const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (IS_APPLE && navigator.maxTouchPoints > 1)
// How this device confirms a passkey, slotted into sentences on the sign-in screen. A function,
// not a constant, so it reads the language at render time rather than at import (always
// English). No possessive: the same phrase has to fit "confirm with {0}" and "Passkeys use {0}",
// and German declines "dein" differently after each.
export const bioLabel = () => IS_APPLE ? 'Face ID / Touch ID'
  : IS_ANDROID ? t('fingerprint or face unlock') : t('fingerprint, face or PIN')
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
// PublicKeyCredential is the WebAuthn-specific capability signal. Do not also gate the UI on
// navigator.credentials: some browsers expose WebAuthn while that generic Credential Management
// API check produces a false negative (notably Chrome on iOS). The real create/get calls still run
// only after the user chooses a passkey action and surface any genuine browser error there.
export const webauthnOK = () => typeof window.PublicKeyCredential !== 'undefined'

// The paired mobile app (lib/remote.js) is the only caller of these — everywhere else stays on
// same-origin cookies, so remoteBase/remoteToken stay empty and api() behaves exactly as before.
let remoteBase = ''
let remoteToken = null
export function setRemoteAuth(base, token) { remoteBase = base || ''; remoteToken = token || null }
// Where the server actually is, for the one case that needs to say it out loud rather than call
// it: an invite link the coach hands to somebody else (lib/invite.js). On the paired mobile build
// the WebView's own origin is capacitor://localhost, which is not a place anyone else can open.
export const serverBase = () => remoteBase

export async function api(path, opts) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts && opts.headers)
  if (remoteToken) headers.Authorization = 'Bearer ' + remoteToken
  const r = await fetch(remoteBase + path, Object.assign({}, opts, { headers }))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error ? serverText(data) : 'HTTP ' + r.status); e.status = r.status; throw e }
  return data
}

// Bootstraps the connection itself: the base isn't configured yet (that's what this call decides),
// so it talks straight to the server the user typed in, no Authorization header.
export async function pairRedeem(serverBase, code) {
  const r = await fetch(serverBase + '/api/pair/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error ? serverText(data) : 'HTTP ' + r.status); e.status = r.status; throw e }
  return data
}

// Coach exercise demos. The list is ordinary JSON and goes through api() like everything else.
export const fetchExerciseMedia = () => api('/api/media/exercises').then(d => d.media || [])
// A member's own progress photos. Ordinary JSON, so it goes through api(); the bytes do not.
export const fetchMyPhotos = () => api('/api/media/photos').then(d => d.photos || [])

/* The uploads cannot. api() hard-sets Content-Type: application/json and unconditionally parses
   the response, while both media routes want the raw file as the ENTIRE body with its metadata
   in the query string — there is no multipart parser on the server and there is not going to be
   one.

   XMLHttpRequest rather than fetch for exactly one reason: fetch has no upload-progress event at
   all, and 90 MB of video with no bar is indistinguishable from a hang. That means re-doing what
   api() does — remoteBase, the Bearer token, the error unwrap — for the third time in this file,
   which is the price of remoteBase/remoteToken being module-private. They have to be: a bare
   fetch or XHR written in a view would silently hit the wrong origin and drop the token on the
   paired mobile build. pairRedeem above is the same bargain for the same reason.

   Written once and shared by both callers below rather than copied. `cutOff` is the sentence for
   the one path where nothing else is known — a network failure with no response at all — and each
   caller passes its own, because "too large or not a video" is wrong advice to give someone
   sending a photo.

   Returns a promise with .abort() on it, because cancelling a 90 MB upload is not a luxury. A
   refusal's parsed body rides on the error as `data`, for the one caller that reads more than the
   sentence (a chunk told where the server is — see uploadExerciseMedia). */
function rawUpload(path, body, onProgress, cutOff, method = 'POST') {
  const xhr = new XMLHttpRequest()
  const p = new Promise((resolve, reject) => {
    xhr.open(method, remoteBase + path)
    if (remoteToken) xhr.setRequestHeader('Authorization', 'Bearer ' + remoteToken)
    // Advisory only — the server sniffs the first 64 bytes and believes those, not this header.
    // It is still set, because an edge in front of node (Cloudflare, LiteSpeed) reads it, and
    // because a body sent as application/json when it is a JPEG is a lie either way.
    if (body && body.type) xhr.setRequestHeader('Content-Type', body.type)
    xhr.upload.onprogress = e => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data)
      // The server's wording is the instruction — "use MP4 or MOV", "set the camera to Most
      // Compatible". Pass it through, translated but otherwise untouched; a generic "upload failed"
      // throws away the only thing that tells the person what to change.
      const e = new Error(data.error ? serverText(data) : 'HTTP ' + xhr.status); e.status = xhr.status; e.data = data; reject(e)
    }
    // A refusal happens while the browser is still sending, and the server closes the socket to
    // get its message out. Usually the response still lands (onload above); when it does not,
    // the browser reports a bare network failure with no status. Name the two things that
    // actually cause it rather than inventing a reason, and do not overwrite a real 413/415.
    xhr.onerror = () => reject(new Error(cutOff))
    xhr.onabort = () => reject(Object.assign(new Error(t('Upload cancelled')), { aborted: true }))
    xhr.send(body)
  })
  p.abort = () => xhr.abort()
  return p
}

/* Whether this server takes a demo in chunks, and how big each may be: /api/config's `upload`,
   asked once per server. Cloudflare refuses a body over 100 MB and gives up on a request not sent
   and answered within about 100 s, so a large video on a slow phone uplink cannot cross it as one
   request. Only the Laravel API offers chunks; the Node API's config has no `upload` — and so does
   a config that could not be read — and then the demo goes as the one request it always went as.
   0 means "one request". */
let chunkPlan = null
let chunkPlanFor = null
function chunkSize() {
  if (chunkPlan && chunkPlanFor === remoteBase) return chunkPlan
  const base = remoteBase
  chunkPlanFor = base
  chunkPlan = api('/api/config')
    .then(c => (c && c.upload && c.upload.chunked === true && c.upload.chunk_mb > 0 ? c.upload.chunk_mb * 1048576 : 0))
    // Only an answer is remembered: a config that could not be read this once is asked again by
    // the next upload, rather than turning chunks off until the app is reloaded.
    .catch(() => { if (chunkPlanFor === base) chunkPlan = null; return 0 })
  return chunkPlan
}
// Tests start each case from a server nobody has asked yet.
export const resetChunkPlan = () => { chunkPlan = null; chunkPlanFor = null }

const cancelled = () => Object.assign(new Error(t('Upload cancelled')), { aborted: true })
const pause = ms => new Promise(r => setTimeout(r, ms))
// Worth sending again as it was: no answer at all (the phone moved between masts), an edge or a
// server that failed (5xx, Cloudflare's 52x among them), or a body that arrived cut short.
const transient = e => !e.status || e.status >= 500 || (e.status === 400 && e.data && e.data.error === 'upload interrupted')

/* A coach's demo. Against a server that takes chunks it is sent as start, chunks, finish — each
   chunk small enough to cross Cloudflare — and otherwise exactly as before, as one rawUpload.
   Either way the caller sees the same thing: a promise with .abort(), progress from 0 to 1, the
   server's `{ok, media}`, and the server's sentence (or `cutOff`) on a refusal.

   Every step may be sent twice and means the same the second time (ChunkUploadController): a
   chunk is taken only where the server is, which it says (409 + `received`) when a retry is a step
   behind, and a finish already done answers what it stored. So a transient failure of a chunk or
   of the finish is retried a few times with a short pause, each step counting its own, before the
   upload gives up — and an upload that gives up or is cancelled tells the server, which frees the
   bytes it was holding rather than leaving them for the prune. */
export function uploadExerciseMedia(exId, label, file, onProgress) {
  const query = '?ex=' + encodeURIComponent(exId) + '&label=' + encodeURIComponent(label || '')
  const cutOff = t('The upload was cut off before the server answered — it may have refused the file for being too large or not a video.')
  let current = null
  let aborted = false
  const step = (req) => { current = req; return req }
  const p = (async () => {
    const chunk = await chunkSize()
    if (aborted) throw cancelled()
    if (!chunk) return step(rawUpload('/api/media/exercise' + query, file, onProgress, cutOff))

    const start = await step(rawUpload('/api/media/exercise/upload' + query + '&size=' + file.size, null, null, cutOff))
    const id = encodeURIComponent(start.upload)
    const at = '/api/media/exercise/upload?id=' + id
    // The start's answer is the server's real chunk (post_max_size may hold it under chunk_mb).
    const each = start.chunk > 0 ? start.chunk : chunk
    try {
      let offset = 0
      while (offset < file.size) {
        if (aborted) throw cancelled()
        const from = offset
        const piece = file.slice(from, from + each)
        let tries = 0
        for (;;) {
          try {
            const r = await step(rawUpload(at + '&offset=' + from, piece,
              f => onProgress && onProgress(Math.min(1, (from + f * piece.size) / file.size)), cutOff, 'PUT'))
            offset = r.received
            break
          } catch (e) {
            if (e.aborted) throw e
            // Out of step: go on from where the server is — unless it says this very offset, which
            // no retry can change (no loop on a server that answers so).
            if (e.status === 409 && e.data && Number.isInteger(e.data.received) && e.data.received !== from) { offset = e.data.received; break }
            if (transient(e) && ++tries <= 3) { await pause(1000 * tries); if (aborted) throw cancelled(); continue }
            throw e
          }
        }
      }
      if (onProgress) onProgress(1)
      for (let tries = 0; ; ) {
        try {
          return await step(rawUpload('/api/media/exercise/upload/finish?id=' + id, null, null, cutOff))
        } catch (e) {
          if (!e.aborted && transient(e) && ++tries <= 3) { await pause(1000 * tries); if (aborted) throw cancelled(); continue }
          throw e
        }
      }
    } catch (e) {
      rawUpload(at, null, null, cutOff, 'DELETE').catch(() => {})
      throw e
    }
  })()
  p.abort = () => { aborted = true; if (current) current.abort() }
  return p
}

/* A progress photo. `d` is the check-in period it belongs to (periodStart in lib/checkins.js) and
   `pose` one of POSES in lib/photo.js — together they are the slot, and re-sending replaces it
   rather than adding a second photo of the same angle in the same week.

   `blob` is what preparePhoto() returned, not the picked File: 1600 px, JPEG, and stripped of the
   EXIF the camera wrote. Handing the original File here instead would upload the GPS with it and
   still be accepted, which is exactly why the resize lives in a function the caller has to
   await rather than in an option on this one. */
export const uploadProgressPhoto = (d, pose, blob, onProgress) => rawUpload(
  '/api/media/photo?d=' + encodeURIComponent(d) + '&pose=' + encodeURIComponent(pose),
  blob, onProgress, t('The upload was cut off before the server answered — it may have refused the file for being too large or not a photo.'))

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function toRequestOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  ;(o.allowCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function credToJSON(cred) {
  const r = cred.response
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports ? r.getTransports() : ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}
export async function passkeyRegister(name, code) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '' }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
// A coach signing themselves up (R4, Laravel only; /#/start). Same ceremony as above, but the
// account is a coach's, with no invite: the address is kept pending and the server's first mail
// is the link that confirms it, in `lang` — the account has no saved language yet.
export async function passkeyRegisterCoach(name, email, lang) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, email, coach: true, lang }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
export async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
