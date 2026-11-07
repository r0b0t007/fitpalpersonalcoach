// @vitest-environment happy-dom
//
// The link a coach shares to refer another coach (CHW-350): fitpal.ma's home on the production app,
// the instance's own sign-up anywhere else.
import { beforeEach, describe, expect, it, vi } from 'vitest'

let base = ''
vi.mock('./api.js', () => ({ serverBase: () => base }))
const { referralLink } = await import('./referrals.js')

const at = url => window.happyDOM.setURL(url)
beforeEach(() => { base = ''; at('http://localhost:3000/') })

describe('referralLink', () => {
  it("is the marketing home's ?ref= on the app served at coach.fitpal.ma", () => {
    at('https://coach.fitpal.ma/#/account')
    expect(referralLink('yasmine.fit')).toBe('https://fitpal.ma/?ref=yasmine.fit')
  })

  it('is that too for a paired mobile build pointed at coach.fitpal.ma', () => {
    at('capacitor://localhost/')
    base = 'https://coach.fitpal.ma'
    expect(referralLink('yasmine.fit')).toBe('https://fitpal.ma/?ref=yasmine.fit')
  })

  it("is the instance's own sign-up elsewhere, from where the app is served", () => {
    at('http://localhost:3000/#/account')
    expect(referralLink('yasmine.fit')).toBe('http://localhost:3000/#/start?plan=free&ref=yasmine.fit')
    at('https://staging.example.com/coach/?x=1#/clients')
    expect(referralLink('yasmine.fit')).toBe('https://staging.example.com/coach/#/start?plan=free&ref=yasmine.fit')
  })

  it("is the paired server's sign-up on a mobile build, not the WebView's origin", () => {
    at('capacitor://localhost/')
    base = 'https://coach.example.com'
    expect(referralLink('yasmine.fit')).toBe('https://coach.example.com/#/start?plan=free&ref=yasmine.fit')
  })
})
