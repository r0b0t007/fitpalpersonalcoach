// @vitest-environment happy-dom
//
// A profile that has never chosen a language starts in the browser's, when the app offers it.
// One that has — every saved state carries the `lang` it was written with — keeps its choice,
// English included: detection must never move somebody who picked English off it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: async () => ({}),
  IS_IOS: false, IS_ANDROID: false, IS_APPLE: false, webauthnOK: () => true,
}))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
  initReminderSync: () => {}, writeAutoBackup: () => {},
}))

// DEF and the initial S are computed when the store module loads, so each case gets a fresh one.
async function freshStore(languages) {
  vi.resetModules()
  vi.stubGlobal('navigator', { ...navigator, languages, language: languages[0] })
  return import('./useStore.js')
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('default language', () => {
  it('a fresh profile starts in the browser language', async () => {
    const { DEF, useStore } = await freshStore(['fr-FR', 'en'])
    expect(DEF.lang).toBe('fr')
    expect(useStore.getState().S.lang).toBe('fr')
  })

  it('a fresh profile in a language the app does not offer starts in English', async () => {
    const { DEF } = await freshStore(['ar-MA'])
    expect(DEF.lang).toBe('en')
  })

  it('a saved profile keeps the language it chose, English included', async () => {
    localStorage.setItem('gym_state_v1', JSON.stringify({ lang: 'en' }))
    const { useStore } = await freshStore(['es-ES'])
    expect(useStore.getState().S.lang).toBe('en')
  })
})
