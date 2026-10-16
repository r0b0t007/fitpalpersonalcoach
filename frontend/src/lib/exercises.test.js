import { describe, it, expect } from 'vitest'
import { matchExercise, normalizeStr, resolveMedia, searchScore, allExercises, CATALOGUE } from './exercises.js'
import { _setLangState } from './i18n-core.js'

describe('normalizeStr', () => {
  it('handles null, undefined and empty strings', () => {
    expect(normalizeStr(null)).toBe('')
    expect(normalizeStr(undefined)).toBe('')
    expect(normalizeStr('')).toBe('')
  })

  it('lowercases text and removes diacritics / accents', () => {
    expect(normalizeStr('Elevação Lateral')).toBe('elevacao lateral')
    expect(normalizeStr('SUPINO INCLINADO COM HALTERES')).toBe('supino inclinado com halteres')
    expect(normalizeStr('Tríceps & Panturrilhas')).toBe('triceps & panturrilhas')
    expect(normalizeStr('Quadríceps / Glúteos')).toBe('quadriceps / gluteos')
  })
})

describe('matchExercise', () => {
  const benchPress = {
    id: '0025',
    n: 'barbell bench press',
    bp: 'chest',
    tg: 'pectorals',
    eq: 'barbell',
    sm: ['triceps', 'deltoids'],
    desc: 'Classic chest exercise using a barbell on a flat bench.'
  }

  const lateralRaise = {
    id: '0283',
    n: 'dumbbell lateral raise',
    bp: 'shoulders',
    tg: 'delts',
    eq: 'dumbbell',
    sm: ['traps'],
    desc: 'Shoulder isolation movement.'
  }

  it('returns true for empty or whitespace-only query', () => {
    expect(matchExercise(benchPress, '')).toBe(true)
    expect(matchExercise(benchPress, '   ')).toBe(true)
    expect(matchExercise(benchPress, null)).toBe(true)
  })

  it('matches exact and partial words in exercise name regardless of case', () => {
    expect(matchExercise(benchPress, 'bench')).toBe(true)
    expect(matchExercise(benchPress, 'BENCH')).toBe(true)
    expect(matchExercise(benchPress, 'barbell')).toBe(true)
    expect(matchExercise(benchPress, 'press')).toBe(true)
    expect(matchExercise(benchPress, 'squat')).toBe(false)
  })

  it('matches multiple tokens in ANY order (not just sequential)', () => {
    // "bench barbell" is reversed order compared to "barbell bench press"
    expect(matchExercise(benchPress, 'bench barbell')).toBe(true)
    expect(matchExercise(benchPress, 'press bench barbell')).toBe(true)
    expect(matchExercise(benchPress, 'barbell press chest')).toBe(true)
    expect(matchExercise(benchPress, 'bench squat')).toBe(false)
  })

  it('matches target muscle, equipment, secondary muscles and description', () => {
    expect(matchExercise(benchPress, 'pectorals')).toBe(true)
    expect(matchExercise(benchPress, 'triceps barbell')).toBe(true)
    expect(matchExercise(benchPress, 'flat bench')).toBe(true)
    expect(matchExercise(lateralRaise, 'dumbbell shoulder')).toBe(true)
  })

  it('matches accent-insensitively', () => {
    const customEx = {
      id: 'custom-1',
      n: 'Elevação de Panturrilha',
      bp: 'lower legs',
      tg: 'calves',
      eq: 'body weight',
      desc: 'Exercício para panturrilhas em pé.'
    }

    expect(matchExercise(customEx, 'elevacao')).toBe(true)
    expect(matchExercise(customEx, 'elevação')).toBe(true)
    expect(matchExercise(customEx, 'panturrilha elevacao')).toBe(true)
    expect(matchExercise(customEx, 'ELEVACAO PE')).toBe(true)
  })

  it('matches translated UI terms when a language is active', () => {
    _setLangState('fr', {
      chest: 'poitrine',
      barbell: 'barre',
      dumbbell: 'haltères',
      shoulders: 'épaules'
    }, null)

    // "poitrine" is the translated bp, "barre" is the translated eq
    expect(matchExercise(benchPress, 'poitrine')).toBe(true)
    expect(matchExercise(benchPress, 'barre')).toBe(true)
    expect(matchExercise(benchPress, 'poitrine barre bench')).toBe(true)
    expect(matchExercise(lateralRaise, 'haltères épaules')).toBe(true)
  })

  // A name pack (src/exercise-names/, CHW-201) renames the catalogue in the UI. Searching has to
  // reach that name as well as the canonical English one, or the library goes dark for a French
  // or Spanish profile the moment they type what they see on screen.
  it('matches the localized exercise name as well as the English one', () => {
    _setLangState('es', {}, null, { '0025': 'press de banca con barra' })

    expect(matchExercise(benchPress, 'press de banca')).toBe(true)
    expect(matchExercise(benchPress, 'banca barra')).toBe(true)
    expect(matchExercise(benchPress, 'bench press')).toBe(true)   // English still reaches it
    expect(matchExercise(lateralRaise, 'banca')).toBe(false)      // untranslated entry unaffected
    // The coach's typo-tolerant search reads the same two names, without accents.
    _setLangState('fr', {}, null, { '0025': 'développé couché à la barre' })
    expect(searchScore(benchPress, 'developpe couche')).toBeGreaterThan(0)
    expect(searchScore(benchPress, 'bnch')).toBeGreaterThan(0)
    expect(searchScore(lateralRaise, 'developpe couche')).toBe(0)
  })

  it('rebuilds the cached haystack when the language changes', () => {
    _setLangState('es', {}, null, { '0025': 'press de banca con barra' })
    expect(matchExercise(benchPress, 'banca')).toBe(true)

    // Spanish to French: the Spanish name must stop matching, not linger in the cache.
    _setLangState('fr', {}, null, { '0025': 'développé couché à la barre' })
    expect(matchExercise(benchPress, 'banca')).toBe(false)
    expect(matchExercise(benchPress, 'developpe')).toBe(true)

    _setLangState('en', null, null, null)
    expect(matchExercise(benchPress, 'developpe')).toBe(false)
    expect(matchExercise(benchPress, 'bench')).toBe(true)
  })
})

// A coach's own footage must not sit behind a photograph of a stranger doing the same lift. The
// dataset still is a fine LAST rung of the chain; it is not a stand-in for the video above it.
describe('resolveMedia and the video poster', () => {
  const ex = { id: '0025', n: 'bench press', gif: 'b.gif', img: 'b.jpg' }
  const vid = { id: 'r1', exId: '0025', file: 'v.mp4', mime: 'video/mp4', status: 'ready' }
  const pic = { id: 'r2', exId: '0025', file: 'p.jpg', mime: 'image/jpeg', status: 'ready' }

  it('gives a coach video no poster when only the dataset still exists', () => {
    const m = resolveMedia(ex, [vid])
    expect(m.videoPoster).toBe(null)
    // The still is still there for the fallback rung — it just is not the video's poster.
    expect(m.poster).toBeTruthy()
  })

  it('uses a coach-uploaded photo, because that one they chose', () => {
    expect(resolveMedia(ex, [vid, pic]).videoPoster).toBeTruthy()
  })
})

// CHW-209: a French list ran in English order because EXDB is stored that way.
describe('allExercises order', () => {
  const [a, b] = [CATALOGUE[0], CATALOGUE[1]]
  it('English keeps the stored order, customs first', () => {
    _setLangState('en', {}, null, null)
    const list = allExercises({ customEx: [{ id: 'c1', n: 'zzz mine' }] })
    expect(list[0].id).toBe('c1')
    expect(list[1]).toBe(a)
  })

  it('a translated language sorts the built-ins by their own names, accents ignored', () => {
    // Only two names in the pack: "Écarté" must land with the E's, before "Zzz", and both after
    // everything English-named that starts earlier. What matters here is the pair's relative order.
    _setLangState('fr', {}, null, { [a.id]: 'Zzz dernier', [b.id]: 'Écarté premier' })
    const list = allExercises({})
    expect(list.indexOf(b)).toBeLessThan(list.indexOf(a))
    expect(list).toHaveLength(CATALOGUE.length)
    _setLangState('en', {}, null, null)
  })
})
