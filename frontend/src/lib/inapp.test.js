import { describe, it, expect } from 'vitest'
import { browserUrl, inAppBrowser, inAppName, inAppPlatform } from './inapp.js'

// Real user agents, as each app sends them.
const IG_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.40.92 (iPhone14,5; iOS 17_5; fr_FR; fr; scale=3.00; 1170x2532)'
const IG_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36 Instagram 330.0.0.40.92 Android (34/14; 480dpi; 1080x2340; samsung; SM-S918B; dm3q; qcom; fr_FR; 600218893)'
const FB_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.48.109;]'
const FB_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/460.0.0.35.108;FBBV/598830264;FBDV/iPhone14,5;FBMD/iPhone;FBSN/iOS;FBSV/17.5;FBSS/3;FBCR/;FBID/phone;FBLC/fr_FR;FBOP/5]'
const TIKTOK_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.1.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/fr Region/MA BytedanceWebview/d8a21c6'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const CHROME_ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
const CHROME_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.88 Mobile/15E148 Safari/604.1'

describe('inAppBrowser', () => {
  it('knows Instagram, Facebook and TikTok inside their apps, on both platforms', () => {
    for (const ua of [IG_IOS, IG_ANDROID, FB_ANDROID, FB_IOS, TIKTOK_IOS]) expect(inAppBrowser(ua)).toBe(true)
    expect([IG_IOS, IG_ANDROID, FB_IOS, FB_ANDROID, TIKTOK_IOS].map(inAppPlatform)).toEqual(['ios', 'android', 'ios', 'android', 'ios'])
    expect([IG_IOS, IG_ANDROID, FB_IOS, FB_ANDROID, TIKTOK_IOS].map(inAppName)).toEqual(['Instagram', 'Instagram', 'Facebook', 'Facebook', 'TikTok'])
  })

  it('leaves Safari, Chrome and the installed app alone', () => {
    for (const ua of [SAFARI, CHROME_ANDROID, CHROME_IOS, '']) {
      expect(inAppBrowser(ua)).toBe(false)
      expect(inAppPlatform(ua)).toBe(null)
    }
  })
})

describe('browserUrl', () => {
  it('opens Chrome on Android by an intent, and Safari on iOS by its scheme', () => {
    expect(browserUrl('https://coach.fitpal.ma/c/sara.fit', 'android'))
      .toBe('intent://coach.fitpal.ma/c/sara.fit#Intent;scheme=https;package=com.android.chrome;end')
    expect(browserUrl('https://coach.fitpal.ma/', 'ios')).toBe('x-safari-https://coach.fitpal.ma/')
  })

  it('makes no link it cannot make right: a #fragment, another scheme, or no platform to aim at', () => {
    expect(browserUrl('https://coach.fitpal.ma/#/join/sara.fit', 'android')).toBe(null)
    expect(browserUrl('javascript:alert(1)', 'ios')).toBe(null)
    expect(browserUrl('not a url', 'ios')).toBe(null)
    expect(browserUrl('https://coach.fitpal.ma/', 'other')).toBe(null)
  })
})
