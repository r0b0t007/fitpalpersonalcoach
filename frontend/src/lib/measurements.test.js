import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  SITES,
  deltasOver,
  isValidValue,
  latestBySite,
  lengthUnit,
  rangeFor,
  removeMeasurement,
  seriesFor,
  sitesUsed,
  upsertMeasurement,
} from './measurements.js'

const DAY = 86400000
const NOW = Date.parse('2026-09-09T12:00:00Z')

// The module reads the clock for windowing, the same way the body-weight chart does. Pinning it
// keeps the window assertions from drifting into failures months from now.
const at = daysAgo => NOW - daysAgo * DAY
const m = (d, site, v, t) => ({ d, site, v, t })
const S = (measurements, unit = 'kg') => ({ unit, measurements })

afterEach(() => vi.useRealTimers())
const freeze = () => { vi.useFakeTimers(); vi.setSystemTime(NOW) }

describe('unit follows the profile', () => {
  it('reads cm for kg and inches for lb', () => {
    expect(lengthUnit({ unit: 'kg' })).toBe('cm')
    expect(lengthUnit({ unit: 'lb' })).toBe('in')
  })

  it('defaults to cm for a profile with no unit yet', () => {
    expect(lengthUnit({})).toBe('cm')
    expect(lengthUnit(undefined)).toBe('cm')
  })

  it('guards a slipped decimal without having an opinion on bodies', () => {
    // Wide on purpose. The job is catching 8 typed for 80, or inches entered in a cm profile.
    expect(isValidValue({ unit: 'kg' }, 82.5)).toBe(true)
    expect(isValidValue({ unit: 'kg' }, 0.8)).toBe(false)
    expect(isValidValue({ unit: 'kg' }, 2500)).toBe(false)
    expect(isValidValue({ unit: 'lb' }, 32)).toBe(true)
    expect(isValidValue({ unit: 'lb' }, 320)).toBe(false)
    expect(isValidValue({ unit: 'kg' }, NaN)).toBe(false)
    expect(isValidValue({ unit: 'kg' }, null)).toBe(false)
    expect(rangeFor({ unit: 'in' }).max).toBeGreaterThan(0)
  })
})

describe('recording a reading', () => {
  it('keeps the list sorted by date however it arrives', () => {
    let l = []
    l = upsertMeasurement(l, { d: '2026-09-05', site: 'waist', v: 84 })
    l = upsertMeasurement(l, { d: '2026-08-01', site: 'waist', v: 86 })
    l = upsertMeasurement(l, { d: '2026-09-01', site: 'waist', v: 85 })
    expect(l.map(x => x.d)).toEqual(['2026-08-01', '2026-09-01', '2026-09-05'])
  })

  it('replaces the same site on the same day rather than recording a trend', () => {
    // Re-measuring straight away is a correction, not a second data point.
    let l = upsertMeasurement([], { d: '2026-09-09', site: 'waist', v: 84 })
    l = upsertMeasurement(l, { d: '2026-09-09', site: 'waist', v: 83.5 })
    expect(l).toHaveLength(1)
    expect(l[0].v).toBe(83.5)
  })

  it('lets different sites share a day, which is what a check-in is', () => {
    let l = upsertMeasurement([], { d: '2026-09-09', site: 'waist', v: 84 })
    l = upsertMeasurement(l, { d: '2026-09-09', site: 'arm', v: 38 })
    expect(l).toHaveLength(2)
    expect(new Set(l.map(x => x.site))).toEqual(new Set(['waist', 'arm']))
  })

  it('does not mutate the array it was given', () => {
    // The store's update() hands it live state; mutating would bypass the dirty flag.
    const before = [m('2026-09-01', 'waist', 85, at(8))]
    const after = upsertMeasurement(before, { d: '2026-09-09', site: 'waist', v: 84 })
    expect(before).toHaveLength(1)
    expect(after).toHaveLength(2)
  })

  it('removes one site on one day and leaves the rest', () => {
    const l = [m('2026-09-09', 'waist', 84, at(0)), m('2026-09-09', 'arm', 38, at(0))]
    expect(removeMeasurement(l, '2026-09-09', 'waist')).toEqual([l[1]])
  })

  it('tolerates a missing list', () => {
    expect(upsertMeasurement(undefined, { d: '2026-09-09', site: 'arm', v: 38 })).toHaveLength(1)
    expect(removeMeasurement(undefined, '2026-09-09', 'arm')).toEqual([])
  })
})

describe('reading it back', () => {
  const sample = S([
    m('2026-07-01', 'waist', 88, at(70)),
    m('2026-08-15', 'waist', 86, at(25)),
    m('2026-09-08', 'waist', 84, at(1)),
    m('2026-09-08', 'arm', 38, at(1)),
  ])

  it('emits exactly the points LineChart already draws for body weight', () => {
    freeze()
    const pts = seriesFor(sample, 'waist')
    expect(pts).toHaveLength(3)
    expect(Object.keys(pts[0]).sort()).toEqual(['d', 't', 'y'])
    expect(pts.map(p => p.y)).toEqual([88, 86, 84])
  })

  it('windows on days, and falls back to the date when a reading has no timestamp', () => {
    freeze()
    expect(seriesFor(sample, 'waist', 30)).toHaveLength(2)
    const noT = S([{ d: '2026-09-08', site: 'waist', v: 84 }])
    expect(seriesFor(noT, 'waist')[0].t).toBe(Date.parse('2026-09-08'))
  })

  it('gives the latest per site, not the latest overall', () => {
    const latest = latestBySite(sample)
    expect(latest.waist.v).toBe(84)
    expect(latest.arm.v).toBe(38)
    expect(latest.calf).toBeUndefined()
  })

  it('lists only the sites this profile actually uses, in tape order', () => {
    expect(sitesUsed(sample)).toEqual(['arm', 'waist'])
    expect(sitesUsed(S([]))).toEqual([])
    expect(SITES.indexOf('arm')).toBeLessThan(SITES.indexOf('waist'))
  })

  it('survives an empty or absent profile', () => {
    expect(seriesFor({}, 'waist')).toEqual([])
    expect(latestBySite(undefined)).toEqual({})
    expect(sitesUsed(undefined)).toEqual([])
  })
})

describe('change over a window', () => {
  it('reports the move between the first and last reading inside it', () => {
    freeze()
    const d = deltasOver(S([
      m('2026-07-01', 'waist', 88, at(70)),
      m('2026-08-15', 'waist', 86, at(25)),
      m('2026-09-08', 'waist', 84, at(1)),
    ]), 90)
    expect(d.waist).toMatchObject({ from: 88, to: 84, delta: -4 })
    expect(d.waist.days).toBe(69)
  })

  it('says nothing about a site with one reading, rather than saying "no change"', () => {
    // A single measurement is a starting point. Reporting delta 0 would show a client "no
    // change" when what actually happened is "you have not measured again yet".
    freeze()
    const d = deltasOver(S([m('2026-09-08', 'waist', 84, at(1))]), 90)
    expect(d.waist).toBeUndefined()
    expect(Object.keys(d)).toEqual([])
  })

  it('ignores readings that fall outside the window', () => {
    freeze()
    const d = deltasOver(S([
      m('2025-01-01', 'waist', 95, at(600)),
      m('2026-09-08', 'waist', 84, at(1)),
    ]), 30)
    expect(d.waist).toBeUndefined()   // only one reading is inside 30 days
  })

  it('rounds to one decimal so a float artefact never reaches the screen', () => {
    freeze()
    const d = deltasOver(S([
      m('2026-09-01', 'arm', 38.1, at(8)),
      m('2026-09-08', 'arm', 38.3, at(1)),
    ]), 90)
    expect(d.arm.delta).toBe(0.2)
  })
})
