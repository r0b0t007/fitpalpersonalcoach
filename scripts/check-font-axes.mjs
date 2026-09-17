// Fail if site-coach/styles.css asks Archivo for a weight or width outside the range baked
// into the self-hosted font by scripts/build-fonts.py.
//
//   node scripts/check-font-axes.mjs
//
// This exists because the failure it catches is silent. The shipped font is a partial instance
// (wght 400-800, wdth 68-100) rather than the 100-900 / 62-125 Google serves. Ask it for
// `'wght' 300` and nothing errors: the browser clamps to 400 and the text just renders wrong,
// on production, in a way no test and no contrast check would notice.
//
// It already caught one real bug. The first cut of the subset used a 500 floor, taken from the
// lowest weight this stylesheet names. Body copy declares no font-weight at all, so it resolves
// to the CSS initial value of 400 - every paragraph on the site would have shipped a step
// heavier than designed.
//
// That is also why UA_DEFAULTS is here: the weights a page uses are not only the ones its CSS
// writes down.
import { readFileSync } from 'node:fs'

// Keep in step with WGHT / WDTH in scripts/build-fonts.py.
const RANGE = { wght: [400, 800], wdth: [68, 100] }

const CSS = 'site-coach/styles.css'

// Weights the browser applies on its own, with no declaration in the stylesheet.
const UA_DEFAULTS = [
  { value: 400, why: "CSS initial font-weight (body copy declares none)" },
  { value: 700, why: "UA default for h1-h6, b, strong, th" },
]

const css = readFileSync(CSS, 'utf8')
// Strip comments first: this file documents rejected values in prose, and a commented-out
// 'wght' 300 is not a shipped one.
const live = css.replace(/\/\*[\s\S]*?\*\//g, '')

const problems = []

const check = (axis, value, where) => {
  const [lo, hi] = RANGE[axis]
  if (value < lo || value > hi) {
    problems.push(`${axis} ${value} is outside the baked ${lo}-${hi} (${where}) - it will clamp`)
  }
}

for (const m of live.matchAll(/'(wght|wdth)'\s+(\d+(?:\.\d+)?)/g)) {
  check(m[1], Number(m[2]), `font-variation-settings in ${CSS}`)
}

for (const m of live.matchAll(/font-weight:\s*(\d+)/g)) {
  check('wght', Number(m[1]), `font-weight in ${CSS}`)
}

// font-stretch is the wdth axis by another name.
for (const m of live.matchAll(/font-stretch:\s*(\d+(?:\.\d+)?)%/g)) {
  // The @font-face descriptor declares the supported range and is not a usage site.
  const idx = m.index ?? 0
  const head = live.slice(Math.max(0, idx - 400), idx)
  if (/@font-face\s*\{[^}]*$/.test(head)) continue
  check('wdth', Number(m[1]), `font-stretch in ${CSS}`)
}

for (const d of UA_DEFAULTS) check('wght', d.value, d.why)

// Named keywords map onto the axis too, and are easy to reach for without thinking.
const KEYWORDS = { bold: 700, normal: 400, lighter: 100, bolder: 900 }
for (const m of live.matchAll(/font-weight:\s*([a-z]+)/g)) {
  const v = KEYWORDS[m[1]]
  if (v === undefined) continue // inherit / initial / unset carry no fixed value
  check('wght', v, `font-weight: ${m[1]} in ${CSS}`)
}

if (problems.length) {
  console.error('  font axis check FAILED\n')
  for (const p of problems) console.error('    ' + p)
  console.error('\n  Either change the rule, or widen WGHT/WDTH in scripts/build-fonts.py,')
  console.error('  re-run it, and update RANGE at the top of this file to match.')
  process.exit(1)
}

console.log(`  font axes ok - every demanded value falls inside wght ${RANGE.wght.join('-')} / wdth ${RANGE.wdth.join('-')}`)
