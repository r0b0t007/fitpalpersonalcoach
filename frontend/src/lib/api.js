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

/* The upload cannot. api() hard-sets Content-Type: application/json and unconditionally parses
   the response, while this route wants the raw file as the ENTIRE body with its metadata in the
   query string — there is no multipart parser on the server and there is not going to be one.

   XMLHttpRequest rather than fetch for exactly one reason: fetch has no upload-progress event at
   all, and 90 MB of video with no bar is indistinguishable from a hang. That means re-doing what
   api() does — remoteBase, the Bearer token, the error unwrap — for the third time in this file,
   which is the price of remoteBase/remoteToken being module-private. They have to be: a bare
   fetch or XHR written in a view would silently hit the wrong origin and drop the token on the
   paired mobile build. pairRedeem above is the same bargain for the same reason.

   Returns a promise with .abort() on it, because cancelling a 90 MB upload is not a luxury. */
export function uploadExerciseMedia(exId, label, file, onProgress) {
  const xhr = new XMLHttpRequest()
  const p = new Promise((resolve, reject) => {
    const q = '?ex=' + encodeURIComponent(exId) + '&label=' + encodeURIComponent(label || '')
    xhr.open('POST', remoteBase + '/api/media/exercise' + q)
    if (remoteToken) xhr.setRequestHeader('Authorization', 'Bearer ' + remoteToken)
    // Advisory only — the server sniffs the first 64 bytes and believes those, not this header.
    if (file && file.type) xhr.setRequestHeader('Content-Type', file.type)
    xhr.upload.onprogress = e => { if (onProgress && e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => {
      let data = {}
      try { data = JSON.parse(xhr.responseText) } catch {}
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data)
      // The server's wording is the instruction — "use MP4 or MOV", "set the camera to Most
      // Compatible". Pass it through untouched; a generic "upload failed" throws away the only
      // thing that tells the coach what to change.
      const e = new Error(data.error || ('HTTP ' + xhr.status)); e.status = xhr.status; reject(e)
    }
    // A refusal happens while the browser is still sending, and the server closes the socket to
    // get its message out. Usually the response still lands (onload above); when it does not,
    // the browser reports a bare network failure with no status. Name the two things that
    // actually cause it rather than inventing a reason, and do not overwrite a real 413/415.
    xhr.onerror = () => reject(new Error('The upload was cut off before the server answered — it may have refused the file for being too large or not a video.'))
    xhr.onabort = () => reject(Object.assign(new Error('Upload cancelled'), { aborted: true }))
    xhr.send(file)
  })
  p.abort = () => xhr.abort()
  return p
}

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
