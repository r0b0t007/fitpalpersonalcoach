// @vitest-environment happy-dom
//
// Programs (CHW-345): a new coach's empty library offers the ready-made programs, and one tap
// copies a template into the library and opens the copy.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Routes, Route, useParams } from 'react-router-dom'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const calls = []
let LIBRARY = []
let SAVE = null
vi.mock('../../lib/api.js', async orig => ({
  ...(await orig()),
  api: async (path, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : undefined
    calls.push([path, body])
    if (path === '/api/coach/programs') return { programs: LIBRARY, max: 50 }
    if (path === '/api/coach/programs/save') {
      if (SAVE instanceof Error) throw SAVE
      const program = { id: body.id, name: body.name, bundle: body.bundle }
      return { program, programs: [...LIBRARY, program] }
    }
    throw new Error('unexpected ' + path)
  },
}))
const { default: Programs } = await import('./Programs.jsx')
const { useUI } = await import('../../store/useUI.js')

function Opened() { return <div>editing {useParams().pid}</div> }

let container, root, toasts
const text = () => container.textContent
const render = async () => {
  await act(async () => {
    root.render(<MemoryRouter><Routes>
      <Route path="/" element={<Programs />} />
      <Route path="/programs/:pid" element={<Opened />} />
    </Routes></MemoryRouter>)
  })
  await act(async () => {})
}
const item = name => [...container.querySelectorAll('button.item')].find(b => b.textContent.includes(name))

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0; LIBRARY = []; SAVE = null; toasts = []
  vi.spyOn(useUI.getState(), 'toast').mockImplementation(m => { toasts.push(m) })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })

describe('Programs › templates', () => {
  it('offers the five templates in an empty library', async () => {
    await render()
    for (const name of ['Full body for beginners', 'Push / pull / legs', 'Home, no equipment', 'Glutes and legs', 'Ramadan, after iftar']) {
      expect(item(name), name).toBeTruthy()
    }
    expect(item('Push / pull / legs').textContent).toContain('6 days/wk')
  })

  it('copies a template into the library under a new id, and opens the copy', async () => {
    await render()
    await act(async () => { item('Home, no equipment').click() })
    await act(async () => {})
    const [, saved] = calls.find(([p]) => p === '/api/coach/programs/save')
    expect(saved.name).toBe('Home, no equipment')
    expect(saved.bundle.opengym_plan).toBeTruthy()
    expect(saved.bundle.routines.map(r => r.name)).toEqual(['Home A', 'Home B'])
    expect(text()).toBe('editing ' + saved.id)
    expect(toasts).toEqual(['Copied to your library'])
  })

  it('stays on the list and says why when the server refuses the copy', async () => {
    SAVE = new Error('you have 50 programs — delete one before saving another')
    await render()
    await act(async () => { item('Glutes and legs').click() })
    await act(async () => {})
    expect(toasts).toEqual(['you have 50 programs — delete one before saving another'])
    expect(item('Glutes and legs').disabled).toBe(false)
  })

  it('keeps the list to the library once there is one: the templates are a button away', async () => {
    LIBRARY = [{ id: 'p1', name: 'Mine', created: 1, updated: 1, bundle: { routines: [{ id: 'r', ex: [] }], week: {} } }]
    await render()
    expect(item('Mine')).toBeTruthy()
    expect(item('Home, no equipment')).toBeFalsy()
    expect([...container.querySelectorAll('button')].some(b => b.textContent.trim() === 'Start from a template')).toBe(true)
  })
})
