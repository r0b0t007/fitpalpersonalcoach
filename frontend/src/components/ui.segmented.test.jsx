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
import { describe, expect, it } from 'vitest'
import { Segmented } from './ui.jsx'

const OPTIONS = [1, 2, 3, 4, 5].map(n => ({ value: n, label: String(n) }))

const render = value => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  act(() => {
    createRoot(host).render(<Segmented options={OPTIONS} value={value} onChange={() => {}} />)
  })
  return host
}

describe('Segmented', () => {
  it('draws no pill when the value matches no option', () => {
    for (const v of [null, undefined, 0, 9]) {
      const host = render(v)
      expect(host.querySelector('.seg-sel')).toBeNull()
      expect(host.querySelectorAll('button.on')).toHaveLength(0)
      expect(host.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0)
    }
  })

  it('draws the pill on the matching option', () => {
    const host = render(3)
    expect(host.querySelector('.seg-sel')).not.toBeNull()
    expect(host.querySelector('.seg').style.getPropertyValue('--i')).toBe('2')
    expect(host.querySelector('button.on').textContent).toBe('3')
  })

  it('still positions the first option correctly', () => {
    // The clamp is what used to hide this: index 0 and "no match" produced identical markup.
    const host = render(1)
    expect(host.querySelector('.seg-sel')).not.toBeNull()
    expect(host.querySelector('.seg').style.getPropertyValue('--i')).toBe('0')
  })
})
