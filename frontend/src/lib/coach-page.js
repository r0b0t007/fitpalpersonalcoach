// A coach's public page (CHW-330): the handle in coach.fitpal.ma/c/<handle>, read and checked
// exactly as the server does (backend/app/Coaching/Handle.php) so the editor can say what is wrong
// before a round trip. The server decides; this only saves a refusal.

export const BIO_MAX = 160

/** As a coach types their Instagram name: a leading @ and capitals dropped. */
export const normaliseHandle = s => (typeof s === 'string' ? s.trim().replace(/^@+/, '').toLowerCase() : '')

export const validHandle = h => /^[a-z0-9._]{3,30}$/.test(h) && !h.startsWith('.') && !h.endsWith('.') && !h.includes('..')

/**
 * The handle of a public page path (`/c/<handle>`), or null for any other path. Read during the
 * shell's render, outside any error boundary: a mangled link (`/c/50%`) must give null, never throw.
 */
export function coachHandleFromPath(pathname) {
  const m = /^\/c\/([^/]+)\/?$/.exec(pathname || '')
  if (!m) return null
  try { return normaliseHandle(decodeURIComponent(m[1])) } catch { return null }
}
