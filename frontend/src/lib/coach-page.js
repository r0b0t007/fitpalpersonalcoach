// A coach's public page (CHW-330): the handle in coach.fitpal.ma/c/<handle>, read and checked
// exactly as the server does (backend/app/Coaching/Handle.php) so the editor can say what is wrong
// before a round trip. The server decides; this only saves a refusal.

export const BIO_MAX = 160

/** As a coach types their Instagram name: a leading @ and capitals dropped. */
export const normaliseHandle = s => (typeof s === 'string' ? s.trim().replace(/^@+/, '').toLowerCase() : '')

export const validHandle = h => /^[a-z0-9._]{3,30}$/.test(h) && !h.startsWith('.') && !h.endsWith('.') && !h.includes('..')

/** The link for the bio. */
export const pageUrl = (handle, origin = location.origin) => `${origin}/c/${handle}`

/** The handle of a public page path (`/c/<handle>`), or null for any other path. */
export function coachHandleFromPath(pathname) {
  const m = /^\/c\/([^/]+)\/?$/.exec(pathname || '')
  return m ? normaliseHandle(decodeURIComponent(m[1])) : null
}
