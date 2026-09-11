// @vitest-environment happy-dom
//
// One property, and the only one here a pure test cannot reach: an edit applied from a callback
// that was created several edits ago must still see every edit since.
//
// That is not hypothetical tidiness. useUI.openSheet stores a sheet's render closure ONCE, and the
// two sheets this editor leans on stay open across several taps — the exercise picker deliberately
// does not close when you add an exercise, and the weekday sheet toggles as many routines as you
// like before Done. A version of `edit` that took a finished draft computed at the call site lost
// everything but the last tap: three exercises added, one kept. The picker still showed its "added"
// toast each time, and the program was saved with one of them.
//
// So these tests capture a callback from the FIRST render and call it repeatedly, which is exactly
// what a long-lived sheet does.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const saved = []
let fetchImpl = async () => ({ programs: [PROGRAM] })
let saveImpl = async p => ({ programs: [p] })
vi.mock('../../lib/programs.js', () => ({
  fetchPrograms: (...a) => fetchImpl(...a),
  savePrograms: async p => { saved.push(p); return saveImpl(p) },
  deleteProgram: async () => ({ programs: [] }),
}))
vi.mock('../../lib/mobile.js', () => ({
  MOBILE: false, initReminderSync: () => {}, writeAutoBackup: () => {}, nativeLoad: async () => null, nativeSave: () => {}, syncReminder: () => {},
}))

const PROGRAM = {
  id: 'p1', name: 'Block A',
  bundle: {
    opengym_plan: 1, name: 'Block A', customEx: [], week: {},
    routines: [{ id: 'r1', name: 'Push', emoji: 'barbell', ex: [] }, { id: 'r2', name: 'Pull', emoji: 'pullup', ex: [] }],
  },
}

const { useProgramDraft } = await import('./ProgramEdit.jsx')
const { patchRoutine, toggleDay } = await import('../../lib/program-draft.js')

// Stands in for a sheet: whatever the hook handed back on the render where the sheet was opened is
// kept, and every later tap goes through that frozen copy.
let frozen, latest
function Harness() {
  const d = useProgramDraft('p1')
  latest = d
  if (d.draft && !frozen) frozen = d
  return null
}

let container, root
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  saved.length = 0; frozen = null; latest = null
  fetchImpl = async () => ({ programs: [PROGRAM] })
  saveImpl = async p => ({ programs: [p] })
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.useRealTimers() })

const mount = async () => {
  await act(async () => { root.render(<Harness />) })
}

describe('a draft edited from a sheet that outlives the render that opened it', () => {
  it('keeps every exercise when three are added in one visit to the picker', async () => {
    await mount()
    const add = id => frozen.edit(d => patchRoutine(d, 'r1', r => { r.ex.push({ id, sets: 3, reps: 10 }) }))
    act(() => { add('0001') })
    act(() => { add('0002') })
    act(() => { add('0003') })
    const push = latest.draft.routines.find(r => r.id === 'r1')
    expect(push.ex.map(e => e.id)).toEqual(['0001', '0002', '0003'])
  })

  it('keeps both routines when two are ticked onto one weekday before Done', async () => {
    // The weekday sheet holds its own `sel` state and shows both ticked throughout, so losing one
    // here means the saved week disagrees with what the coach was looking at.
    await mount()
    act(() => { frozen.edit(d => toggleDay(d, 1, 'r1')) })
    act(() => { frozen.edit(d => toggleDay(d, 1, 'r2')) })
    expect(latest.draft.week[1]).toEqual(['r1', 'r2'])
  })

  it('renames without discarding an exercise added a moment earlier', async () => {
    await mount()
    act(() => { frozen.edit(d => patchRoutine(d, 'r1', r => { r.ex.push({ id: '0001' }) })) })
    act(() => { frozen.edit(d => ({ ...d, name: 'Block B' })) })
    expect(latest.draft.name).toBe('Block B')
    expect(latest.draft.routines[0].ex).toHaveLength(1)
  })
})

describe('saving', () => {
  it('sends the accumulated draft once, after the coach stops typing', async () => {
    vi.useFakeTimers()
    await mount()
    act(() => { latest.edit(d => ({ ...d, name: 'B' })) })
    act(() => { latest.edit(d => ({ ...d, name: 'Bl' })) })
    expect(latest.status).toBe('unsaved')     // nothing has left the browser yet
    expect(saved).toHaveLength(0)
    await act(async () => { vi.advanceTimersByTime(800) })
    expect(saved).toHaveLength(1)
    expect(saved[0].name).toBe('Bl')
  })

  it('keeps a refused edit pending so leaving the screen tries it again', async () => {
    // The first version cleared the pending draft BEFORE the request. A refusal then threw the edit
    // away: red text on screen, nothing left to retry with, and the rename gone for good the moment
    // the coach walked out.
    saveImpl = async () => { throw new Error('plan is too large') }
    vi.useFakeTimers()
    await mount()
    act(() => { latest.edit(d => ({ ...d, name: 'Too big' })) })
    await act(async () => { vi.advanceTimersByTime(800) })
    expect(saved).toHaveLength(1)
    expect(latest.status).toBe('plan is too large')   // the server's own words, not "save failed"
    // Leaving the screen retries what was refused, rather than finding nothing to send.
    saveImpl = async p => ({ programs: [p] })
    await act(async () => { latest.flush() })
    expect(saved).toHaveLength(2)
    expect(saved[1].name).toBe('Too big')
    expect(latest.status).toBe('saved')
  })

  it('stops re-sending once a save has actually landed', async () => {
    vi.useFakeTimers()
    await mount()
    act(() => { latest.edit(d => ({ ...d, name: 'Fine' })) })
    await act(async () => { vi.advanceTimersByTime(800) })
    await act(async () => { latest.flush() })
    expect(saved).toHaveLength(1)
  })

  it('discard() stops a pending save, so deleting cannot be undone by an upsert in flight', async () => {
    // savePrograms is an upsert. A debounced save still queued when the delete lands puts the row
    // straight back, and the coach's deleted program returns on the next load.
    vi.useFakeTimers()
    await mount()
    act(() => { latest.edit(d => ({ ...d, name: 'about to be deleted' })) })
    act(() => { latest.discard() })
    await act(async () => { vi.advanceTimersByTime(2000) })
    act(() => { latest.flush() })
    expect(saved).toHaveLength(0)
  })
})

describe('loading', () => {
  it('tells a coach whose program is genuinely gone apart from one it could not reach', async () => {
    fetchImpl = async () => ({ programs: [] })
    await mount()
    expect(latest.draft).toBe(false)          // not there

    act(() => root.unmount())
    container.remove()
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
    frozen = null
    fetchImpl = async () => { throw new Error('offline') }
    await mount()
    expect(latest.draft).toBe('error')        // could not look
  })
})
