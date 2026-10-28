import { describe, expect, it } from 'vitest'
import { PHOTO_MAX_EDGE, POSES, fitWithin, photoSrc, photosByPeriod, posesFor } from './photo.js'

// preparePhoto/decode are deliberately absent from this file. There is no canvas in this repo's
// test environment — no jsdom toBlob, no 2d context — so a test of them would be a test of a
// mock. The arithmetic they depend on is `fitWithin`, which is why it is exported, and the
// route they feed is covered from the server side by backend/tests/Feature/PhotoTest.php.

const row = (id, d, pose) => ({ id, d, pose })

describe('fitWithin', () => {
  it('fits a landscape phone photo to the long edge', () => {
    expect(fitWithin(4032, 3024)).toEqual({ w: 1600, h: 1200 })
  })

  it('fits a portrait one the same way — the long edge is whichever it is', () => {
    expect(fitWithin(3024, 4032)).toEqual({ w: 1200, h: 1600 })
  })

  it('never scales up', () => {
    // A 900px photo interpolated to 1600 looks worse and weighs more. Left alone.
    expect(fitWithin(900, 600)).toEqual({ w: 900, h: 600 })
    expect(fitWithin(1600, 1600)).toEqual({ w: 1600, h: 1600 })
  })

  it('keeps a short edge of at least 1', () => {
    // An extreme panorama rounds its short edge to 0, and a canvas of width 0 encodes to
    // nothing at all rather than to a thin image.
    expect(fitWithin(1, 20000)).toEqual({ w: 1, h: 1600 })
  })

  it('honours a smaller box when one is asked for', () => {
    expect(fitWithin(4032, 3024, 400)).toEqual({ w: 400, h: 300 })
  })

  it('returns null for anything that is not a pair of dimensions', () => {
    // What a decode that produced nothing looks like — the caller refuses rather than drawing
    // a zero-sized canvas and uploading the result.
    expect(fitWithin(0, 100)).toBe(null)
    expect(fitWithin(100, 0)).toBe(null)
    expect(fitWithin(undefined, undefined)).toBe(null)
    expect(fitWithin(NaN, 100)).toBe(null)
    expect(fitWithin(-10, -10)).toBe(null)
    expect(fitWithin(100, 100, 0)).toBe(null)
  })

  it('defaults to the documented long edge', () => {
    expect(PHOTO_MAX_EDGE).toBe(1600)
    expect(fitWithin(3200, 3200)).toEqual(fitWithin(3200, 3200, PHOTO_MAX_EDGE))
  })
})

describe('POSES', () => {
  it('keeps the three ids the server whitelists', () => {
    // These are a query parameter and a key in media-<uid>.json. Renaming one orphans every
    // photo already filed under it, and api/server.js's PHOTO_POSES would refuse the new name.
    expect(POSES.map(p => p.id)).toEqual(['front', 'side', 'back'])
  })
})

describe('photoSrc', () => {
  it('addresses a photo by row id, never by filename', () => {
    expect(photoSrc({ id: 'abc' })).toBe('/api/media/photo?id=abc')
  })

  it('names the owner when a coach is the one reading', () => {
    expect(photoSrc({ id: 'abc' }, 'mem1')).toBe('/api/media/photo?id=abc&u=mem1')
  })

  it('escapes both, because base64url ids and uids are not URL-safe by assumption', () => {
    expect(photoSrc({ id: 'a b&c' }, 'x/y')).toBe('/api/media/photo?id=a%20b%26c&u=x%2Fy')
  })
})

describe('photosByPeriod', () => {
  it('groups by the check-in period, newest first', () => {
    const out = photosByPeriod([
      row('a', '2026-08-30', 'front'),
      row('b', '2026-09-06', 'front'),
      row('c', '2026-08-30', 'back'),
    ])
    expect(out.map(g => g.d)).toEqual(['2026-09-06', '2026-08-30'])
    expect(out[1].photos.map(p => p.id)).toEqual(['a', 'c'])
  })

  it('orders the angles the way the sheet offers them, not the way they were sent', () => {
    const out = photosByPeriod([
      row('c', '2026-09-06', 'back'),
      row('a', '2026-09-06', 'front'),
      row('b', '2026-09-06', 'side'),
    ])
    expect(out[0].photos.map(p => p.pose)).toEqual(['front', 'side', 'back'])
  })

  it('sorts an unrecognised pose last rather than first', () => {
    // indexOf returns -1 for one, and a row a future version or a hand edit wrote would
    // otherwise jump ahead of all three real angles.
    const out = photosByPeriod([row('x', '2026-09-06', 'moon'), row('a', '2026-09-06', 'front')])
    expect(out[0].photos.map(p => p.id)).toEqual(['a', 'x'])
  })

  it('drops rows with nothing to address or date them by', () => {
    expect(photosByPeriod([null, {}, { id: 'a' }, { d: '2026-09-06' }])).toEqual([])
  })

  it('is empty for nothing at all', () => {
    expect(photosByPeriod(undefined)).toEqual([])
    expect(photosByPeriod([])).toEqual([])
  })
})

describe('posesFor', () => {
  it('keys one period’s photos by angle', () => {
    const rows = [row('a', '2026-09-06', 'front'), row('b', '2026-08-30', 'front'), row('c', '2026-09-06', 'back')]
    expect(posesFor(rows, '2026-09-06')).toEqual({ front: rows[0], back: rows[2] })
  })

  it('ignores a pose the sheet has no slot for', () => {
    expect(posesFor([row('x', '2026-09-06', 'moon')], '2026-09-06')).toEqual({})
  })

  it('is empty for a period with nothing filed', () => {
    expect(posesFor([row('a', '2026-09-06', 'front')], '2026-09-13')).toEqual({})
  })
})
