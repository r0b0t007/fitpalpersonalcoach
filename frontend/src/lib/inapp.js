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
const touchPoints = () => (typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints || 0)

/** A touch iPhone or iPad, one that says "Macintosh" included: lib/api.js's IS_IOS is this. */
export const isIosAgent = (agent, touch) => /iPhone|iPad|iPod/.test(agent) || (/Macintosh/.test(agent) && touch > 1)

/**
 * The in-app browser this is: {name, platform} with platform 'ios' | 'android' | 'other', or null
 * in a real browser. One read of the user agent for both.
 */
export function inApp(agent = ua(), touch = touchPoints()) {
  const app = APPS.find(a => a.re.test(agent || ''))
  if (!app) return null
  const platform = /Android/.test(agent) ? 'android' : isIosAgent(agent, touch) ? 'ios' : 'other'
  return { name: app.name, platform }
}

export const inAppBrowser = (agent = ua()) => inApp(agent) !== null

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
