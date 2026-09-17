// Verifies the site-coach/ palette against WCAG 2.2 AA.
//
//   node scripts/check-site-coach-contrast.mjs
//
// Reads the token values straight out of site-coach/styles.css so the check can never drift
// from what actually ships: edit a hex in the stylesheet and this fails until the pairing is
// still sound. DESIGN.md documents the ratios; this is what proves them.
//
// Exits non-zero on any failing pair, so it can be wired into CI.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const cssPath = path.join(root, 'site-coach', 'styles.css')

const srgb = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const hex2rgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) }
const lum = h => { const [r, g, b] = hex2rgb(h).map(srgb); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

// Pull `--token: #hex;` pairs out of the stylesheet's :root block.
const css = fs.readFileSync(cssPath, 'utf8')
const P = {}
for (const m of css.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) P[m[1]] = m[2]

// fg, bg, what it is, minimum ratio
const PAIRS = [
  ['bone', 'graphite', 'body text on page ground', 4.5],
  ['bone', 'raised', 'body text on a card', 4.5],
  ['bone', 'ink', 'body text on deepest ground', 4.5],
  ['muted', 'graphite', 'secondary text on ground', 4.5],
  ['muted', 'raised', 'secondary text on a card', 4.5],
  ['gold', 'graphite', 'accent text on ground', 4.5],
  ['gold', 'ink', 'accent text on deepest ground', 4.5],
  ['gold', 'raised', 'accent text on a card', 4.5],
  ['gold-deep', 'bone', 'accent text on the light section', 4.5],
  ['ink', 'gold', 'button label on gold fill', 4.5],
  ['gold', 'ink', 'accent text on the inverted hover plate', 4.5],
  ['graphite', 'bone', 'text on the light section', 4.5],
  ['mute-bone', 'bone', 'secondary on the light section', 4.5],
  ['rule-strong', 'graphite', 'boundary rule on ground', 3],
  ['rule-strong', 'raised', 'boundary rule on a card', 3],
  ['bone', 'gold-deep', 'bone label on a deep-gold fill', 4.5],
]

// Pairings the design forbids. These MUST fail; if one starts passing the palette drifted and
// the rule in DESIGN.md is no longer earning its place.
const MUST_FAIL = [
  ['bone', 'gold', 'bone label on a gold fill (use --ink instead)', 4.5],
  ['gold', 'bone', 'gold accent inside the light section (use --gold-deep)', 4.5],
]

let bad = 0
console.log(`palette: ${Object.keys(P).length} tokens from site-coach/styles.css\n`)

for (const [fg, bg, label, min] of PAIRS) {
  if (!P[fg] || !P[bg]) { console.log(`MISSING  --${!P[fg] ? fg : bg} not found in styles.css`); bad++; continue }
  const r = ratio(P[fg], P[bg])
  const ok = r >= min
  if (!ok) bad++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (min ${min})  ${label}`)
}

console.log('')
for (const [fg, bg, label, min] of MUST_FAIL) {
  const r = ratio(P[fg], P[bg])
  const ok = r < min
  if (!ok) bad++
  console.log(`${ok ? 'OK  ' : 'DRIFT'}  ${r.toFixed(2).padStart(5)}:1  below ${min} as expected: ${label}`)
}

console.log(bad ? `\n${bad} problem(s).` : '\nAll pairs pass WCAG 2.2 AA.')
process.exit(bad ? 1 : 0)
