import { BRAND, TAGLINE, GOLD } from '../lib/brand.js'

// The One Spine symbol (brand/logo-kit): an f and a p on one stem. This is the kit's "reversed"
// drawing, a touch lighter because the app's default ground is black, and the viewBox is cropped
// tight to the ink so the symbol sits flush against the name.
const SYMBOL = 'M48 89.3H89.2C89.2 52.3 119.2 22.3 156.1 22.3V61.5C140.8 61.5 128.3 73.9 128.3 89.3H154.1C183.7 89.3 207.6 113.2 207.6 142.8C207.6 172.4 183.7 196.4 154.1 196.4H128.3V229.3H89.2V122.2H48V89.3ZM128.3 122.2V163.4H150C161.3 163.4 170.6 154.2 170.6 142.8C170.6 131.4 161.3 122.2 150 122.2H128.3Z'

/**
 * FitPal Coach logo — the gold symbol, then "FitPal Coach", over a letter-spaced tagline.
 *
 * Mixed case, not upper: fitpal.ma writes the name "FitPal", and a wordmark that shouts a name
 * the rest of the brand doesn't is the tell of a rebrand done in a hurry. The symbol leads, as in
 * the kit's horizontal lockup, so "FitPal Coach" reads as one name.
 * Uses the brand's fixed gold, not the user accent: the logo is the one thing that
 * must not recolour when someone picks a different accent in Settings.
 *
 * `heading` makes the lockup the page's heading, as the entry screens (sign-in, start, link, the
 * mobile first launch) open with it: an <hgroup> whose <h1> is the name row and whose <p> is the
 * tagline. The heading is then read as the name alone, not "FitPal Coach PERSONAL COACHING", and
 * the tagline is still read, as the line under it. The symbol is aria-hidden.
 */
export default function Logo({ size = 34, subtitle = true, heading = false }) {
  const [Root, Name, Tag] = heading ? ['hgroup', 'h1', 'p'] : ['div', 'span', 'span']
  return (
    <Root style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: Math.round(size * .22),
      ...(heading && { margin: '10px 0 6px' }),
    }}>
      {/* At full size the row is too wide for a 320px phone (Login uses size 40), so it shrinks
          rather than overflowing — full `size` from 430px up, 75% of it at 320px, and never
          below 70%. Everything inside is in em so it all shrinks together: symbol 0.96em wide,
          a .3em gap, then the name. Checked to fit on one line at 320px and 375px; re-check
          there if `size`, the clamp or the gap changes. nowrap keeps symbol and name together.
          The symbol's width is explicit (viewBox 160×208 at 1.25em tall) rather than auto:
          older WebKit, including the iOS app's WebView, can size an auto-width SVG flex item
          to 300px or to nothing. */}
      <Name style={{
        display: 'flex', alignItems: 'center', gap: '.3em', color: GOLD, margin: 0,
        fontSize: `clamp(${(size * .7).toFixed(1)}px, ${(size / 4.4).toFixed(2)}vw + ${(size * .023).toFixed(2)}px, ${size}px)`,
        fontWeight: 800, letterSpacing: '.04em', lineHeight: 1, whiteSpace: 'nowrap', maxWidth: '100%',
      }}>
        <svg viewBox="48 22 160 208" aria-hidden="true" focusable="false"
          style={{ height: '1.25em', width: '.96em', flex: 'none' }}>
          <path fill="currentColor" fillRule="evenodd" d={SYMBOL} />
        </svg>
        <span>{BRAND}</span>
      </Name>
      {subtitle && (
        <Tag style={{
          margin: 0, fontSize: Math.max(10, Math.round(size * .3)), fontWeight: 500, color: 'var(--label)',
          letterSpacing: '.42em', textIndent: '.42em', textTransform: 'uppercase',
        }}>{TAGLINE}</Tag>
      )}
    </Root>
  )
}
