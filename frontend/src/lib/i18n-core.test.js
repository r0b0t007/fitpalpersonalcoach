// i18n-core is plain Node-loadable (see its header comment) and holds process-wide state, so
// each test gets a fresh module — same pattern as wakelock.test.js.
import { describe, it, expect, beforeEach, vi } from 'vitest'

let DEFAULT_LANG, getLang, t, tp, pickLang, _setLangState

beforeEach(async () => {
  vi.resetModules()
  ;({ DEFAULT_LANG, getLang, t, tp, pickLang, _setLangState } = await import('./i18n-core.js'))
})

describe('i18n-core default language', () => {
  it('the module starts in English until setLang runs', () => {
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

  it('t() inserts user text as-is, $ patterns included', () => {
    expect(t('Nobody matches “{0}”.', 'a$&b')).toBe('Nobody matches “a$&b”.')
    expect(t('training now · {0}', 'Legs $$ day')).toBe('training now · Legs $$ day')
    expect(t('{0}', "x$`y$'z")).toBe("x$`y$'z")
  })

  it('t() fills every placeholder in one pass, so a value containing "{1}" stays as typed', () => {
    expect(t('{0} already has {1} programs waiting', 'Marie {1}', 3)).toBe('Marie {1} already has 3 programs waiting')
    expect(t('{0} and {1}', 'a')).toBe('a and {1}')   // a placeholder with no value is left visible
  })
})

describe('pickLang', () => {
  it('matches on the base code of the first offered language', () => {
    expect(pickLang(['fr-CA', 'en-US'])).toBe('fr')
    expect(pickLang(['es-419'])).toBe('es')
    expect(pickLang(['DE-de'])).toBe('de')
  })

  it('reads underscore tags, which some Android WebViews report', () => {
    expect(pickLang(['fr_FR'])).toBe('fr')
  })

  it('skips languages the app does not offer instead of giving up on the list', () => {
    expect(pickLang(['ar-MA', 'fr-FR'])).toBe('fr')
  })

  it('takes English when it comes first, even with a translated language after it', () => {
    expect(pickLang(['en-GB', 'fr-FR'])).toBe('en')
  })

  it('falls back to English for nothing offered or nothing given', () => {
    expect(pickLang(['ar-MA', 'zh-CN'])).toBe('en')
    expect(pickLang([])).toBe('en')
    expect(pickLang(undefined)).toBe('en')
  })
})

describe('tp', () => {
  const one = '{0} session', other = '{0} sessions'

  it('follows English rules in English: only 1 is singular', () => {
    expect(tp(0, one, other)).toBe('0 sessions')
    expect(tp(1, one, other)).toBe('1 session')
    expect(tp(2, one, other)).toBe('2 sessions')
  })

  it('follows French rules in French: 0 is singular too', () => {
    _setLangState('fr', { [one]: '{0} séance', [other]: '{0} séances' })
    expect(tp(0, one, other)).toBe('0 séance')
    expect(tp(1, one, other)).toBe('1 séance')
    expect(tp(2, one, other)).toBe('2 séances')
  })

  it('follows Spanish rules in Spanish: 0 is plural', () => {
    _setLangState('es', { [one]: '{0} sesión', [other]: '{0} sesiones' })
    expect(tp(0, one, other)).toBe('0 sesiones')
    expect(tp(1, one, other)).toBe('1 sesión')
  })

  it('passes further args through as {1}, {2}…', () => {
    expect(tp(3, '{0} set of {1}', '{0} sets of {1}', 'Squat')).toBe('3 sets of Squat')
  })
})
