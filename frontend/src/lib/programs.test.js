// The migration runs once, against a library a coach may have spent months building, and its
// failure modes are quiet: a duplicate looks like a mistake the coach made, and a dropped row
// looks like the app lost their work. So each case is pinned.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls = []
let behaviour = () => ({ programs: [] })
vi.mock('./api.js', () => ({
  api: async (path, opts) => {
    const body = opts?.body ? JSON.parse(opts.body) : null
    calls.push({ path, body })
    return behaviour(body)
  },
}))

const { migrateLocalPrograms } = await import('./programs.js')

const prog = (id, name) => ({ id, name, bundle: { opengym_plan: 1, routines: [{ id: 'r', ex: [] }] } })

beforeEach(() => {
  calls.length = 0
  behaviour = body => ({ programs: [{ id: body.id, name: body.name }] })
})

describe('migrateLocalPrograms', () => {
  it('does nothing at all when there is nothing local', async () => {
    const r = await migrateLocalPrograms([], [{ id: 'x' }])
    expect(r).toMatchObject({ moved: 0, failed: [], programs: [{ id: 'x' }] })
    expect([...r.safeIds]).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('sends each local program up, keeping its id', async () => {
    const r = await migrateLocalPrograms([prog('p1', 'Block A'), prog('p2', 'Block B')], [])
    expect(calls.map(c => c.body.id)).toEqual(['p1', 'p2'])
    expect(r.moved).toBe(2)
    expect(r.failed).toEqual([])
  })

  it('skips a program the server already has, so running twice cannot duplicate', async () => {
    const r = await migrateLocalPrograms([prog('p1', 'Block A'), prog('p2', 'Block B')], [{ id: 'p1', name: 'Block A' }])
    expect(calls.map(c => c.body.id)).toEqual(['p2'])
    expect(r.moved).toBe(1)
  })

  it('skips a damaged local row rather than sending a bundle-less program', async () => {
    await migrateLocalPrograms([{ id: 'p1', name: 'no bundle' }, { name: 'no id', bundle: {} }], [])
    expect(calls).toHaveLength(0)
  })

  it('reports which ids are now safe on the server, and that is all', async () => {
    // The caller removes exactly these from the local copy. A row that did not make it must not
    // be in the set, or clearing by it destroys the only copy of that program.
    behaviour = body => {
      if (body.id === 'p2') throw new Error('plan is too large')
      return { programs: [{ id: body.id }] }
    }
    const local = [prog('p1', 'A'), prog('p2', 'Too big'), { id: 'p3', name: 'damaged' }, prog('p4', 'D')]
    const r = await migrateLocalPrograms(local, [{ id: 'p4', name: 'D' }])
    expect([...r.safeIds].sort()).toEqual(['p1', 'p4'])   // p4 was already there, p1 just went up
    expect(r.safeIds.has('p2')).toBe(false)               // refused
    expect(r.safeIds.has('p3')).toBe(false)               // too damaged to send
  })

  it('counts a library that is already entirely up there as safe, so the local copy can go', async () => {
    // The second-device case. Nothing to move, but everything is up there, so leaving the local
    // copy behind would keep pushing it on every state sync forever.
    const r = await migrateLocalPrograms([prog('p1', 'A'), prog('p2', 'B')], [{ id: 'p1' }, { id: 'p2' }])
    expect(r.moved).toBe(0)
    expect([...r.safeIds].sort()).toEqual(['p1', 'p2'])
    expect(calls).toHaveLength(0)
  })

  it('one rejected row does not strand the others, and is reported by name', async () => {
    behaviour = body => {
      if (body.id === 'p2') throw new Error('plan is too large')
      return { programs: [{ id: body.id }] }
    }
    const r = await migrateLocalPrograms([prog('p1', 'Block A'), prog('p2', 'Huge'), prog('p3', 'Block C')], [])
    expect(calls.map(c => c.body.id)).toEqual(['p1', 'p2', 'p3'])
    expect(r.moved).toBe(2)
    expect(r.failed).toEqual([{ name: 'Huge', error: 'plan is too large' }])
  })
})
