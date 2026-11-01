// @vitest-environment happy-dom
//
// CHW-332: the "open in Safari/Chrome" card, inside Instagram's browser only, with the link each
// platform needs, and gone for this visit after "Not now".
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import OpenInBrowser from './OpenInBrowser.jsx'

const IG_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.40.92'
const IG_ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0 Mobile Safari/537.36 Instagram 330.0.0.40.92 Android'
const SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

let UA = ''
Object.defineProperty(navigator, 'userAgent', { get: () => UA, configurable: true })

let host, root
const render = el => act(() => root.render(el))
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  sessionStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove() })

describe('OpenInBrowser', () => {
  it('offers Safari inside Instagram on an iPhone, aimed at the public page', () => {
    UA = IG_IOS
    render(<OpenInBrowser path="/c/sara.fit" />)
    expect(host.textContent).toContain('You are in Instagram’s browser')
    expect(host.textContent).toContain('You can carry on here')
    const a = host.querySelector('a')
    expect(a.textContent).toBe('Open in Safari')
    expect(a.getAttribute('href')).toBe('x-safari-' + window.location.origin + '/c/sara.fit')
    expect(host.textContent).toContain('If nothing happens: tap ··· in the corner')
  })

  it('keeps this page\'s own address by default, so an invite link keeps its code', () => {
    UA = IG_IOS
    window.history.replaceState(null, '', '/?invite=ABC123')
    render(<OpenInBrowser />)
    expect(host.querySelector('a').getAttribute('href')).toBe('x-safari-' + window.location.origin + '/?invite=ABC123')
    window.history.replaceState(null, '', '/')
  })

  it('says to go, not to stay, where the email code is not offered', () => {
    UA = IG_IOS
    render(<OpenInBrowser canStay={false} />)
    expect(host.textContent).toContain('Signing in works in Safari, not in here')
    expect(host.textContent).not.toContain('Not now')
  })

  it('names no browser that is not there, outside a phone', () => {
    UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) [FBAN/EMA;FBAV/460.0]'
    render(<OpenInBrowser />)
    expect(host.textContent).toContain('In your browser you can also add the app')
    expect(host.textContent).not.toContain('Safari')
    expect(host.querySelector('a')).toBe(null)
    expect(host.textContent).toContain('Tap ··· in the corner')
  })

  it('offers Chrome by an intent on Android', () => {
    UA = IG_ANDROID
    render(<OpenInBrowser />)
    const a = host.querySelector('a')
    expect(a.textContent).toBe('Open in Chrome')
    expect(a.getAttribute('href')).toMatch(/^intent:\/\/.+#Intent;scheme=https?;package=com\.android\.chrome;S\.browser_fallback_url=.+;end$/)
    expect(host.textContent).toContain('tap ⋮ in the corner')   // Android's menu, not iOS's
  })

  it('shows nothing in a real browser', () => {
    UA = SAFARI
    render(<OpenInBrowser />)
    expect(host.textContent).toBe('')
  })

  it('goes for the rest of the visit after "Not now"', () => {
    UA = IG_IOS
    render(<OpenInBrowser />)
    act(() => { [...host.querySelectorAll('button')].find(b => b.textContent === 'Not now').click() })
    expect(host.textContent).toBe('')
    act(() => root.unmount())
    root = createRoot(host)
    render(<OpenInBrowser />)
    expect(host.textContent).toBe('')
  })
})
