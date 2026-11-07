/* Share, then clipboard: the invite link (InviteSheet) and the referral link (ReferralCard).
 *
 * Both need transient user activation, which an await can spend, and the two failures are NOT
 * alike: navigator.share rejects (NotAllowedError) but navigator.clipboard.writeText simply never
 * settles when the document is not focused. So the clipboard gets a deadline, and this never
 * rejects: what it returns tells the caller what to say.
 *   'shared' | 'cancelled' (the coach closed the share sheet: say nothing) | 'copied' | 'failed'
 */
export async function shareLink({ url, title, text }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return 'shared' }
    // AbortError is the user closing the share sheet, not a failure: falling through to the
    // clipboard would tell them something was copied when they had just said no.
    catch (e) { if (e && e.name === 'AbortError') return 'cancelled' }
  }
  try {
    await Promise.race([
      navigator.clipboard.writeText(url),
      new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard never answered')), 2000)),
    ])
    return 'copied'
  } catch { return 'failed' }
}
