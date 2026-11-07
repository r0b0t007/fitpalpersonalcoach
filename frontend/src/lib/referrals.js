import { serverBase } from './api.js'
// Coach referrals (CHW-350): the link a coach shares. On the production app it goes to fitpal.ma's
// home, whose site.js carries the ref on to the sign-up. Anywhere else (staging, a self-hosted
// instance, localhost, the paired mobile build) the marketing site is not that instance's, so the
// link is its own sign-up, built from where it is served as invite.js's inviteLink is. Either way
// the server checks the ref (App\Coaching\Referrals).
const PRODUCTION_HOST = 'coach.fitpal.ma'

export function referralLink(handle) {
  const ref = encodeURIComponent(handle)
  try {
    const base = serverBase()
    const url = new URL(base || location.href, location.href)
    if (url.hostname === PRODUCTION_HOST) return 'https://fitpal.ma/?ref=' + ref
    url.search = ''
    if (base && !url.pathname.endsWith('/')) url.pathname += '/'
    url.hash = '/start?plan=free&ref=' + ref
    return url.toString()
  } catch {
    return 'https://fitpal.ma/?ref=' + ref
  }
}
