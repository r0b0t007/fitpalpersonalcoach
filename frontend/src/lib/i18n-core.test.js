// i18n-core is plain Node-loadable (see its header comment) and holds process-wide state, so
// each test gets a fresh module — same pattern as wakelock.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest'

let DEFAULT_LANG, getLang, t, _setLangState

beforeEach(async () => {
  vi.resetModules()
  ;({ DEFAULT_LANG, getLang, t, _setLangState } = await import('./i18n-core.js'))
})

describe('i18n-core default language', () => {
  it('defaults to English with no browser-language detection', () => {
    expect(DEFAULT_LANG).toBe('en')
    expect(getLang()).toBe('en')
  })

  it('falls back to English for an unsupported/unknown code', () => {
    _setLangState('xx', { Hello: 'Bonjour' })
    expect(getLang()).toBe('en')
    // English has no pack (dict === {}), so an unrecognised code's dict is discarded too —
    // otherwise a stray translation could leak through under the 'en' state.
    expect(t('Hello')).toBe('Hello')
  })

  it('switches to a supported language and back to English', () => {
    _setLangState('fr', { Settings: 'Réglages' })
    expect(getLang()).toBe('fr')
    expect(t('Settings')).toBe('Réglages')

    _setLangState('en')
    expect(getLang()).toBe('en')
    expect(t('Settings')).toBe('Settings')
  })

  it('t() falls back to the English source string, with {n} substitution, when a key is missing', () => {
    _setLangState('fr', {})
    expect(t('Hi {0}', 'Sam')).toBe('Hi Sam')
  })
})
