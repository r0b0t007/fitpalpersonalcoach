// fmtMB is the one place a byte count becomes words — the coach's demo list and the app-update
// download both use it, so a French coach reads the same size, the same way, on both screens.
import { describe, it, expect, afterEach } from 'vitest'
import { fmtMB } from './format.js'
import { _setLangState } from './i18n-core.js'

describe('fmtMB', () => {
  afterEach(() => _setLangState('en'))

  it('one decimal under 10 MB, whole numbers above, binary megabytes', () => {
    expect(fmtMB(1.5 * 1048576)).toBe('1.5 MB')
    expect(fmtMB(42 * 1048576 + 300000)).toBe('42 MB')
  })

  it('uses the language’s decimal separator and unit', async () => {
    _setLangState('fr', (await import('../locales/fr.js')).default)
    expect(fmtMB(1.5 * 1048576)).toBe('1,5 Mo')
  })
})
