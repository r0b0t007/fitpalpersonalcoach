// Creem sends a coach who has just paid back to the app's front door with the checkout in the
// query, before the hash (/?checkout_id=…&order_id=…&signature=…) — the same shape as an invite
// link, and the same two rules as lib/invite.js:
//
// 1. Read lazily, never at module scope: this module is imported by screens every visitor loads.
// 2. Cache it, and tidy the address bar only once the plan has actually landed (the webhook can
//    trail the redirect by a few seconds), so a reload while Today says "Setting up your plan…"
//    still knows it is waiting.
//
// The parameters are never trusted for anything: the server's licence decides what the coach may
// do. All they change is that Today shows "activating" instead of "choose a plan" while the
// webhook catches up.

// Everything Creem appends to the success URL. All of it goes once the plan is in: an order id
// and a signature have no business riding along in a copied URL or a later Referer.
const PARAMS = ['checkout_id', 'order_id', 'customer_id', 'subscription_id', 'product_id', 'request_id', 'signature']

/** How long Today waits for the webhook before giving up on "activating", and how often it asks. */
export const ACTIVATING_MS = 90_000
export const POLL_MS = 3_000

let cached = null

const readParam = () => {
  try { return (new URL(location.href).searchParams.get('checkout_id') || '').trim().slice(0, 100) }
  catch { return '' }
}

/** The checkout this page load came back from, or ''. Safe to call repeatedly; never mutates the URL. */
export function pendingCheckout() {
  if (cached === null) cached = readParam()
  return cached
}

/** Call once the plan has landed, or the wait has run out: forgets it and strips Creem's parameters. */
export function clearCheckout() {
  cached = ''
  try {
    const url = new URL(location.href)
    const had = PARAMS.filter(p => url.searchParams.has(p))
    if (!had.length) return
    had.forEach(p => url.searchParams.delete(p))
    history.replaceState(null, '', url.pathname + url.search + url.hash)
  } catch { /* the plan is in either way; only the tidy-up failed */ }
}

/** Tests only: forget what was read, so the next call reads the URL again. */
export const resetCheckoutForTest = () => { cached = null }
