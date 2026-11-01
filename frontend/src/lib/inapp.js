// In-app browsers: Instagram's, Facebook's, TikTok's… a webview inside another app, where passkeys
// fail, there is no install, and a tapped link opens a different browser with its own cookies
// (CHW-331). Read from the user agent, the only thing that says so. CHW-332: the way out, offered
// (components/OpenInBrowser.jsx), never required where the email code works.

/** Each app whose browser this can be, and how its user agent says so: the one list of them. */
const APPS = [
  { name: 'Instagram', re: /Instagram/ },
  { name: 'Facebook', re: /FBAN|FBAV|FB_IAB|FBIOS/ },
  { name: 'TikTok', re: /musical_ly|BytedanceWebview|TikTok/ },
  { name: 'Snapchat', re: /Snapchat/ },
  { name: 'LINE', re: /\bLine\// },
]

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent)

const appOf = agent => APPS.find(a => a.re.test(agent || ''))

export const inAppBrowser = (agent = ua()) => !!appOf(agent)

/** Which app's browser this is, to name it, or null. */
export const inAppName = (agent = ua()) => appOf(agent)?.name ?? null

/**
 * 'ios' | 'android' | 'other' inside an in-app browser; null in a real one. iOS as lib/api.js's
 * IS_IOS reads it, an iPad that says "Macintosh" included, for the live user agent.
 */
export function inAppPlatform(agent = ua()) {
  if (!inAppBrowser(agent)) return null
  if (/Android/.test(agent)) return 'android'
  const ipadAsMac = agent === ua() && /Macintosh/.test(agent) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1
  if (/iPhone|iPad|iPod/.test(agent) || ipadAsMac) return 'ios'
  return 'other'
}

/**
 * A link that leaves the in-app browser for the phone's own: an Android intent for Chrome, which
 * falls back to the page itself where Chrome is missing or off; Safari by its x-safari- scheme
 * (iOS 17 and later; older ones ignore it, hence the menu steps beside the button). `url` must
 * have no #fragment: an intent's own ends in "#Intent;", so the app's #/ route cannot ride along,
 * which is why callers pass a server path (/c/<handle>, its ?join=1, or the page's own).
 */
export function browserUrl(url, platform) {
  let u
  try { u = new URL(url) } catch { return null }
  if (u.hash || !/^https?:$/.test(u.protocol)) return null
  if (platform === 'android') {
    return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(u.href)};end`
  }
  if (platform === 'ios') return 'x-safari-' + u.href
  return null
}
