// setLang in two halves (CHW-211): it resolves once the UI strings are in — main.jsx mounts on that
// — and the exercise instruction and name packs land after, in the background. Real packs, through
// Vite's import.meta.glob, which vitest runs too.
import { describe, it, expect, beforeEach, vi } from 'vitest'

let i18n, core
beforeEach(async () => {
  vi.resetModules()
  core = await import('./i18n-core.js')
  i18n = await import('./i18n.js')
})

const squat = { id: '0043', n: 'barbell full squat', st: ['Stand with your feet shoulder-width apart.'] }

describe('setLang', () => {
  it('resolves with the UI strings in place, and the exercise text follows without another call', async () => {
    await i18n.setLang('fr')
    expect(core.getLang()).toBe('fr')
    expect(core.t('Settings')).toBe('Réglages')
    await i18n.exercisePacksReady()
    expect(core.exerciseNameFor(squat)).toBe('squat complet à la barre (barbell full squat)')
    expect(core.instrFor(squat)[0]).not.toBe(squat.st[0])   // French steps, not the English fallback
  })

  it('re-renders subscribers when the exercise packs land: the version moves twice', async () => {
    const v0 = core.getVersion()
    await i18n.setLang('es')
    const afterUi = core.getVersion()
    expect(afterUi).toBe(v0 + 1)
    await i18n.exercisePacksReady()
    expect(core.getVersion()).toBe(afterUi + 1)
  })

  it('a quick switch is not overwritten by the slower packs of the language just left', async () => {
    const first = i18n.setLang('fr')
    const second = i18n.setLang('es')
    await Promise.all([first, second])
    await i18n.exercisePacksReady()
    expect(core.getLang()).toBe('es')
    expect(core.exerciseNameFor(squat)).toBe('sentadilla completa con barra (barbell full squat)')
    expect(core.t('Settings')).toBe('Ajustes')
  })

  it('English loads nothing and leaves the English fallbacks', async () => {
    await i18n.setLang('fr')
    await i18n.exercisePacksReady()
    await i18n.setLang('en')
    await i18n.exercisePacksReady()
    expect(core.getLang()).toBe('en')
    expect(core.exerciseNameFor(squat)).toBe('barbell full squat')
    expect(core.instrFor(squat)).toEqual(squat.st)
  })
})
