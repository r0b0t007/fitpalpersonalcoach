// Display copy for the ready-made plans.
//
// Separate from starter.js on purpose. The registry there stores routine NAMES, which become
// user-editable data the moment a plan is loaded and so are deliberately left untranslated —
// translating at creation would bake the boot language into stored state. These strings are UI
// chrome that never gets stored, so they are translated normally. Keeping them apart also means
// starter.js stays free of an i18n import, and this module is light enough for a test to import
// without pulling in the whole sheets layer.
import { t } from './i18n-core.js'

export const PROGRAM_COPY = {
  ppl: () => ({ name: t('Push / Pull / Legs'), blurb: t('The classic three-day split. A missed session shifts the whole week.') }),
  fullbody: () => ({ name: t('Full Body'), blurb: t('Every session trains everything — the most forgiving if you miss a day.') }),
  upperlower: () => ({ name: t('Upper / Lower'), blurb: t('Two upper days, two lower. Each muscle group twice a week.') }),
  strength5x5: () => ({ name: t('Strength 5×5'), blurb: t('Five sets of five on the big lifts, adding weight every session.') }),
  bodypart: () => ({ name: t('One muscle a day'), blurb: t('Chest, back, shoulders, arms, legs — five days, one group each.') })
}

// Falls back to the raw id rather than throwing: a program added to the registry without copy
// should render awkwardly, not take the whole picker down when someone opens it.
export const copyFor = id => PROGRAM_COPY[id]?.() || { name: id, blurb: '' }
