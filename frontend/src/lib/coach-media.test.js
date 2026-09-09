import { describe, it, expect, beforeEach } from 'vitest'
import { indexMedia, setCoachMedia, coachMediaFor, coachMediaVersion, subscribeCoachMedia } from './coach-media.js'
import { resolveMedia, videoSrc, posterSrc, hasMedia } from './exercises.js'

const vid = (o = {}) => ({ id: 'r1', exId: 'bench', file: 'bench-a.mp4', label: 'side on', mime: 'video/mp4', bytes: 10, status: 'ready', created: '2026-01-01T00:00:00.000Z', ...o })
const pic = (o = {}) => vid({ id: 'p1', file: 'bench-a.jpg', mime: 'image/jpeg', ...o })

// A stock dataset row and a custom exercise, which is the pair the whole chain exists for:
// the custom one has no gif and no jpg and never will.
const STOCK = { id: 'bench', n: 'bench press', gif: 'bench.gif', img: 'bench.jpg' }
const CUSTOM = { id: 'mk9x2', n: 'cable thing', custom: true }

beforeEach(() => setCoachMedia([]))

describe('indexMedia', () => {
  it('groups by exercise and puts the newest take first', () => {
    const idx = indexMedia([
      vid({ id: 'old', created: '2025-01-01T00:00:00.000Z' }),
      vid({ id: 'new', created: '2026-06-01T00:00:00.000Z' }),
      vid({ id: 'other', exId: 'squat' })
    ])
    expect(idx.bench.map(m => m.id)).toEqual(['new', 'old'])
    expect(idx.squat.map(m => m.id)).toEqual(['other'])
  })

  it('drops rows with nothing to address them by rather than minting a URL that 404s', () => {
    expect(indexMedia([vid({ id: '' }), vid({ exId: null }), null, 'nope'])).toEqual({})
  })

  it('accepts the raw API envelope as well as a bare array', () => {
    expect(Object.keys(indexMedia({ media: [vid()] }))).toEqual(['bench'])
  })

  it('hands back the same empty array for an exercise with no demo', () => {
    expect(coachMediaFor('nothing')).toBe(coachMediaFor('either'))
    expect(coachMediaFor(undefined)).toEqual([])
  })

  it('notifies subscribers and moves the version on every set', () => {
    let hits = 0
    const off = subscribeCoachMedia(() => { hits++ })
    const before = coachMediaVersion()
    setCoachMedia([vid()])
    expect(hits).toBe(1)
    expect(coachMediaVersion()).toBe(before + 1)
    off()
    setCoachMedia([])
    expect(hits).toBe(1)
  })
})

describe('resolveMedia — the fallback chain', () => {
  it('falls back to the stock gif and jpg when the coach has uploaded nothing', () => {
    const m = resolveMedia(STOCK, [])
    expect(m.video).toBe(null)
    expect(m.gif).toBe('gif/bench.gif')
    expect(m.poster).toBe('img/bench.jpg')
    expect(m.any).toBe(true)
  })

  it('prefers a coach video over the stock gif, and keeps the gif as the rung below it', () => {
    const m = resolveMedia(STOCK, [vid()])
    expect(m.video).toBe('/api/media/ex?id=r1')
    expect(m.gif).toBe('gif/bench.gif')
    expect(m.label).toBe('side on')
  })

  it('prefers a coach photo over the stock jpg for the poster', () => {
    expect(resolveMedia(STOCK, [pic()]).poster).toBe('/api/media/ex?id=p1')
  })

  it('gives a custom exercise media it could never have had, and nothing without it', () => {
    expect(resolveMedia(CUSTOM, []).any).toBe(false)
    const m = resolveMedia(CUSTOM, [vid({ exId: CUSTOM.id })])
    expect(m.any).toBe(true)
    expect(m.video).toBe('/api/media/ex?id=r1')
    // No stock rungs beneath it: a failed decode here has nowhere to fall but the glyph.
    expect(m.gif).toBe(null)
    expect(m.poster).toBe(null)
  })

  it("marks a 'raw' upload without withholding it — it is shown and played either way", () => {
    const m = resolveMedia(STOCK, [vid({ status: 'raw', mime: 'video/quicktime' })])
    expect(m.raw).toBe(true)
    expect(m.video).toBe('/api/media/ex?id=r1')
  })

  it('escapes the row id into the query string', () => {
    expect(resolveMedia(STOCK, [vid({ id: 'a b&c' })]).video).toBe('/api/media/ex?id=a%20b%26c')
  })

  it('survives an exercise it cannot resolve at all', () => {
    expect(resolveMedia(undefined, undefined).any).toBe(false)
    expect(resolveMedia({}, []).any).toBe(false)
  })
})

describe('videoSrc / posterSrc / hasMedia read the registry', () => {
  it('answers from the loaded list', () => {
    expect(videoSrc(STOCK)).toBe(null)
    expect(hasMedia(CUSTOM)).toBe(false)
    setCoachMedia([vid(), vid({ id: 'c1', exId: CUSTOM.id })])
    expect(videoSrc(STOCK)).toBe('/api/media/ex?id=r1')
    expect(posterSrc(STOCK)).toBe('img/bench.jpg')
    expect(hasMedia(CUSTOM)).toBe(true)
  })

  it('is synchronous, so a card does not flicker from null to content on mount', () => {
    setCoachMedia([vid()])
    expect(hasMedia(STOCK)).toBe(hasMedia(STOCK))
    expect(videoSrc({ id: 'bench' })).toBe('/api/media/ex?id=r1')
  })
})
