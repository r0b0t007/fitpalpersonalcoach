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
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Keep in step with WGHT / WDTH in scripts/build-fonts.py.
const RANGE = { wght: [400, 800], wdth: [68, 100] }

const CSS = 'site-coach/styles.css'
const SITE = 'site-coach'

// Weights the browser applies on its own, with no declaration in the stylesheet.
const UA_DEFAULTS = [
  { value: 400, why: "CSS initial font-weight (body copy declares none)" },
  { value: 700, why: "UA default for h1-h6, b, strong, th" },
]

// Named keywords map onto the axes too, and are easy to reach for without thinking.
const WEIGHT_KEYWORDS = { bold: 700, normal: 400, lighter: 100, bolder: 900 }
const STRETCH_KEYWORDS = {
  'ultra-condensed': 50, 'extra-condensed': 62.5, condensed: 75, 'semi-condensed': 87.5,
  normal: 100, 'semi-expanded': 112.5, expanded: 125, 'extra-expanded': 150, 'ultra-expanded': 200,
}

const problems = []

const check = (axis, value, where) => {
  const [lo, hi] = RANGE[axis]
  if (value < lo || value > hi) {
    problems.push(`${axis} ${value} is outside the baked ${lo}-${hi} (${where}) - it will clamp`)
  }
}

// Every way a declaration can reach an axis. Quotes either way, the longhands, and the `font`
// shorthand - a guard that only knows one spelling passes the others silently, which is the
// exact failure this file exists to catch.
function scan (text, where) {
  // Strip comments first: styles.css documents rejected values in prose, and a commented-out
  // 'wght' 300 is not a shipped one.
  const live = text.replace(/\/\*[\s\S]*?\*\//g, '')

  for (const m of live.matchAll(/(['"])(wght|wdth)\1\s+(\d+(?:\.\d+)?)/g)) {
    check(m[2], Number(m[3]), `font-variation-settings in ${where}`)
  }

  for (const m of live.matchAll(/font-weight\s*:\s*([^;}"]+)/g)) {
    // @font-face declares the supported range ("400 800"); both ends are checked, which is
    // what we want - a face claiming more than it carries is the same bug.
    for (const tok of m[1].trim().split(/\s+/)) {
      if (/^\d+$/.test(tok)) check('wght', Number(tok), `font-weight in ${where}`)
      else if (tok in WEIGHT_KEYWORDS) check('wght', WEIGHT_KEYWORDS[tok], `font-weight: ${tok} in ${where}`)
    }
  }

  // font-stretch is the wdth axis by another name.
  for (const m of live.matchAll(/font-stretch\s*:\s*([^;}"]+)/g)) {
    // The @font-face descriptor declares the supported range and is not a usage site.
    const idx = m.index ?? 0
    const head = live.slice(Math.max(0, idx - 400), idx)
    if (/@font-face\s*\{[^}]*$/.test(head)) continue
    for (const tok of m[1].trim().split(/\s+/)) {
      const pct = /^(\d+(?:\.\d+)?)%$/.exec(tok)
      if (pct) check('wdth', Number(pct[1]), `font-stretch in ${where}`)
      else if (tok in STRETCH_KEYWORDS) check('wdth', STRETCH_KEYWORDS[tok], `font-stretch: ${tok} in ${where}`)
    }
  }

  // The shorthand: [style] [variant] [weight] [stretch] size[/line-height] family. Weight and
  // stretch can only appear before the size, so stop at the first token that is one.
  for (const m of live.matchAll(/(?:^|[;{\s"])font\s*:\s*([^;}"]+)/g)) {
    for (const tok of m[1].trim().split(/\s+/)) {
      if (/^[\d.]+(px|r?em|%|pt|vw|vh|ch|ex)?(\/|$)/.test(tok) && !/^\d+$/.test(tok)) break
      if (/^\d+$/.test(tok)) check('wght', Number(tok), `font shorthand in ${where}`)
      else if (tok in WEIGHT_KEYWORDS && tok !== 'normal') check('wght', WEIGHT_KEYWORDS[tok], `font: ${tok} in ${where}`)
      else if (tok in STRETCH_KEYWORDS && tok !== 'normal') check('wdth', STRETCH_KEYWORDS[tok], `font: ${tok} in ${where}`)
    }
  }
}

scan(readFileSync(CSS, 'utf8'), CSS)

// Inline styles and <style> blocks in the pages reach the same font.
const htmlFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? htmlFiles(join(dir, e.name)) : e.name.endsWith('.html') ? [join(dir, e.name)] : [])
for (const f of htmlFiles(SITE)) {
  const html = readFileSync(f, 'utf8')
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) scan(m[1], `<style> in ${f}`)
  for (const m of html.matchAll(/\sstyle="([^"]*)"/g)) scan(m[1], `style="" in ${f}`)
  for (const m of html.matchAll(/\sstyle='([^']*)'/g)) scan(m[1], `style='' in ${f}`)
}

for (const d of UA_DEFAULTS) check('wght', d.value, d.why)

if (problems.length) {
  console.error('  font axis check FAILED\n')
  for (const p of problems) console.error('    ' + p)
  console.error('\n  Either change the rule, or widen WGHT/WDTH in scripts/build-fonts.py,')
  console.error('  re-run it, and update RANGE at the top of this file to match.')
  process.exit(1)
}

console.log(`  font axes ok - every demanded value falls inside wght ${RANGE.wght.join('-')} / wdth ${RANGE.wdth.join('-')}`)
