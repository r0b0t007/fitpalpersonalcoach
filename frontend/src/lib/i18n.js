// Browser-only shell of the i18n module. The runtime-agnostic state and readers live
// in i18n-core.js (plain Node-loadable); this file adds the two pieces that genuinely need
// the browser: `setLang` (which lazy-loads locale packs via import.meta.glob) and the React
// subscription hook `useLang`.

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_LANG, LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES,
  getLang, dateLocale, t, instrFor, exerciseNameFor, exerciseNameSearchText, getVersion, _setLangState
} from './i18n-core.js'

export {
  DEFAULT_LANG, LANGS, INSTR_LANGS, EXERCISE_NAME_LANGS, DATE_LOCALES,
  getLang, dateLocale, t, instrFor, exerciseNameFor, exerciseNameSearchText
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

export async function setLang(l) {
  if (!LANGS[l]) l = DEFAULT_LANG
  if (l === getLang() && getVersion() > 0) return
  let dict = {}, instr = null, exerciseNames = null
  try { dict = l === DEFAULT_LANG ? {} : (await localePacks['../locales/' + l + '.js']()).default } catch (e) { dict = {} }
  try { instr = l === DEFAULT_LANG || !INSTR_LANGS.includes(l) ? null : (await instrPacks['../instr/' + l + '.js']()).default } catch (e) { instr = null }
  try {
    exerciseNames = l === DEFAULT_LANG || !EXERCISE_NAME_LANGS.includes(l)
      ? null
      : (await exerciseNamePacks['../exercise-names/' + l + '.js']()).default
  } catch (e) { exerciseNames = null }
  _setLangState(l, dict, instr, exerciseNames)
  notify()
}

// Re-renders the subscribing component (and its children) whenever the language changes.
export function useLang() {
  return useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, getVersion)
}
