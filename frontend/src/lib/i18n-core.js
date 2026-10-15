// Runtime-agnostic core of the i18n module: state, constants and readers (t, dateLocale,
// instrFor, exerciseNameFor, getLang). Plain Node-loadable — the browser-only pieces
// (import.meta.glob lazy
// loads, the React subscription hook) live in i18n.js and re-export from here.

export const DEFAULT_LANG = 'en'
export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français'
}
export const INSTR_LANGS = ['en', 'es', 'fr']
// Dormant: no offered language ships translated exercise names. The machinery stays so
// upstream's pt-BR/hu packs merge back without conflict if one is offered again.
export const EXERCISE_NAME_LANGS = []
export const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR'
}

let lang = DEFAULT_LANG          // set only by _setLangState, called from i18n.js setLang
let dict = {}                   // current locale pack (empty = English fallback)
let instr = null                // { exId: [steps] } for the current language, null = English
let exerciseNames = null        // { exId: translated name }, null = original catalogue name
let version = 0                 // bumped on every setLang; drives the React subscription selector

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'
export const getVersion = () => version

// The first offered language in a browser preference list, matched on its base code
// ('fr-CA' → 'fr', and 'fr_FR', which some Android WebViews report). Walks the whole list rather than taking the head, so a phone set to
// ['ar-MA', 'fr-FR'] lands on French instead of falling straight back to English.
export function pickLang(prefs) {
  for (const p of prefs || []) {
    const base = String(p).toLowerCase().split(/[-_]/)[0]
    if (LANGS[base]) return base
  }
  return DEFAULT_LANG
}

// What a profile that has never chosen a language starts in. Only ever reaches a brand-new
// profile: every saved state already carries the `lang` it was written with, and that wins.
export const browserLang = () => typeof navigator === 'undefined'
  ? DEFAULT_LANG
  : pickLang(navigator.languages?.length ? navigator.languages : [navigator.language])

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}

// Pick the singular or plural English key by the current language's plural rules, then
// translate it with n as {0}. `n === 1 ? a : b` is English's rule, not French's: French
// counts 0 as singular ("0 séance"). Only 'one' selects the singular; every other category
// ('few', 'many', …) takes the plural key, which is all two English forms can express.
const pluralRules = {}
export function tp(n, one, other, ...args) {
  let form = 'other'
  try { form = (pluralRules[lang] ||= new Intl.PluralRules(lang)).select(n) } catch { form = n === 1 ? 'one' : 'other' }
  return t(form === 'one' ? one : other, n, ...args)
}

// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

// Built-in catalogue names are bilingual when a complete translated name pack is active.
// User-created exercises have no entry in the pack and keep their exact chosen name.
export const exerciseNameFor = ex => {
  const translated = exerciseNames && ex && exerciseNames[ex.id]
  if (!translated) return ex?.n || ''
  // Some names (Burpee, Pilates, brand/model terms) are the established term in the target
  // language too. Repeating an identical loanword in parentheses adds noise rather than
  // context. Compared in the active language's own casing rules, not hardcoded to one —
  // this only ever differs from ordinary casing for languages with locale-specific rules
  // (e.g. Turkish dotless i), which does not include any language shipped here today.
  return translated.toLocaleLowerCase(lang) === ex.n.toLocaleLowerCase('en')
    ? translated
    : `${translated} (${ex.n})`
}

// Search both the localized and canonical English title without changing persisted data.
export const exerciseNameSearchText = ex => {
  const translated = exerciseNames && ex && exerciseNames[ex.id]
  return translated ? `${translated} ${ex.n}` : (ex?.n || '')
}

// Called by i18n.js's setLang once the locale pack has been loaded — kept here rather than
// exported as setLang because loading packs requires import.meta.glob, which is Vite-only.
// `dict`, `instr` and `exerciseNames` may be null to reset to their English fallbacks.
export function _setLangState(newLang, newDict, newInstr, newExerciseNames) {
  lang = LANGS[newLang] ? newLang : DEFAULT_LANG
  dict = lang === DEFAULT_LANG ? {} : (newDict || {})
  instr = lang === DEFAULT_LANG || !INSTR_LANGS.includes(lang) ? null : (newInstr || null)
  exerciseNames = lang === DEFAULT_LANG || !EXERCISE_NAME_LANGS.includes(lang) ? null : (newExerciseNames || null)
  version++
  return version
}
