// @vitest-environment happy-dom
// The two ways the four numbers are shown, and the line between them: MacroRows answers "how
// much have I eaten today", TargetRows states what was prescribed. Rendering the first where the
// second belongs is what put "Carbs 0 g" under a heading reading "Daily targets" on the sheet
// where a member accepts a coach's program.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MacroRows, TargetRows } from './MacroRows.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = el => { act(() => root.render(el)); return host.textContent }

describe('TargetRows', () => {
  it('draws only the macros the coach actually set', () => {
    const text = render(<TargetRows target={{ kcal: 2200, p: 170 }} />)

    expect(text).toContain('Calories')
    expect(text).toContain('2,200')
    expect(text).toContain('Protein')
    expect(text).toContain('170')
    // The whole point: a macro left unset is absent, not a prescription of zero.
    expect(text).not.toContain('Carbs')
    expect(text).not.toContain('Fat')
    expect(host.querySelectorAll('.row').length).toBe(2)
  })

  it('says nothing about intake — nothing has been eaten and nothing accepted yet', () => {
    const text = render(<TargetRows target={{ kcal: 2200, p: 170, c: 220, f: 60 }} />)

    expect(text).not.toContain('left')
    expect(text).not.toContain('over')
    expect(text).not.toContain('/')
  })
})

describe('MacroRows', () => {
  it('reads an unlogged macro as eaten none, which is what that screen is asking', () => {
    const text = render(<MacroRows totals={{ kcal: 500 }} target={{ kcal: 2200 }} />)

    expect(text).toContain('500 / 2,200')
    expect(text).toContain('1,700 left')
    expect(text).toContain('Carbs')   // eaten nothing today, on the screen where that is the question
  })

  it('counts past the target as over, matching remainingOf’s sign', () => {
    expect(render(<MacroRows totals={{ p: 200 }} target={{ p: 170 }} />)).toContain('30 over')
  })
})
