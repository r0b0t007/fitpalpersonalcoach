// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Media from './Media.jsx'
import { setCoachMedia } from '../lib/coach-media.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const state = { S: { gifSize: 'full' } }
  state.snapshot = () => ({
    S: state.S,
    update: mut => {
      const next = structuredClone(state.S)
      mut(next)
      state.S = next
    },
  })
  return state
})
vi.mock('../store/useStore.js', () => {
  const useStore = selector => selector(mocks.snapshot())
  useStore.getState = mocks.snapshot
  return { useStore }
})

const EX = { id: 'bench', n: 'bench press', gif: 'bench.gif', img: 'bench.jpg' }
// The exercise the coach invented: no dataset row, so no gif and no jpg, ever.
const CUSTOM = { id: 'mk9x2', n: 'cable thing', custom: true }
const ROW = { id: 'r1', exId: 'bench', file: 'b.mp4', label: '', mime: 'video/mp4', bytes: 9, status: 'ready', created: '2026-01-01T00:00:00.000Z' }

// happy-dom ships an IntersectionObserver whose observe() does nothing, so on its own nothing
// would ever come on screen and no video would ever start. These tests say when it does.
const REAL_IO = globalThis.IntersectionObserver
const stubIO = (visibleOnObserve = true) => {
  const seen = []
  globalThis.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; seen.push(this) }
    observe() { if (visibleOnObserve) this.cb([{ isIntersecting: true }]) }
    unobserve() {}
    disconnect() {}
  }
  return seen
}
// play() on happy-dom always resolves. A browser refusing autoplay rejects instead, which is the
// case the hint has to survive, so that one is mocked onto the prototype that owns play().
const mediaProto = (() => {
  let p = Object.getPrototypeOf(document.createElement('video'))
  while (p && !Object.prototype.hasOwnProperty.call(p, 'play')) p = Object.getPrototypeOf(p)
  return p
})()

let host, root
beforeEach(() => {
  mocks.S = { gifSize: 'full' }
  setCoachMedia([])
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  globalThis.IntersectionObserver = REAL_IO
  vi.restoreAllMocks()
})

const mount = (props, ex = EX) => act(() => root.render(<Media ex={ex} {...props} />))

describe('Media gifSize', () => {
  it('renders the full animation by default and toggles to mini in the workout', () => {
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia img')).toBeTruthy()
    expect(host.querySelector('.exmedia.mini')).toBeFalsy()
    act(() => { host.querySelector('.giftoggle').click() })
    expect(mocks.S.gifSize).toBe('mini')
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia.mini')).toBeTruthy()
  })

  it("renders nothing at all in the workout when gifSize is 'off'", () => {
    mocks.S = { gifSize: 'off' }
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia')).toBeFalsy()
    expect(host.querySelector('img')).toBeFalsy()
    expect(host.innerHTML).toBe('')
  })

  it("'off' only applies to the workout — the detail sheet (not minimizable) still shows media", () => {
    mocks.S = { gifSize: 'off' }
    mount({})
    expect(host.querySelector('.exmedia img')).toBeTruthy()
  })

  it('treats a legacy/unknown value as full', () => {
    mocks.S = { gifSize: 'huge' }
    mount({ minimizable: true })
    expect(host.querySelector('.exmedia img')).toBeTruthy()
    expect(host.querySelector('.exmedia.mini')).toBeFalsy()
  })
})

describe('Media coach demos', () => {
  it('prefers the coach video over the stock animation, poster and all, and says whose it is', () => {
    setCoachMedia([ROW])
    mount({})
    const v = host.querySelector('.exmedia video')
    expect(v).toBeTruthy()
    expect(v.getAttribute('src')).toBe('/api/media/ex?id=r1')
    expect(v.getAttribute('poster')).toBe('img/bench.jpg')
    expect(host.querySelector('.exmedia img')).toBeFalsy()
    expect(host.querySelector('.exbadge')).toBeTruthy()
    expect(host.querySelector('.exbadge.warn')).toBeFalsy()
  })

  it("shows and plays a 'raw' upload, marked rather than withheld", () => {
    setCoachMedia([{ ...ROW, status: 'raw', mime: 'video/quicktime' }])
    mount({})
    expect(host.querySelector('.exmedia video').getAttribute('src')).toBe('/api/media/ex?id=r1')
    expect(host.querySelector('.exbadge.warn')).toBeTruthy()
  })

  it('falls back one rung to the stock animation when the video will not decode', () => {
    setCoachMedia([ROW])
    mount({})
    act(() => { host.querySelector('video').dispatchEvent(new Event('error', { bubbles: true })) })
    expect(host.querySelector('.exmedia video')).toBeFalsy()
    expect(host.querySelector('.exmedia img').getAttribute('src')).toBe('gif/bench.gif')
    expect(host.querySelector('.exmedia.broken')).toBeFalsy()
  })

  it('gives a custom exercise media it could never have had — and nothing without one', () => {
    mount({}, CUSTOM)
    expect(host.innerHTML).toBe('')
    setCoachMedia([{ ...ROW, exId: CUSTOM.id }])
    mount({}, CUSTOM)
    expect(host.querySelector('.exmedia video')).toBeTruthy()
    // Nothing beneath it in the chain: a failed decode here has only the glyph left.
    act(() => { host.querySelector('video').dispatchEvent(new Event('error', { bubbles: true })) })
    expect(host.querySelector('.exmedia.broken .exmedia-x')).toBeTruthy()
  })

  it("still obeys the workout's media-off switch — a video eats more screen, not less", () => {
    setCoachMedia([ROW])
    mocks.S = { gifSize: 'off' }
    mount({ minimizable: true })
    expect(host.innerHTML).toBe('')
  })

  it('does not start buffering the video until the card is on screen', () => {
    const observers = stubIO(false)
    setCoachMedia([ROW])
    mount({})
    // The whole workout is mounted at once in list view; a 90 MB demo per exercise must not
    // start downloading because the member opened the session.
    expect(host.querySelector('video').paused).toBe(true)
    act(() => { observers[0].cb([{ isIntersecting: true }]) })
    expect(host.querySelector('video').paused).toBe(false)
  })

  it('believes the element over itself when the browser refuses to autoplay', async () => {
    stubIO()
    vi.spyOn(mediaProto, 'play').mockImplementation(() => Promise.reject(new Error('NotAllowedError')))
    setCoachMedia([ROW])
    await act(async () => { root.render(<Media ex={EX} />) })
    // Not "tap to pause" over a video that never moved — and so the FIRST tap starts it.
    expect(host.querySelector('.gifhint').textContent).toContain('tap to play')
  })

  it('follows the element when the browser stops the video on its own', () => {
    stubIO()
    setCoachMedia([ROW])
    mount({})
    expect(host.querySelector('.gifhint').textContent).toContain('tap to pause')
    act(() => { host.querySelector('video').pause() })
    expect(host.querySelector('.gifhint').textContent).toContain('tap to play')
  })

  it('keeps tap-to-pause working over the video', () => {
    setCoachMedia([ROW])
    mount({})
    expect(host.querySelector('.gifhint').textContent).toContain('tap to pause')
    act(() => { host.querySelector('.exmedia').click() })
    expect(host.querySelector('.gifhint').textContent).toContain('tap to play')
    // and the minimize control still does not toggle play/pause on its way past
    mount({ minimizable: true })
    act(() => { host.querySelector('.giftoggle').click() })
    expect(mocks.S.gifSize).toBe('mini')
  })
})

// One dropped request — a CDN hiccup, an expired session on a gated instance — is what puts a
// card on a fallback rung, and it is exactly the case a tap has always recovered from.
describe('Media recovery from a failed load', () => {
  it('retries the chain from a still that stood in for an animation that would not load', () => {
    mount({})
    act(() => { host.querySelector('img').dispatchEvent(new Event('error', { bubbles: true })) })
    expect(host.querySelector('.exmedia img').getAttribute('src')).toBe('img/bench.jpg')
    expect(host.querySelector('.gifhint').textContent).toContain('tap to retry')
    act(() => { host.querySelector('.exmedia').click() })
    expect(host.querySelector('.exmedia img').getAttribute('src')).toBe('gif/bench.gif')
  })

  it('retries from the dead tile as well', () => {
    mount({})
    act(() => { host.querySelector('img').dispatchEvent(new Event('error', { bubbles: true })) })
    act(() => { host.querySelector('img').dispatchEvent(new Event('error', { bubbles: true })) })
    expect(host.querySelector('.exmedia.broken .exmedia-x')).toBeTruthy()
    act(() => { host.querySelector('.exmedia').click() })
    expect(host.querySelector('.exmedia img').getAttribute('src')).toBe('gif/bench.gif')
  })

  it('does NOT retry from a working gif a broken coach video fell back to — that tap pauses', () => {
    stubIO()
    setCoachMedia([ROW])
    mount({})
    act(() => { host.querySelector('video').dispatchEvent(new Event('error', { bubbles: true })) })
    expect(host.querySelector('.exmedia img').getAttribute('src')).toBe('gif/bench.gif')
    expect(host.querySelector('.gifhint').textContent).toContain('tap to pause')
    act(() => { host.querySelector('.exmedia').click() })
    // paused on the still, not thrown back onto the video the browser could not decode
    expect(host.querySelector('.exmedia img').getAttribute('src')).toBe('img/bench.jpg')
    expect(host.querySelector('video')).toBeFalsy()
  })
})
