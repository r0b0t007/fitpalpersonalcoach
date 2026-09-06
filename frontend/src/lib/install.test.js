// @vitest-environment happy-dom
//
// install.js holds module-scope state (the deferred prompt, the subscriber version) and reads
// the platform flags at import, so each test resets modules and re-imports — same pattern as
// wakelock.test.js.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

let install

const setMatchMedia = matches =>
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches }), configurable: true, writable: true })
const setNavigatorProp = (name, value) =>
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true })

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  setMatchMedia(false)
  delete navigator.standalone
  delete navigator.userAgent
  install = await import('./install.js')
})

function fakeBeforeInstallPrompt(outcome = 'accepted') {
  const e = new Event('beforeinstallprompt', { cancelable: true })
  e.prompt = vi.fn(async () => {})
  e.userChoice = Promise.resolve({ outcome })
  return e
}

describe('isStandalone / alreadyInstalled', () => {
  it('is false by default', () => {
    expect(install.isStandalone()).toBe(false)
    expect(install.alreadyInstalled()).toBe(false)
  })
  it('is true when the display-mode media query matches', () => {
    setMatchMedia(true)
    expect(install.isStandalone()).toBe(true)
    expect(install.alreadyInstalled()).toBe(true)
  })
  it('is true via navigator.standalone (iOS Safari)', () => {
    setNavigatorProp('standalone', true)
    expect(install.isStandalone()).toBe(true)
  })
  it('alreadyInstalled() is true once marked installed, even in a plain browser tab', () => {
    install.markInstalled()
    expect(install.isStandalone()).toBe(false)
    expect(install.alreadyInstalled()).toBe(true)
  })
})

describe('shouldOfferInstall / snooze', () => {
  it('is true with a clean slate', () => {
    expect(install.shouldOfferInstall()).toBe(true)
  })
  it('is false once standalone', () => {
    setMatchMedia(true)
    expect(install.shouldOfferInstall()).toBe(false)
  })
  it('is false right after snoozing, true again once the snooze expires', () => {
    install.snoozeInstall()
    expect(install.shouldOfferInstall()).toBe(false)
    localStorage.setItem(install.INSTALL_SNOOZED, String(Date.now() - install.SNOOZE_MS - 1000))
    expect(install.shouldOfferInstall()).toBe(true)
  })
  it('treats a malformed snooze value as not snoozed', () => {
    localStorage.setItem(install.INSTALL_SNOOZED, 'not-a-number')
    expect(install.shouldOfferInstall()).toBe(true)
  })
  it('treats a future-dated snooze (clock was ahead) as not snoozed', () => {
    localStorage.setItem(install.INSTALL_SNOOZED, String(Date.now() + 365 * 24 * 3600 * 1000))
    expect(install.shouldOfferInstall()).toBe(true)
  })
  it('is false once installed, unaffected by the snooze window', () => {
    install.markInstalled()
    expect(install.isInstalled()).toBe(true)
    expect(install.shouldOfferInstall()).toBe(false)
    localStorage.setItem(install.INSTALL_SNOOZED, String(Date.now() - install.SNOOZE_MS - 1000))
    expect(install.shouldOfferInstall()).toBe(false)
  })
})

describe('beforeinstallprompt capture', () => {
  it('captures the event (preventDefault called) and canPrompt() becomes true', () => {
    install.initInstall()
    expect(install.canPrompt()).toBe(false)
    const e = fakeBeforeInstallPrompt()
    const spy = vi.spyOn(e, 'preventDefault')
    window.dispatchEvent(e)
    expect(spy).toHaveBeenCalled()
    expect(install.canPrompt()).toBe(true)
  })

  it('is idempotent — calling initInstall() twice attaches one listener', () => {
    const spy = vi.spyOn(window, 'addEventListener')
    install.initInstall()
    install.initInstall()
    expect(spy.mock.calls.filter(c => c[0] === 'beforeinstallprompt').length).toBe(1)
  })

  it('a fresh event clears the installed mark — it only fires while NOT installed', () => {
    install.initInstall()
    install.markInstalled()
    expect(install.shouldOfferInstall()).toBe(false)
    window.dispatchEvent(fakeBeforeInstallPrompt())
    expect(install.isInstalled()).toBe(false)
    expect(install.shouldOfferInstall()).toBe(true)
    expect(install.installPath()).toBe('prompt')
  })

  it('appinstalled marks installed and clears the deferred event', () => {
    install.initInstall()
    window.dispatchEvent(fakeBeforeInstallPrompt())
    expect(install.canPrompt()).toBe(true)
    window.dispatchEvent(new Event('appinstalled'))
    expect(install.canPrompt()).toBe(false)
    expect(install.isInstalled()).toBe(true)
    expect(install.shouldOfferInstall()).toBe(false)
  })
})

describe('promptInstall', () => {
  it('returns "unavailable" when nothing was captured', async () => {
    install.initInstall()
    expect(await install.promptInstall()).toBe('unavailable')
  })

  it('awaits prompt(), returns the outcome, and marks installed on "accepted"', async () => {
    install.initInstall()
    const e = fakeBeforeInstallPrompt('accepted')
    window.dispatchEvent(e)
    expect(await install.promptInstall()).toBe('accepted')
    expect(e.prompt).toHaveBeenCalled()
    expect(install.canPrompt()).toBe(false)
    expect(install.isInstalled()).toBe(true)
    expect(install.shouldOfferInstall()).toBe(false)
  })

  it('snoozes (not installs) on a native "dismissed" so the card is not back next load', async () => {
    install.initInstall()
    window.dispatchEvent(fakeBeforeInstallPrompt('dismissed'))
    expect(await install.promptInstall()).toBe('dismissed')
    expect(install.isInstalled()).toBe(false)
    expect(install.installSnoozed()).toBe(true)
    expect(install.shouldOfferInstall()).toBe(false)
  })

  it('propagates a prompt() rejection to the caller and still clears the spent event', async () => {
    install.initInstall()
    const e = fakeBeforeInstallPrompt()
    e.prompt = vi.fn(async () => { throw new Error('NotAllowedError') })
    window.dispatchEvent(e)
    await expect(install.promptInstall()).rejects.toThrow('NotAllowedError')
    expect(install.canPrompt()).toBe(false)
    expect(install.isInstalled()).toBe(false)
  })
})

// installPath() reads IS_ANDROID / IS_IOS from api.js at import, so each platform re-mocks it
// and re-imports; the UA sniff for Chrome-on-Android reads navigator.userAgent at import too.
describe('installPath by platform', () => {
  afterEach(() => { vi.doUnmock('./api.js') })

  const onPlatform = async ({ ios = false, android = false, ua = 'Mozilla/5.0' } = {}) => {
    vi.doMock('./api.js', () => ({ IS_IOS: ios, IS_ANDROID: android }))
    setNavigatorProp('userAgent', ua)
    vi.resetModules()
    install = await import('./install.js')
  }

  it('is null on a desktop browser with no captured prompt', async () => {
    await onPlatform()
    expect(install.installPath()).toBe(null)
  })

  it('is "prompt" wherever an event was captured, whatever the platform', async () => {
    await onPlatform({ ua: 'Mozilla/5.0 (X11; Linux) Chrome/120.0 Safari/537.36' })
    install.initInstall()
    window.dispatchEvent(fakeBeforeInstallPrompt())
    expect(install.installPath()).toBe('prompt')
  })

  it('is "ios" in Safari (navigator.standalone defined) and null in an iOS WebView', async () => {
    await onPlatform({ ios: true })
    setNavigatorProp('standalone', false)
    expect(install.installPath()).toBe('ios')
    expect(install.manualInstallHint('ios')).toBe('In Safari: Share → Add to Home Screen')
    delete navigator.standalone
    expect(install.installPath()).toBe(null)
  })

  it('is "android" in Chrome on Android, but null in Firefox / Samsung Internet there', async () => {
    await onPlatform({ android: true, ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36' })
    expect(install.installPath()).toBe('android')
    expect(install.manualInstallHint('android')).toBe('In Chrome: ⋮ menu → Add to Home screen')
    await onPlatform({ android: true, ua: 'Mozilla/5.0 (Android 14; Mobile) Gecko/120.0 Firefox/120.0' })
    expect(install.installPath()).toBe(null)
    await onPlatform({ android: true, ua: 'Mozilla/5.0 (Linux; Android 14) SamsungBrowser/23.0 Chrome/115.0 Mobile Safari/537.36' })
    expect(install.installPath()).toBe(null)
  })
})
