// Browser-only shell of the i18n module. The runtime-agnostic state and readers live
// in i18n-core.js (plain Node-loadable); this file adds the two pieces that genuinely need
// the browser: `setLang` (which lazy-loads locale packs via import.meta.glob) and the React
// subscription hook `useLang`.

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_LANG, LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES,
  getLang, dateLocale, t, tp, instrFor, exerciseNameFor, localExerciseName, exerciseNameSearchText, getVersion, _setLangState
} from './i18n-core.js'

export {
  DEFAULT_LANG, LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES,
  getLang, dateLocale, t, tp, instrFor, exerciseNameFor, localExerciseName, exerciseNameSearchText
}

// Vite code-splits locale, instruction and exercise-name packs via import.meta.glob. They are
// lazy, so the production bundle ships English only until another language is selected.
//
// Each lookup sits in its own try: Vite rewrites the literal call at build time, so under Vite
// the catch is dead code. Under any other bundler (esbuild packaging the components for
// claude.ai/design — see .design-sync/) `import.meta` is an empty object and the call throws;
// catching it leaves the packs empty, which means English, instead of taking the whole module
// down at load and every component that imports t() with it.
let localePacks = {}, instrPacks = {}, exerciseNamePacks = {}
try { localePacks = import.meta.glob('../locales/*.js') } catch { /* not Vite: English only */ }
try { instrPacks = import.meta.glob('../instr/*.js') } catch { /* not Vite */ }
try { exerciseNamePacks = import.meta.glob('../exercise-names/*.js') } catch { /* not Vite */ }

// React subscription bookkeeping — kept here, not in core, so core has zero React coupling.
const subs = new Set()
const notify = () => { subs.forEach(f => f()) }

// The background half of the last setLang: the exercise instruction and name packs. Exposed so a
// test (or anything that must have exercise text) can wait for it; the UI never needs to.
let exercisePacks = Promise.resolve()
export const exercisePacksReady = () => exercisePacks
let token = 0

export async function setLang(l) {
  if (!LANGS[l]) l = DEFAULT_LANG
  if (l === getLang() && getVersion() > 0) return
  const mine = ++token
  // A pack that fails to load falls back to English on its own, without taking the others with it.
  const load = (want, packs, path) => want ? Promise.resolve().then(() => packs[path]()).then(m => m.default, () => null) : null

  // main.jsx mounts the app when this resolves, so it waits for the UI strings alone (~25 KB
  // compressed), and on its own connection: started alongside the exercise instructions (~85 KB)
  // it shared the bandwidth with them and arrived later. The sign-in screen needs no exercise
  // text, and instrFor / exerciseNameFor fall back to English until their packs land (CHW-211).
  const dict = await load(l !== DEFAULT_LANG, localePacks, '../locales/' + l + '.js')
  if (mine !== token) return          // a newer setLang has started; it owns the state now
  _setLangState(l, dict || {}, null, null)
  notify()

  // Then the exercise packs, in the background. The version bump re-renders every subscriber,
  // and the search corpus is keyed on it, so steps and names switch over without a reload. The
  // token stops a slow pack for a language the person has already left from landing afterwards.
  exercisePacks = Promise.all([
    load(l !== DEFAULT_LANG && INSTR_LANGS.includes(l), instrPacks, '../instr/' + l + '.js'),
    load(l !== DEFAULT_LANG && EXERCISE_NAME_LANGS.includes(l), exerciseNamePacks, '../exercise-names/' + l + '.js'),
  ]).then(([instr, exerciseNames]) => {
    if (mine !== token || (!instr && !exerciseNames)) return
    _setLangState(l, dict || {}, instr, exerciseNames)
    notify()
  })
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, getVersion)
}
