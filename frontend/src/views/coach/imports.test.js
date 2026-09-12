// @vitest-environment happy-dom
//
// The coach screens were carved out of one 900-line file, and a helper left behind in another
// module is a ReferenceError that only fires when that branch renders — the send sheet's member
// list needed `rel`, which had moved, and every gate (build, vitest, the locale check) stayed
// green because an undefined identifier is only an error at runtime. Importing each module for
// real is what catches it: a missing import fails the import itself, and every exported
// component is at least constructed.
import { describe, it, expect } from 'vitest'

describe('the coach modules load and export what the screens import', () => {
  // 30s, not the 5s default. This deliberately imports the WHOLE coach graph for real —
  // parts, sheets, six screens, the routine editor and the client Settings screen it reaches
  // into — and on a cold transform cache that lands either side of 5s. A test that fails
  // once in a few runs for a reason that is not the code gets ignored, then deleted, and this
  // one exists because a helper left behind in another module was a ReferenceError nothing
  // else caught.
  it('parts, sheets and the three screens import cleanly', { timeout: 30000 }, async () => {
    const parts = await import('./parts.jsx')
    const sheets = await import('./sheets.jsx')
    for (const n of ['rel', 'dur', 'memberState', 'memberAdherence', 'RosterAdherence', 'CheckinsCard', 'PhotosCard', 'AdherenceCard'])
      expect(typeof parts[n], n).toMatch(/function/)
    for (const n of ['SendSheet', 'InviteSheet', 'MediaSheet'])
      expect(typeof sheets[n], n).toBe('function')
    for (const m of ['./CoachToday.jsx', './Clients.jsx', './ClientDetail.jsx', './Programs.jsx', './ProgramEdit.jsx', './CoachAccount.jsx'])
      expect(typeof (await import(m)).default, m).toBe('function')
    // The program editor reaches across into the client-side routine editor and the context that
    // lets it bind somewhere other than the store. Both are exactly the kind of cross-module
    // import a rename breaks silently until a coach opens a routine inside a program.
    const editor = await import('./ProgramEdit.jsx')
    for (const n of ['ProgramEdit', 'ProgramRoutineEdit'])
      expect(typeof editor[n], n).toBe('function')
    expect(typeof (await import('../RoutineEdit.jsx')).RoutineEditor).toBe('function')
    const target = await import('../../components/RoutineTarget.jsx')
    for (const n of ['RoutineTarget', 'StoreRoutineTarget', 'useRoutineTarget'])
      expect(typeof target[n], n).toBe('function')
    // Account reaches across into the client Settings screen for the pairing sheet, and Business
    // pulls the audit formatters and `rel` out of two other modules — the same cross-module shape
    // that has already cost this branch one ReferenceError nothing else caught.
    const business = await import('./Business.jsx')
    for (const n of ['BusinessAccounts', 'BusinessActivity'])
      expect(typeof business[n], n).toBe('function')
    expect(typeof (await import('../Settings.jsx')).PairSheet).toBe('function')
  })
})
