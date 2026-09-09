// @vitest-environment happy-dom
//
// Segmented parks its selection pill with `--i` and paints it with a separate `.seg-sel` span.
// It used to clamp the index to 0, so a value matching no option drew the pill on the first one:
// the control claimed a selection the caller had not made. Every existing caller holds a value
// that is always in its options, which is why this survived — the weekly check-in is the first
// place a scale can legitimately be unanswered, and it rendered five untouched rows as if the
// client had rated their whole week 1 out of 5.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Segmented } from './ui.jsx'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

const OPTIONS = [1, 2, 3, 4, 5].map(n => ({ value: n, label: String(n) }))

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

const render = value => {
  act(() => root.render(<Segmented options={OPTIONS} value={value} onChange={() => {}} />))
  return host
}

describe('Segmented', () => {
  // One case per value, not a loop: when this fails it has to say *which* value regressed, and
  // four iterations of one assertion all report the same line.
  for (const [name, value] of [['null', null], ['undefined', undefined], ['zero', 0], ['out of range', 9]]) {
    it(`draws no pill for a value that matches no option (${name})`, () => {
      render(value)
      expect(host.querySelector('.seg-sel')).toBeNull()
      expect(host.querySelectorAll('button.on')).toHaveLength(0)
      expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0)
    })
  }

  it('draws the pill on the matching option', () => {
    render(3)
    expect(host.querySelector('.seg-sel')).not.toBeNull()
    expect(host.querySelector('.seg').style.getPropertyValue('--i')).toBe('2')
    expect(host.querySelector('button.on').textContent).toBe('3')
  })

  it('still positions the first option correctly', () => {
    // The clamp is what used to hide this: index 0 and "no match" produced identical markup.
    render(1)
    expect(host.querySelector('.seg-sel')).not.toBeNull()
    expect(host.querySelector('.seg').style.getPropertyValue('--i')).toBe('0')
  })

  it('appears when a value is chosen, without remounting the buttons', () => {
    // The pill is its own child slot ahead of the keyed options array, so toggling it must not
    // remount them — otherwise the tap that makes the first selection loses focus under itself.
    render(null)
    const before = host.querySelector('button')
    render(2)
    expect(host.querySelector('button')).toBe(before)
    expect(host.querySelector('.seg-sel')).not.toBeNull()
  })
})
