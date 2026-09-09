import Icon from './Icon.jsx'
import { TAGLINE, GOLD } from '../lib/brand.js'

/**
 * FitPal Coach wordmark — gold "FitPal ⚡ Coach" over a letter-spaced tagline.
 *
 * Mixed case, not upper: fitpal.ma writes the name "FitPal", and a wordmark that shouts a name
 * the rest of the brand doesn't is the tell of a rebrand done in a hurry. The bolt separates
 * product from sub-brand rather than splitting one word, which is why "FitPal" stays whole.
 * Uses the brand's fixed gold, not the user accent: the logo is the one thing that
 * must not recolour when someone picks a different accent in Settings.
 */
export default function Logo({ size = 34, subtitle = true }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(size * .22) }}>
      {/* "FitPal Coach" is nearly twice the glyphs of the wordmark this replaced: measured at
          292px wide at size 40, which overflows a 320px phone. So it shrinks rather than
          overflowing — full `size` from 430px up, 75% of it at 320px, and never below 70%.
          nowrap stops it breaking across the bolt, which would look like two logos. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: Math.round(size * .1), color: GOLD,
        fontSize: `clamp(${(size * .7).toFixed(1)}px, ${(size / 4.4).toFixed(2)}vw + ${(size * .023).toFixed(2)}px, ${size}px)`,
        fontWeight: 800, letterSpacing: '.04em', lineHeight: 1, whiteSpace: 'nowrap', maxWidth: '100%',
      }}>
        <span>FitPal</span>
        <Icon name="bolt" style={{ fontSize: Math.round(size * .92), '--icon-stroke': 2.2 }} />
        <span>Coach</span>
      </div>
      {subtitle && (
        <div style={{
          fontSize: Math.max(10, Math.round(size * .3)), fontWeight: 500, color: 'var(--label)',
          letterSpacing: '.42em', textIndent: '.42em', textTransform: 'uppercase',
        }}>{TAGLINE}</div>
      )}
    </div>
  )
}
