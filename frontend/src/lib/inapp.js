// In-app browsers: Instagram's, Facebook's, TikTok's… a webview inside another app, where passkeys
// fail, there is no install, and a tapped link opens a different browser with its own cookies
// (CHW-331). Read from the user agent, the only thing that says so. CHW-332: the way out, offered
// (components/OpenInBrowser.jsx), never required: the email code works in here too.
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|musical_ly|BytedanceWebview|TikTok|Snapchat|\bLine\//

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent)

export const inAppBrowser = (agent = ua()) => IN_APP.test(agent || '')

/** 'ios' | 'android' | 'other' inside an in-app browser; null in a real one. */
export function inAppPlatform(agent = ua()) {
  if (!inAppBrowser(agent)) return null
  if (/Android/.test(agent)) return 'android'
  if (/iPhone|iPad|iPod/.test(agent)) return 'ios'
  return 'other'
}

/** Which app's browser this is, to name it: 'Instagram' | 'Facebook' | 'TikTok', or null. */
export function inAppName(agent = ua()) {
  if (/Instagram/.test(agent)) return 'Instagram'
  if (/FBAN|FBAV|FB_IAB|FBIOS/.test(agent)) return 'Facebook'
  if (/musical_ly|BytedanceWebview|TikTok/.test(agent)) return 'TikTok'
  return null
}

/**
 * A link that leaves the in-app browser for the phone's own: Chrome by an Android intent, Safari
 * by its x-safari- scheme (iOS 17 and later; older ones ignore it, hence the menu steps beside
 * the button). `url` must have no #fragment: an intent's own ends in "#Intent;", so the app's
 * #/ route cannot ride along, which is why callers pass the public /c/<handle> path or the root.
 */
export function browserUrl(url, platform) {
  let u
  try { u = new URL(url) } catch { return null }
  if (u.hash || !/^https?:$/.test(u.protocol)) return null
  if (platform === 'android') return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};package=com.android.chrome;end`
  if (platform === 'ios') return 'x-safari-' + u.href
  return null
}
