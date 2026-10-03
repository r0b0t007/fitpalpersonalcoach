// Summarise one or more Lighthouse JSON reports into the numbers the perf work is judged on,
// taking the MEDIAN across runs. A single run on a busy laptop is noise; a 2x swing between
// runs is normal, so never quote a one-run figure as a result.
//
// Lighthouse itself is driven from the shell (npx), not from here: Node on Windows refuses to
// spawnSync a .cmd shim (EINVAL) since the CVE-2024-27980 hardening.
//
//   node scripts/perf-report.mjs <label> <report.json...>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const [label, ...files] = process.argv.slice(2)
if (!label || !files.length) {
  console.error('usage: perf-report.mjs <label> <report.json...>')
  process.exit(1)
}

const results = []
for (const f of files) {
  let r
  try { r = JSON.parse(readFileSync(f, 'utf8')) } catch { continue }
  if (!r.audits || !r.categories?.performance) continue
  const a = r.audits
  const num = (k) => (a[k] && typeof a[k].numericValue === 'number' ? a[k].numericValue : null)
  results.push({
    score: Math.round((r.categories.performance.score || 0) * 100),
    fcp: num('first-contentful-paint'),
    lcp: num('largest-contentful-paint'),
    tbt: num('total-blocking-time'),
    cls: num('cumulative-layout-shift'),
    si: num('speed-index'),
    bytes: num('total-byte-weight'),
    lcpEl: a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet || '',
    blocking: (a['render-blocking-resources']?.details?.items || []).map((x) => ({
      url: String(x.url).replace(/^https?:\/\/[^/]+/, ''),
      ms: Math.round(x.wastedMs || 0),
    })),
    shiftEls: (a['layout-shift-elements']?.details?.items || []).map(
      (x) => `${x.node?.snippet?.slice(0, 60) || '?'} (${(x.score ?? 0).toFixed(4)})`
    ),
    requests: (a['network-requests']?.details?.items || []).map((x) => ({
      url: String(x.url).replace(/^https?:\/\/[^/]+/, ''),
      bytes: x.transferSize || 0,
      type: x.resourceType || '',
    })),
  })
}

if (!results.length) { console.error('  no usable reports'); process.exit(1) }

const median = (xs) => {
  const v = xs.filter((x) => x != null).sort((a, b) => a - b)
  if (!v.length) return null
  return v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2
}

const m = {
  label,
  runs: results.length,
  score: median(results.map((r) => r.score)),
  fcp: median(results.map((r) => r.fcp)),
  lcp: median(results.map((r) => r.lcp)),
  tbt: median(results.map((r) => r.tbt)),
  cls: median(results.map((r) => r.cls)),
  si: median(results.map((r) => r.si)),
  bytes: median(results.map((r) => r.bytes)),
  lcpEl: results[0].lcpEl,
  blocking: results[0].blocking,
  shiftEls: results[0].shiftEls,
  requests: results[0].requests,
}

mkdirSync('.perf', { recursive: true })
writeFileSync(`.perf/${label}.summary.json`, JSON.stringify(m, null, 2))

const s = (ms) => (ms == null ? '  n/a' : (ms / 1000).toFixed(2) + 's')
console.log(`\n  ${label}  (median of ${m.runs} run${m.runs > 1 ? 's' : ''})`)
console.log(`    score  ${m.score}`)
console.log(`    FCP    ${s(m.fcp)}`)
console.log(`    LCP    ${s(m.lcp)}`)
console.log(`    TBT    ${m.tbt == null ? 'n/a' : Math.round(m.tbt) + 'ms'}`)
console.log(`    CLS    ${m.cls == null ? 'n/a' : m.cls.toFixed(4)}`)
console.log(`    SI     ${s(m.si)}`)
console.log(`    bytes  ${m.bytes == null ? 'n/a' : (m.bytes / 1024).toFixed(0) + ' KiB'}`)
if (m.lcpEl) console.log(`    LCP el ${m.lcpEl.slice(0, 100)}`)
console.log(`    shifting elements: ${m.shiftEls.length ? m.shiftEls.join(', ') : 'none'}`)
if (m.blocking.length) {
  console.log('    render-blocking:')
  for (const b of m.blocking) console.log(`      ${String(b.ms).padStart(5)}ms  ${b.url.slice(0, 78)}`)
} else {
  console.log('    render-blocking: none')
}
const top = m.requests.filter((r) => r.bytes > 20000).sort((a, b) => b.bytes - a.bytes).slice(0, 8)
if (top.length) {
  console.log('    heaviest requests:')
  for (const r of top) console.log(`      ${(r.bytes / 1024).toFixed(0).padStart(6)} KiB  ${r.type.padEnd(10)} ${r.url.slice(0, 60)}`)
}
