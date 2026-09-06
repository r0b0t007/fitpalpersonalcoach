// @vitest-environment happy-dom
//
// install.js holds module-scope state (the deferred prompt, the subscriber version), so each
// test resets modules and re-imports — same pattern as wakelock.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest'

let install

const setMatchMedia = matches =>
  Object.defineProperty(window, 'matchMedia', { value: () => ({ matches }), configurable: true, writable: true })

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  setMatchMedia(false)
  delete navigator.standalone
  install = await import('./install.js')
})

describe('isStandalone', () => {
  it('is false by default', () => {
    expect(install.isStandalone()).toBe(false)
  })
  it('is true when the display-mode media query matches', () => {
    setMatchMedia(true)
    expect(install.isStandalone()).toBe(true)
  })
  it('is true via navigator.standalone (iOS Safari)', () => {
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    expect(install.isStandalone()).toBe(true)
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
})

function fakeBeforeInstallPrompt(outcome = 'accepted') {
  const e = new Event('beforeinstallprompt', { cancelable: true })
  e.prompt = vi.fn(async () => {})
  e.userChoice = Promise.resolve({ outcome })
  return e
}

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

  it('promptInstall() fires the captured event, returns its outcome, then clears it', async () => {
    install.initInstall()
    const e = fakeBeforeInstallPrompt('accepted')
    window.dispatchEvent(e)
    const outcome = await install.promptInstall()
    expect(outcome).toBe('accepted')
    expect(e.prompt).toHaveBeenCalled()
    expect(install.canPrompt()).toBe(false)
  })

  it('promptInstall() returns "unavailable" when nothing was captured', async () => {
    install.initInstall()
    expect(await install.promptInstall()).toBe('unavailable')
  })

  it('appinstalled snoozes and clears the deferred event', () => {
    install.initInstall()
    window.dispatchEvent(fakeBeforeInstallPrompt())
    expect(install.canPrompt()).toBe(true)
    window.dispatchEvent(new Event('appinstalled'))
    expect(install.canPrompt()).toBe(false)
    expect(install.shouldOfferInstall()).toBe(false)
  })
})
