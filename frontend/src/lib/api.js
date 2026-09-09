// Backend + WebAuthn helpers (ported from the vanilla app).
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
// Narrower than IS_APPLE (which also matches Mac desktops): true only on a touch iOS/iPadOS
// device, where "Add to Home Screen" via the Safari share sheet is the only way to install —
// there is no beforeinstallprompt API on that platform.
export const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (IS_APPLE && navigator.maxTouchPoints > 1)
export const BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
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

export async function api(path, opts) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts && opts.headers)
  if (remoteToken) headers.Authorization = 'Bearer ' + remoteToken
  const r = await fetch(remoteBase + path, Object.assign({}, opts, { headers }))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
  return data
}

// Bootstraps the connection itself: the base isn't configured yet (that's what this call decides),
// so it talks straight to the server the user typed in, no Authorization header.
export async function pairRedeem(serverBase, code) {
  const r = await fetch(serverBase + '/api/pair/redeem', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code })
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) { const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; throw e }
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

   Written once and shared by both callers below rather than copied. `noun` is only ever read on
   the one path where nothing else is known — a network failure with no response at all — and is
   there because "too large or not a video" is wrong advice to give someone sending a photo.

   Returns a promise with .abort() on it, because cancelling a 90 MB upload is not a luxury. */
function rawUpload(path, body, onProgress, noun) {
  const xhr = new XMLHttpRequest()
  const p = new Promise((resolve, reject) => {
    xhr.open('POST', remoteBase + path)
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
      // Compatible". Pass it through untouched; a generic "upload failed" throws away the only
      // thing that tells the person what to change.
      const e = new Error(data.error || ('HTTP ' + xhr.status)); e.status = xhr.status; reject(e)
    }
    // A refusal happens while the browser is still sending, and the server closes the socket to
    // get its message out. Usually the response still lands (onload above); when it does not,
    // the browser reports a bare network failure with no status. Name the two things that
    // actually cause it rather than inventing a reason, and do not overwrite a real 413/415.
    xhr.onerror = () => reject(new Error('The upload was cut off before the server answered — it may have refused the file for being too large or not a ' + noun + '.'))
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { aborted: true }))
    xhr.send(body)
  })
  p.abort = () => xhr.abort()
  return p
}

export const uploadExerciseMedia = (exId, label, file, onProgress) => rawUpload(
  '/api/media/exercise?ex=' + encodeURIComponent(exId) + '&label=' + encodeURIComponent(label || ''),
  file, onProgress, 'video')

/* A progress photo. `d` is the check-in period it belongs to (periodStart in lib/checkins.js) and
   `pose` one of POSES in lib/photo.js — together they are the slot, and re-sending replaces it
   rather than adding a second photo of the same angle in the same week.

   `blob` is what preparePhoto() returned, not the picked File: 1600 px, JPEG, and stripped of the
   EXIF the camera wrote. Handing the original File here instead would upload the GPS with it and
   still be accepted, which is exactly why the resize lives in a function the caller has to
   await rather than in an option on this one. */
export const uploadProgressPhoto = (d, pose, blob, onProgress) => rawUpload(
  '/api/media/photo?d=' + encodeURIComponent(d) + '&pose=' + encodeURIComponent(pose),
  blob, onProgress, 'photo')

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
export async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
