import Icon from './Icon.jsx'
import { TAGLINE, GOLD } from '../lib/brand.js'

/**
 * FIT'ONE wordmark — gold "FIT ⚡ ONE" over a letter-spaced "CLUB FITNESS" subtitle.
 * Uses the brand's fixed gold, not the user accent: the logo is the one thing that
 * must not recolour when someone picks a different accent in Settings.
 */
export default function Logo({ size = 34, subtitle = true }) {
  return (
    // `latin` keeps the RTL tracking reset off the wordmark and tagline: the brand reads
    // the same in every language, and the tagline's text-indent only cancels out while its
    // letter-spacing survives. Covers the subtree, so neither child needs marking.
    <div className="latin" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(size * .22) }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: Math.round(size * .1), color: GOLD,
        fontSize: size, fontWeight: 800, letterSpacing: '.04em', lineHeight: 1,
      }}>
        <span>FIT</span>
        <Icon name="bolt" style={{ fontSize: Math.round(size * .92), '--icon-stroke': 2.2 }} />
        <span>ONE</span>
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
