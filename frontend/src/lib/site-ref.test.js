// @vitest-environment happy-dom
//
// fitpal.ma's site.js carries a referral link's ?ref= onto the sign-up and language links (CHW-350),
// in the URLs only: nothing is stored on the visitor's device.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(resolve(__dirname, '../../../site-coach/site.js'), 'utf8')
const page = search => {
  history.replaceState(null, '', '/' + search)
  document.body.innerHTML = `
    <a id="free" href="https://coach.fitpal.ma/#/start?plan=free">Start</a>
    <a id="solo" href="https://coach.fitpal.ma/#/start?plan=solo&amp;period=month">Solo</a>
    <a id="en" class="lang" href="/en/" hreflang="en" lang="en">EN</a>
    <a id="legal" href="/mentions-legales">Legal</a>`
  new Function(SRC)()
  const href = id => document.getElementById(id).getAttribute('href')
  return { href, stored: localStorage.length + sessionStorage.length + document.cookie.length }
}

describe('site.js and a referral link', () => {
  it('carries a valid ref onto the sign-up links and the language switcher, and stores nothing', () => {
    const p = page('?ref=Yasmine.Fit')
    expect(p.href('free')).toBe('https://coach.fitpal.ma/#/start?plan=free&ref=yasmine.fit')
    expect(p.href('solo')).toBe('https://coach.fitpal.ma/#/start?plan=solo&period=month&ref=yasmine.fit')
    expect(p.href('en')).toBe('/en/?ref=yasmine.fit')
    expect(p.href('legal')).toBe('/mentions-legales')
    expect(p.stored).toBe(0)
  })

  it('leaves every link alone without a ref, or with one that is no handle', () => {
    for (const search of ['', '?ref=', '?ref=..x', '?ref=%E0%A4%A', '?ref=a"b']) {
      const p = page(search)
      expect(p.href('free')).toBe('https://coach.fitpal.ma/#/start?plan=free')
      expect(p.href('en')).toBe('/en/')
    }
  })
})
