// An invite arrives as a link (?invite=CODE) rather than sixteen characters to retype.
//
// Two rules, both learned the hard way:
//
// 1. Read lazily, never at module scope. Login.jsx is a static import, so module-level work runs
//    for every visitor — including signed-in users and guests, who never render that screen.
//    Doing the URL clean-up there destroyed the invite for anyone already logged in.
//
// 2. Cache the code, and clear the URL only once it has actually been redeemed. Sheets are
//    dismissible by swipe, backdrop and Android back, so stripping the parameter when the sheet
//    OPENS meant an invitee who swiped it away to read the page first lost the code from the
//    address bar and from React state at once — with nothing to retype, since all they were given
//    was a link. The cache survives that; the address bar is tidied on success.
let cached = null

const readParam = () => {
  try { return (new URL(location.href).searchParams.get('invite') || '').trim().toUpperCase().slice(0, 40) }
  catch { return '' }
}

/** The pending invite code, if any. Safe to call repeatedly; never mutates the URL. */
export function pendingInvite() {
  if (cached === null) cached = readParam()
  return cached
}

/**
 * Call after a registration actually succeeds. Drops the code from memory and from the address
 * bar, so a shared screenshot or a copied URL stops carrying a live credential — and so it no
 * longer rides along in the Referer of every later same-origin request.
 */
export function clearInvite() {
  cached = ''
  try {
    const url = new URL(location.href)
    if (!url.searchParams.has('invite')) return
    url.searchParams.delete('invite')
    history.replaceState(null, '', url.pathname + url.search + url.hash)
  } catch { /* the registration still worked; only the tidy-up failed */ }
}

/**
 * The link a coach sends. Built from where the app is actually being served rather than from a
 * configured origin, so it is right on coach.fitpal.ma, on a self-hosted instance and on localhost
 * without anyone setting a variable — and so a coach who is signed in somewhere unusual cannot
 * hand out a link that points at somewhere else.
 *
 * The hash is dropped deliberately. The coach is somewhere inside the app when they tap Share
 * (#/clients, say), and carrying that along would send a brand-new visitor to a coach's screen
 * before bouncing them. The invite belongs to the app's front door.
 */
export function inviteLink(code) {
  const c = String(code || '').trim().toUpperCase()
  try {
    const url = new URL(location.href)
    url.hash = ''
    url.search = ''
    url.searchParams.set('invite', c)
    return url.toString()
  } catch {
    return '?invite=' + encodeURIComponent(c)
  }
}
