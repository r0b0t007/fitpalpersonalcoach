// Erasing what the AI Coach left on a phone.
//
// Deleting the feature removed every screen that could reach these, which is exactly the problem:
// a device that used the Coach still holds the user's own provider API key in the Keychain or the
// Android Keystore under `coach.apiKey`, and `opengym-coach.json` in the app data directory —
// which could hold a proposal that was still pending when the app was last open. Nothing reads
// either now, and without this nothing would ever delete them.
//
// A live API key that no software uses is still a live key, and neither of these is something its
// owner can get at any more. So this runs once, on the mobile build, and then never again.
//
// It is the reason @aparajita/capacitor-secure-storage is still a dependency: you cannot delete a
// secret without the library that can reach it. Once a release has shipped with this, both the
// plugin and this module can go — there is a note in docs/MOBILE.md.
import { MOBILE } from './mobile.js'

const DONE = 'gym_coach_secrets_cleared'
const SECRET_KEY = 'coach.apiKey'
const DEVICE_FILE = 'opengym-coach.json'

/**
 * Best-effort and completely silent. Every failure path here ends in "leave it alone and try
 * again next launch": a phone that cannot reach its own keystore this morning is not a reason to
 * show anybody an error about a feature that no longer exists, and the flag is only set once the
 * work actually succeeded, so a failed attempt does not mark itself finished.
 */
export async function forgetCoachSecrets() {
  if (!MOBILE) return
  try { if (localStorage.getItem(DONE) === '1') return } catch { return }

  let cleared = true

  // The plugin resolves lazily and has a known quirk: awaiting the module object directly calls
  // SecureStorage.then() on the native side, which is not implemented on Android. Reach for the
  // named export instead, exactly as the deleted coach-secrets.js did.
  try {
    const m = await import('@aparajita/capacitor-secure-storage')
    const store = m && m.SecureStorage
    if (store && typeof store.remove === 'function') await store.remove(SECRET_KEY)
  } catch { cleared = false }

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    await Filesystem.deleteFile({ path: DEVICE_FILE, directory: Directory.Data })
  } catch (e) {
    // "File does not exist" is the common case and a success: there is nothing to delete on a
    // phone that never ran a Coach job. Anything else is worth retrying next launch.
    if (!/not exist|not found|ENOENT/i.test(String(e && e.message))) cleared = false
  }

  if (cleared) { try { localStorage.setItem(DONE, '1') } catch { /* nothing to remember with */ } }
}
