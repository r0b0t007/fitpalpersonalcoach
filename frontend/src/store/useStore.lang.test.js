// @vitest-environment happy-dom
//
// A fresh profile — nothing in localStorage, no browser-language detection anywhere in the
// app — must open in English. This locks DEF.lang to the single shared DEFAULT_LANG constant
// (see lib/i18n-core.js) so the two can't drift apart again.
import { describe, it, expect, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: async () => ({}) }))
vi.mock('../lib/mobile.js', () => ({
  MOBILE: false, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {}
}))

const { DEF } = await import('./useStore.js')
const { DEFAULT_LANG } = await import('../lib/i18n-core.js')

describe('default language', () => {
  it('a fresh profile defaults to DEFAULT_LANG (English)', () => {
    expect(DEF.lang).toBe(DEFAULT_LANG)
    expect(DEFAULT_LANG).toBe('en')
  })
})
