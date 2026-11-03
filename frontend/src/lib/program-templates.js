// Ready-made programs a new coach copies into their library (CHW-345): something to send, or to
// make their page's starter program, on day one.
//
// A copy is the coach's own program, fully editable, and nothing ties it back to the template —
// so every name and note in it is stored data the client reads, made in the coach's language at
// the moment they copy it. That is why the words are functions: t() runs when they are called,
// not when this module loads, and its strings are literals inside t() calls, the only place
// check-source-strings.mjs can see them (lib/starter.js says the same of its plan names). The
// chooser calls only `name` and `about`; the routines are built when a coach copies one.
//
// A routine is [key, name, emoji, [[exerciseId, sets, reps, extra?], …]]. `extra` carries a note
// or `side` (reps are then the total over both sides, as history.js counts them). The schedule is
// [weekday, routineKey], weekday a getDay() index, so 1 is Monday. It is the same every week —
// the app has no rotation — so an A/B program on three days does A twice and says so. No
// cardio-tagged exercise: the app would log a burpee as minutes and speed.
import { t } from './i18n-core.js'
import { uid } from './format.js'
import { bundleOf } from './program-draft.js'

const SIDE = { side: true }
const ABA = [[1, 'a'], [3, 'b'], [5, 'a']]

const TEMPLATES = {
  'full-body': {
    name: () => t('Full body for beginners'),
    about: () => t('Three days a week: session A on Monday and Friday, B on Wednesday. Machines and dumbbells.'),
    routines: () => [
      ['a', t('Full body A'), 'figureStrength', [
        ['1760', 3, 10, { note: t('Hold the dumbbell against your chest; sit between your heels.') }],
        ['0289', 3, 10], ['2330', 3, 10], ['1459', 3, 10], ['0334', 2, 12], ['0276', 2, 20, SIDE]]],
      ['b', t('Full body B'), 'figureStrength', [
        ['0739', 3, 12], ['0405', 3, 10], ['1323', 3, 10], ['0336', 2, 20, SIDE], ['0586', 2, 12], ['0274', 2, 15]]],
    ],
    schedule: ABA,
  },
  ppl: {
    name: () => t('Push / pull / legs'),
    about: () => t('Six days a week, each session twice. For clients who already train.'),
    routines: () => [
      ['push', t('Push'), 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
      ['pull', t('Pull'), 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
      ['legs', t('Legs'), 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]],
    ],
    schedule: [[1, 'push'], [2, 'pull'], [3, 'legs'], [4, 'push'], [5, 'pull'], [6, 'legs']],
  },
  home: {
    name: () => t('Home, no equipment'),
    about: () => t('Three days a week, with nothing but a chair and a table.'),
    routines: () => [
      ['a', t('Home A'), 'figureStrength', [
        ['1685', 3, 15],
        ['0662', 3, 10, { note: t('On your knees if ten is too many.') }],
        ['2368', 3, 20, { side: true, note: t('Back foot on a chair or the sofa.') }],
        ['3013', 3, 15], ['0129', 3, 10, { note: t('Hands on a sturdy chair.') }], ['0276', 3, 20, SIDE]]],
      ['b', t('Home B'), 'figureStrength', [
        ['1460', 3, 24, SIDE], ['0493', 3, 12],
        ['0499', 3, 8, { note: t('Under a sturdy table, holding its edge.') }],
        ['3769', 3, 20, SIDE], ['0710', 3, 30, SIDE], ['1373', 3, 20], ['0274', 3, 15]]],
    ],
    schedule: ABA,
  },
  glutes: {
    name: () => t('Glutes and legs'),
    about: () => t('Three days a week in the gym: session A on Monday and Friday, B on Wednesday.'),
    routines: () => [
      ['a', t('Glutes A'), 'legs', [
        ['1409', 4, 10, { note: t('Pause one second at the top, squeezing your glutes.') }],
        ['0085', 3, 10], ['0431', 3, 20, SIDE], ['0597', 3, 15], ['0196', 3, 12]]],
      ['b', t('Glutes B'), 'legs', [
        ['0043', 4, 8], ['1459', 3, 12], ['2368', 3, 20, SIDE], ['0586', 3, 12], ['3561', 3, 20, SIDE]]],
    ],
    schedule: ABA,
  },
  ramadan: {
    name: () => t('Ramadan, after iftar'),
    about: () => t('Three short, lighter sessions a week, after the evening meal.'),
    routines: () => [
      ['a', t('After iftar A'), 'figureStrength', [
        ['1760', 2, 12, { note: t('Start 1½ to 2 hours after iftar, drink water, and stop two or three reps before failure.') }],
        ['0289', 2, 12], ['1323', 2, 12], ['1459', 2, 12], ['0276', 2, 20, SIDE]]],
      ['b', t('After iftar B'), 'figureStrength', [
        ['0739', 2, 12, { note: t('Start 1½ to 2 hours after iftar, drink water, and stop two or three reps before failure.') }],
        ['2330', 2, 12], ['0405', 2, 12], ['3013', 2, 15], ['0274', 2, 15]]],
    ],
    schedule: ABA,
  },
}

/** [{ key, name, about, days }] for the chooser, in the coach's language. */
export const programTemplates = () => Object.entries(TEMPLATES).map(([key, tpl]) => ({
  key, name: tpl.name(), about: tpl.about(), days: new Set(tpl.schedule.map(([day]) => day)).size,
}))

/** A fresh `{ name, bundle }` to save as a new program, or null for an unknown key. */
export function templateProgram(key) {
  const tpl = TEMPLATES[key]
  if (!tpl) return null
  const name = tpl.name()
  const list = tpl.routines()
  const routines = list.map(([, rname, emoji, ex]) => ({
    id: uid(), name: rname, emoji,
    ex: ex.map(([id, sets, reps, extra]) => ({ id, sets, reps, weight: 0, ...extra })),
  }))
  // key → the id just minted for it, so a weekday names its routine
  const byKey = Object.fromEntries(list.map(([key], i) => [key, routines[i].id]))
  const week = {}
  for (const [day, key] of tpl.schedule) week[day] = [...(week[day] || []), byKey[key]]
  return { name, bundle: bundleOf({ name, routines, week, customEx: [] }, []) }
}
