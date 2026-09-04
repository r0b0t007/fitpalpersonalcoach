// Ready-made plans a member can load instead of building one from scratch.
//
// PPL was the only one for a long time, and it is a poor first plan for a club whose members
// come when they can: it assumes a six-day rotation squeezed into three days, so a missed
// session desynchronises the week. Full Body is the better default for a beginner or someone
// coming back, Upper/Lower is the natural step up, 5×5 is for someone who wants to add weight
// every session, and the body-part split is what most commercial-gym members already expect.
//
// Routine names are deliberately NOT translated. A name becomes user-editable data the moment
// the routine exists, so translating at creation would bake the boot language into stored state
// and leave stale names behind after a language switch. The picker chrome around them IS
// translated — see programPickerSheet in sheets.jsx.
import { uid } from './format.js'

// [id, sets, reps] per exercise; ids are the zero-padded strings EXIDX is keyed by, so '0025'
// resolves and '25' does not. Every id here is covered by a test that walks the whole registry
// against EXDB — a typo would otherwise ship as a silent blank row in someone's routine.
//
// Some movements a normal program wants are not in the dataset, so the closest match with an
// animation is used rather than a guess. Three are in play here: cable rear delt row (0203) for a
// face pull, hanging leg raise (0472) where a plank would go, and seated overhead press (0091),
// since every standing barbell variant upstream is grip-qualified. A hip thrust is also absent —
// barbell glute bridge (1409) is the stand-in if a program ever wants one, but none currently do.
export const PROGRAMS = [
  {
    id: 'ppl',
    days: [1, 3, 5],
    routines: [
      ['Push Day', 'barbell', [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
      ['Pull Day', 'pullup', [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
      // 0739 (sled 45° leg press) has mojibake in its upstream name and 1463 is the clean twin —
      // but demoSeed.js keys a starting-weight table off these exact ids, so PPL keeps 0739.
      // Newer programs below use 1463.
      ['Leg Day', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
    ]
  },
  {
    id: 'fullbody',
    days: [1, 3, 5],
    routines: [
      ['Full Body A', 'figureStrength', [['0043', 3, 8], ['0025', 3, 8], ['0027', 3, 8], ['0586', 3, 10], ['0472', 3, 12]]],
      ['Full Body B', 'figureStrength', [['0032', 3, 5], ['0091', 3, 8], ['2330', 3, 10], ['0336', 3, 10], ['0334', 3, 12]]],
      ['Full Body C', 'figureStrength', [['0042', 3, 8], ['0289', 3, 10], ['0861', 3, 10], ['0085', 3, 10], ['0031', 3, 12]]]
    ]
  },
  {
    id: 'upperlower',
    days: [1, 2, 4, 5],
    routines: [
      ['Upper A', 'barbell', [['0025', 4, 6], ['0027', 4, 6], ['0091', 3, 8], ['2330', 3, 10], ['0031', 3, 10], ['0241', 3, 12]]],
      ['Lower A', 'legs', [['0043', 4, 6], ['0085', 3, 8], ['1463', 3, 10], ['0586', 3, 12], ['0605', 4, 15]]],
      ['Upper B', 'dumbbell', [['0047', 4, 8], ['1326', 3, 8], ['0405', 3, 10], ['0861', 3, 12], ['0334', 3, 15], ['0060', 3, 12]]],
      ['Lower B', 'legs', [['0032', 3, 5], ['0042', 3, 8], ['0585', 3, 12], ['0336', 3, 10], ['0605', 4, 15]]]
    ]
  },
  {
    // Linear is already the implicit default for reps mode, and defaultIncrement() gives the
    // bigger jump to squat/row/deadlift and the smaller one to bench/press — which is exactly
    // StrongLifts. Set explicitly anyway, because for this program the progression rule IS the
    // program, and it should not quietly change if the default ever does.
    id: 'strength5x5',
    days: [1, 3, 5],
    prog: 'linear',
    schedule: [0, 1, 0],   // A / B / A — see the note the picker shows about alternating
    routines: [
      ['Strength A', 'plate', [['0043', 5, 5], ['0025', 5, 5], ['0027', 5, 5]]],
      ['Strength B', 'plate', [['0043', 5, 5], ['0091', 5, 5], ['0032', 1, 5]]]
    ]
  },
  {
    id: 'bodypart',
    days: [1, 2, 3, 4, 5],
    routines: [
      ['Chest', 'dumbbell', [['0025', 4, 8], ['0047', 3, 10], ['0289', 3, 10], ['0251', 3, 10]]],
      ['Back', 'pullup', [['0652', 4, 8], ['0027', 4, 8], ['2330', 3, 10], ['0861', 3, 12]]],
      ['Shoulders', 'kettlebell', [['0091', 4, 8], ['0334', 4, 12], ['0203', 3, 12], ['0405', 3, 10]]],
      ['Arms', 'arm', [['0031', 4, 10], ['0060', 4, 10], ['0294', 3, 12], ['0241', 3, 12]]],
      ['Legs', 'legs', [['0043', 4, 8], ['0085', 3, 10], ['1463', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
    ]
  }
]

export const programById = id => PROGRAMS.find(p => p.id === id)

// Fresh routine objects with new ids, so loading the same program twice gives two independent
// copies rather than aliases.
export const programRoutines = id => {
  const p = programById(id)
  if (!p) return []
  return p.routines.map(([name, emoji, list]) => ({
    id: uid(),
    name,
    emoji,
    ...(p.prog ? { prog: p.prog } : {}),
    ex: list.map(([exId, sets, reps]) => ({ id: exId, sets, reps, weight: 0 }))
  }))
}

// Which routine index sits on each of the program's days. Defaults to one routine per day, in
// order; 5×5 overrides it to repeat A on the third day.
export const programSchedule = id => {
  const p = programById(id)
  if (!p) return []
  return p.schedule || p.routines.map((_, i) => i)
}

// PPL, unchanged. demoSeed.js destructures exactly these three and keys a starting-weight table
// off their exercise ids, so this signature and their order have to stay put.
export const starterRoutines = () => programRoutines('ppl')
