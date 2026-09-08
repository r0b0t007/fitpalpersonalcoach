// Runtime-agnostic core of the i18n module: state, constants and readers (t, dateLocale,
// instrFor, getLang). Plain Node-loadable — the browser-only pieces (import.meta.glob lazy
// loads, the React subscription hook) live in i18n.js and re-export from here.

export const DEFAULT_LANG = 'en'
export const LANGS = {
  en: 'English', de: 'Deutsch', es: 'Español', fr: 'Français', it: 'Italiano',
  pt: 'Português', pl: 'Polski', tr: 'Türkçe', ru: 'Русский', zh: '中文',
  ko: '한국어', hi: 'हिन्दी', ar: 'العربية'
}
export const INSTR_LANGS = ['en', 'es', 'fr', 'it', 'tr', 'ru', 'zh', 'hi', 'pl', 'ko']
// Packs whose values are still their English keys. Selecting one gives you the app in
// English with that language's layout and date formatting, which is a real state a user
// can end up in, so the picker says so (Settings.jsx) rather than implying a translation
// that is not there. Drop a language from here the moment its pack is filled in.
export const STUB_LANGS = ['ar']
// Languages that read right-to-left. Drives <html dir> (App.jsx) and, through it, every
// logical property in index.css — so adding one here is the whole layout switch.
export const RTL_LANGS = ['ar']
export const DATE_LOCALES = {
  en: 'en-GB', de: 'de-DE', es: 'es-ES', fr: 'fr-FR', it: 'it-IT', pt: 'pt-PT',
  pl: 'pl-PL', tr: 'tr-TR', ru: 'ru-RU', zh: 'zh-CN', ko: 'ko-KR', hi: 'hi-IN',
  // -u-nu-latn, not plain `ar-EG`: the default Arabic numbering system is Arabic-Indic
  // (٨٢٫٥), and this app is mostly numbers sitting in columns that only line up because
  // of `font-variant-numeric:tabular-nums`, which those digits don't get. Latin digits
  // with Arabic month and day names is also what the region's own fitness apps ship.
  ar: 'ar-u-nu-latn'
}

let lang = DEFAULT_LANG          // set only by _setLangState, called from i18n.js setLang
let dict = {}                   // current locale pack (empty = English fallback)
let instr = null                // { exId: [steps] } for the current language, null = English
let version = 0                 // bumped on every setLang; drives the React subscription selector

export const getLang = () => lang
export const dateLocale = () => DATE_LOCALES[lang] || 'en-GB'
export const getVersion = () => version

// Writing direction for a given language (dirFor) or the current one (textDir). Takes a
// language rather than reading `lang` so App.jsx can set <html dir> from the stored
// preference on the first paint, before any pack has loaded.
export const dirFor = l => (RTL_LANGS.includes(l) ? 'rtl' : 'ltr')
export const textDir = () => dirFor(lang)

// Translate a source string; {0},{1}… are replaced with args (also on the English fallback).
export function t(s, ...args) {
  let v = dict[s] || s
  for (let i = 0; i < args.length; i++) v = v.replaceAll('{' + i + '}', args[i])
  return v
}

// Instructions for an exercise in the current language (English steps as fallback).
export const instrFor = ex => (instr && instr[ex.id]) || ex.st || []

// Called by i18n.js's setLang once the locale pack has been loaded — kept here rather than
// exported as setLang because loading packs requires import.meta.glob, which is Vite-only.
// Both `dict` and `instr` may be null to reset to English.
export function _setLangState(newLang, newDict, newInstr) {
  lang = LANGS[newLang] ? newLang : DEFAULT_LANG
  dict = lang === DEFAULT_LANG ? {} : (newDict || {})
  instr = lang === DEFAULT_LANG || !INSTR_LANGS.includes(lang) ? null : (newInstr || null)
  version++
  return version
}
