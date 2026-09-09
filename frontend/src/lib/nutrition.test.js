import { describe, expect, it } from 'vitest'
import {
  FOODS_MAX,
  GRAMS_MAX,
  MEALS_KEEP_DAYS,
  MEAL_DAYS_KEEP_DAYS,
  PER100_MAX,
  addMeal,
  averageOver,
  compactMeals,
  daySeries,
  foodKey,
  hasNutrition,
  isValidFood,
  isValidGrams,
  kcalPoints,
  loggedFood,
  rememberFood,
  removeFood,
  removeMeal,
  scaleFood,
  searchFoods,
  sumEntries,
  targetOf,
  remainingOf,
  totalsFor,
} from './nutrition.js'

const TODAY = '2026-09-09'
const shift = (iso, n) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

const OATS = { id: 'f1', n: 'Oats', kcal: 380, p: 13, c: 60, f: 7 }
const CHICKEN = { id: 'f2', n: 'Chicken breast', kcal: 120, p: 23, c: 0, f: 2.6 }

const ate = (d, over = {}) => ({ id: 'm' + d + (over.n || ''), d, n: 'Oats', g: 100, kcal: 380, p: 13, c: 60, f: 7, s: 'f1', t: Date.parse(d), ...over })
const S = (over = {}) => ({ meals: [], foods: [], mealDays: {}, nutriTarget: null, ...over })

describe('scaling a food to grams', () => {
  it('scales all four numbers from per-100 g', () => {
    expect(scaleFood(OATS, 50)).toEqual({ kcal: 190, p: 6.5, c: 30, f: 3.5 })
    expect(scaleFood(OATS, 100)).toEqual({ kcal: 380, p: 13, c: 60, f: 7 })
    expect(scaleFood(OATS, 250)).toEqual({ kcal: 950, p: 32.5, c: 150, f: 17.5 })
  })

  it('treats a missing macro as zero rather than NaN', () => {
    // A food someone typed calories for and nothing else must still log. NaN here would poison
    // every total on the screen for the rest of the day.
    expect(scaleFood({ kcal: 200 }, 100)).toEqual({ kcal: 200, p: 0, c: 0, f: 0 })
  })
})

describe('a logged entry', () => {
  it('bakes the macros in, so it never has to resolve anything', () => {
    const e = loggedFood(OATS, 60, { id: 'm1', d: TODAY, t: 1000 })
    expect(e).toEqual({ id: 'm1', d: TODAY, n: 'Oats', g: 60, kcal: 228, p: 7.8, c: 36, f: 4.2, s: 'f1', t: 1000 })
  })

  it('reads back unchanged after the food it came from is deleted', () => {
    // This is the whole reason the entry denormalises. Delete the food, rename it, restore an
    // old backup — last Tuesday's lunch is still last Tuesday's lunch.
    const e = loggedFood(OATS, 60, { id: 'm1', d: TODAY })
    const foods = removeFood([OATS, CHICKEN], 'f1')
    expect(foods.find(f => f.id === 'f1')).toBeUndefined()
    expect(totalsFor(S({ meals: [e] }), TODAY)).toEqual({ kcal: 228, p: 7.8, c: 36, f: 4.2 })
  })

  it('keeps provenance as a note and nothing more', () => {
    expect(loggedFood(OATS, 100, { id: 'm1', d: TODAY }).s).toBe('f1')
    // Typed fresh, never saved to the list: an empty string, not a dangling id.
    expect(loggedFood({ n: 'Airport sandwich', kcal: 300 }, 100, { id: 'm2', d: TODAY }).s).toBe('')
  })

  it('sorts by day and then by the order it was logged', () => {
    const list = addMeal(addMeal([], ate('2026-09-09')), ate('2026-09-07', { n: 'x' }))
    expect(list.map(m => m.d)).toEqual(['2026-09-07', '2026-09-09'])
  })

  it('removes by id', () => {
    const list = [ate(TODAY), ate(TODAY, { id: 'other', n: 'x' })]
    expect(removeMeal(list, 'other').map(m => m.id)).toEqual([list[0].id])
  })
})

describe('the day totals', () => {
  it('adds up only the entries on that day', () => {
    const s = S({ meals: [ate(TODAY), ate(TODAY, { id: 'b', n: 'x', kcal: 120, p: 23, c: 0, f: 2.6 }), ate('2026-09-08', { id: 'c' })] })
    expect(totalsFor(s, TODAY)).toEqual({ kcal: 500, p: 36, c: 60, f: 9.6 })
  })

  it('is zeroes, not undefined, for a day with nothing on it', () => {
    expect(totalsFor(S(), TODAY)).toEqual({ kcal: 0, p: 0, c: 0, f: 0 })
  })

  it('falls back to a rolled-up row once the entries are gone', () => {
    expect(totalsFor(S({ mealDays: { '2026-01-04': [2100, 160, 210, 60] } }), '2026-01-04'))
      .toEqual({ kcal: 2100, p: 160, c: 210, f: 60 })
  })

  it('never double-counts a day that has both', () => {
    // Only reachable through a restored backup, but ignoring a stale row beats reporting 4200.
    const s = S({ meals: [ate(TODAY)], mealDays: { [TODAY]: [2100, 160, 210, 60] } })
    expect(totalsFor(s, TODAY).kcal).toBe(380)
    expect(daySeries(s).find(r => r.d === TODAY).kcal).toBe(380)
  })

  it('sums a list of entries without floating-point dust', () => {
    expect(sumEntries([{ kcal: 1, p: 0.1, c: 0.2, f: 0 }, { kcal: 1, p: 0.2, c: 0.1, f: 0 }]))
      .toEqual({ kcal: 2, p: 0.3, c: 0.3, f: 0 })
  })
})

describe('the series a chart reads', () => {
  it('joins rolled-up days and live entries into one run', () => {
    const s = S({
      mealDays: { '2026-09-01': [1800, 140, 180, 50] },
      meals: [ate('2026-09-08'), ate('2026-09-09')],
    })
    expect(daySeries(s).map(r => r.d)).toEqual(['2026-09-01', '2026-09-08', '2026-09-09'])
  })

  it('windows by days back from today, inclusive of today', () => {
    const s = S({ meals: [ate(shift(TODAY, -30)), ate(shift(TODAY, -3)), ate(TODAY)] })
    expect(daySeries(s, 14, TODAY).map(r => r.d)).toEqual([shift(TODAY, -3), TODAY])
  })

  it('emits LineChart points in the same shape as body weight', () => {
    const pts = kcalPoints(S({ meals: [ate(TODAY)] }), 0, TODAY)
    expect(Object.keys(pts[0]).sort()).toEqual(['d', 't', 'y'])
    expect(pts[0].y).toBe(380)
  })
})

describe('the average a coach reads', () => {
  it('divides by days logged, never by the window', () => {
    // Dividing 4 logged days by a 14-day window reports a client eating 600 kcal. That number
    // on a coach's screen is worse than no number at all.
    const s = S({ meals: [ate(TODAY), ate(shift(TODAY, -1), { id: 'b' }), ate(shift(TODAY, -2), { id: 'c' })] })
    const a = averageOver(s, 14, TODAY)
    expect(a.kcal).toBe(380)
    expect(a.logged).toBe(3)
    expect(a.days).toBe(14)
  })

  it('reports zero logged days rather than dividing by zero', () => {
    expect(averageOver(S(), 14, TODAY)).toEqual({ logged: 0, days: 14, kcal: 0, p: 0, c: 0, f: 0 })
  })
})

describe('the coach-set target', () => {
  it('keeps only the macros that were actually set', () => {
    // A coach who sets calories and protein and leaves the rest alone means exactly that;
    // rendering "0 g carbs" would report a target nobody wrote.
    expect(targetOf({ nutriTarget: { kcal: 2200, p: 170 } })).toEqual({ kcal: 2200, p: 170, t: 0 })
  })

  it('is null when there is nothing usable on it', () => {
    for (const bad of [null, undefined, 'nope', [], {}, { kcal: 0 }, { kcal: 'lots' }]) {
      expect(targetOf({ nutriTarget: bad })).toBeNull()
    }
  })

  it('carries the coach note through', () => {
    expect(targetOf({ nutriTarget: { kcal: 2200, note: '  training days  ' } }).note).toBe('training days')
  })

  it('reports what is left, positive for under and negative for over', () => {
    const target = targetOf({ nutriTarget: { kcal: 2000, p: 160 } })
    expect(remainingOf({ kcal: 1500, p: 180, c: 200, f: 60 }, target)).toEqual({ kcal: 500, p: -20 })
  })

  it('reports nothing at all without a target, rather than zeroes', () => {
    expect(remainingOf({ kcal: 1500 }, null)).toEqual({})
  })
})

describe('the personal food list', () => {
  it('matches the same food typed with different case and spacing', () => {
    expect(foodKey('  Greek   Yoghurt ')).toBe(foodKey('greek yoghurt'))
  })

  it('moves a re-used food to the head instead of adding a twin', () => {
    const foods = rememberFood(rememberFood([], OATS), CHICKEN)
    expect(foods.map(f => f.n)).toEqual(['Chicken breast', 'Oats'])
    const again = rememberFood(foods, { ...OATS, kcal: 375 })
    expect(again.map(f => f.n)).toEqual(['Oats', 'Chicken breast'])
    expect(again[0].kcal).toBe(375)   // the correction sticks
  })

  it('evicts the least recently used past the cap', () => {
    let foods = []
    for (let i = 0; i < FOODS_MAX + 5; i++) foods = rememberFood(foods, { id: 'f' + i, n: 'Food ' + i, kcal: 100 })
    expect(foods).toHaveLength(FOODS_MAX)
    expect(foods[0].n).toBe('Food ' + (FOODS_MAX + 4))
    expect(foods.find(f => f.n === 'Food 0')).toBeUndefined()
  })

  it('strips keys that are not part of the row', () => {
    expect(Object.keys(rememberFood([], { ...OATS, evil: 1, workouts: [] })[0]).sort())
      .toEqual(['c', 'f', 'id', 'kcal', 'n', 'p'])
  })

  it('searches in use order, so the last thing eaten wins', () => {
    const foods = rememberFood(rememberFood([], { id: 'a', n: 'Oat milk', kcal: 45 }), OATS)
    expect(searchFoods(foods, 'oat').map(f => f.n)).toEqual(['Oats', 'Oat milk'])
    expect(searchFoods(foods, 'MILK').map(f => f.n)).toEqual(['Oat milk'])
    expect(searchFoods(foods, 'sushi')).toEqual([])
  })

  it('answers an empty query with the head of the list', () => {
    const foods = rememberFood(rememberFood([], OATS), CHICKEN)
    expect(searchFoods(foods, '', 1).map(f => f.n)).toEqual(['Chicken breast'])
  })
})

describe('the input guards', () => {
  it('accepts a plausible food and refuses a slipped decimal point', () => {
    expect(isValidFood(OATS)).toBe(true)
    expect(isValidFood({ n: '', kcal: 100 })).toBe(false)
    expect(isValidFood({ n: 'Air', kcal: 0 })).toBe(false)
    expect(isValidFood({ n: 'Butter', kcal: PER100_MAX.kcal + 1 })).toBe(false)
    expect(isValidFood({ n: 'Whey', kcal: 400, p: 101 })).toBe(false)
  })

  it('accepts a portion and refuses a typo', () => {
    expect(isValidGrams(1)).toBe(true)
    expect(isValidGrams(GRAMS_MAX)).toBe(true)
    expect(isValidGrams(0)).toBe(false)
    expect(isValidGrams(GRAMS_MAX + 1)).toBe(false)
    expect(isValidGrams(NaN)).toBe(false)
  })
})

describe('compaction', () => {
  it('does nothing, and says so, when everything is inside the window', () => {
    expect(compactMeals(S({ meals: [ate(TODAY), ate(shift(TODAY, -30))] }), TODAY)).toBeNull()
  })

  it('rolls entries past the window into four numbers a day', () => {
    const old = shift(TODAY, -(MEALS_KEEP_DAYS + 1))
    const s = S({ meals: [ate(old), ate(old, { id: 'b', n: 'x', kcal: 120, p: 23, c: 0, f: 2.6 }), ate(TODAY)] })
    const out = compactMeals(s, TODAY)
    expect(out.meals.map(m => m.d)).toEqual([TODAY])
    expect(out.mealDays[old]).toEqual([500, 36, 60, 9.6])
  })

  it('leaves the total for a rolled day exactly where it was', () => {
    const old = shift(TODAY, -(MEALS_KEEP_DAYS + 5))
    const before = totalsFor(S({ meals: [ate(old)] }), old)
    const out = compactMeals(S({ meals: [ate(old)] }), TODAY)
    expect(totalsFor(S(out), old)).toEqual(before)
  })

  it('adds to a day that already has a row instead of replacing it', () => {
    // Reachable by re-importing a backup: replacing would silently halve the day.
    const old = shift(TODAY, -(MEALS_KEEP_DAYS + 1))
    const out = compactMeals(S({ meals: [ate(old)], mealDays: { [old]: [100, 10, 10, 1] } }), TODAY)
    expect(out.mealDays[old]).toEqual([480, 23, 70, 8])
  })

  it('drops rolled rows past the long window', () => {
    const ancient = shift(TODAY, -(MEAL_DAYS_KEEP_DAYS + 1))
    const out = compactMeals(S({ mealDays: { [ancient]: [2000, 150, 200, 60], '2026-09-01': [1800, 140, 180, 50] } }), TODAY)
    expect(Object.keys(out.mealDays)).toEqual(['2026-09-01'])
  })

  it('is idempotent — running it twice changes nothing the second time', () => {
    const old = shift(TODAY, -(MEALS_KEEP_DAYS + 1))
    const first = compactMeals(S({ meals: [ate(old), ate(TODAY)] }), TODAY)
    expect(compactMeals(S(first), TODAY)).toBeNull()
  })
})

describe('whether the profile uses nutrition at all', () => {
  it('is false for a profile that has never touched it, so no empty panel appears', () => {
    expect(hasNutrition(S())).toBe(false)
    expect(hasNutrition(undefined)).toBe(false)
  })

  it('is true from a target alone, before anything is logged', () => {
    expect(hasNutrition(S({ nutriTarget: { kcal: 2200 } }))).toBe(true)
    expect(hasNutrition(S({ meals: [ate(TODAY)] }))).toBe(true)
    expect(hasNutrition(S({ mealDays: { '2026-01-04': [1, 1, 1, 1] } }))).toBe(true)
  })
})
