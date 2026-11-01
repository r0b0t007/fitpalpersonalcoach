// In-app browsers: Instagram's, Facebook's, TikTok's… a webview inside another app, where passkeys
// fail and a tapped link opens a different browser with its own cookies (CHW-331; CHW-332 builds
// the "open in your browser" nudge on this). Read from the user agent, the only thing that says so.
const IN_APP = /Instagram|FBAN|FBAV|FB_IAB|FBIOS|musical_ly|BytedanceWebview|TikTok|Snapchat|\bLine\//

export const inAppBrowser = (ua = typeof navigator === 'undefined' ? '' : navigator.userAgent) => IN_APP.test(ua || '')
