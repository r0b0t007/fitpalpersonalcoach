// The per-language exercise packs — instructions (src/instr/) and names (src/exercise-names/) —
// against the catalogue they translate. A missing id is silent in the app: the English falls
// through for that one exercise, mid-list. An extra id is a renamed or deleted exercise whose
// translation now matches nothing. Neither fails anywhere else, so it fails here.
import { describe, it, expect, afterAll } from 'vitest'
import { readdirSync } from 'node:fs'
import { EXDB } from './exercises-data.js'
import { EXIDX, matchExercise } from './exercises.js'
import { INSTR_LANGS, EXERCISE_NAME_LANGS, exerciseNameFor, localExerciseName, _setLangState } from './i18n-core.js'

const ids = EXDB.map(e => e.id).sort()
const byId = Object.fromEntries(EXDB.map(e => [e.id, e]))
const filesIn = dir => readdirSync(new URL(`../${dir}/`, import.meta.url)).filter(f => f.endsWith('.js')).map(f => f.slice(0, -3)).sort()
const load = async (dir, lang) => (await import(`../${dir}/${lang}.js`)).default

describe('exercise name packs', () => {
  // Every switched-on language has one. A file for a language that is not switched on is
  // never loaded, and is allowed: upstream ships pt-BR and hu packs, and merging them back must
  // not fail CI here.
  it('exist for every language that is switched on', () => {
    expect(filesIn('exercise-names')).toEqual(expect.arrayContaining(EXERCISE_NAME_LANGS))
  })

  for (const lang of EXERCISE_NAME_LANGS) {
    it(`${lang}: every catalogue exercise, nothing else, no blanks`, async () => {
      const pack = await load('exercise-names', lang)
      expect(Object.keys(pack).sort()).toEqual(ids)
      const blank = Object.entries(pack).filter(([, n]) => typeof n !== 'string' || !n.trim() || n !== n.trim())
      expect(blank).toEqual([])
    })
  }
})

describe('search and display with a name pack on', () => {
  // Clients copy names from programs and videos, which may be in either language, so search
  // has to find both; the display keeps the English beside the translation for the same reason.
  afterAll(() => _setLangState('en'))

  it('finds the back squat by "squat" and by "sentadilla" in Spanish, accents optional', async () => {
    _setLangState('es', {}, null, await load('exercise-names', 'es'))
    const squat = EXIDX['0043']
    for (const q of ['sentadilla', 'squat', 'barbell full squat', 'sentadilla completa barra']) expect(matchExercise(squat, q)).toBe(true)
    expect(exerciseNameFor(squat)).toBe('sentadilla completa con barra (barbell full squat)')
  })

  it('in French, finds a press by its French name without the accents', async () => {
    _setLangState('fr', {}, null, await load('exercise-names', 'fr'))
    const bench = Object.values(EXIDX).find(e => e.n === 'barbell bench press')
    expect(matchExercise(bench, 'developpe couche')).toBe(true)
    expect(matchExercise(bench, 'bench press')).toBe(true)
  })

  it('does not put brackets inside brackets', async () => {
    _setLangState('fr', {}, null, await load('exercise-names', 'fr'))
    const ball = EXIDX['0655']
    expect(ball.n).toContain('(')
    expect(exerciseNameFor(ball)).toBe(`${localExerciseName(ball)} — ${ball.n}`)
  })

  it('leaves a custom exercise exactly as it was typed', async () => {
    _setLangState('fr', {}, null, await load('exercise-names', 'fr'))
    expect(exerciseNameFor({ id: 'c_mine', n: 'Mon squat maison', custom: true })).toBe('Mon squat maison')
  })
})

describe('instruction packs', () => {
  const langs = INSTR_LANGS.filter(l => l !== 'en')
  it('exist for every language that is switched on', () => {
    expect(filesIn('instr')).toEqual(expect.arrayContaining(langs))
  })

  for (const lang of langs) {
    it(`${lang}: every catalogue exercise, nothing else, as many steps as English`, async () => {
      const pack = await load('instr', lang)
      expect(Object.keys(pack).sort()).toEqual(ids)
      const off = Object.entries(pack).filter(([id, steps]) =>
        !Array.isArray(steps) || steps.some(s => !String(s).trim()) || steps.length !== (byId[id].st || []).length)
      expect(off.map(([id]) => id)).toEqual([])
    })
  }
})
