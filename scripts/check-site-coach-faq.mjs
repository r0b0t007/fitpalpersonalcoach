// Fail if a page's FAQPage JSON-LD differs from the FAQ a visitor actually sees.
//
//   node scripts/check-site-coach-faq.mjs
//
// Each question and answer lives twice per page: once in the visible <details> list and once
// in the structured data. Google's guidelines require the two to match, and a mismatch is
// grounds for a manual action - but nothing renders the JSON-LD, so an edit to a visible
// answer that forgets its copy looks fine to everyone. This compares them, in order.
import { readFileSync } from 'node:fs'

const PAGES = ['site-coach/index.html', 'site-coach/en/index.html']

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

// Visible text as a reader gets it: tags dropped, entities decoded, whitespace collapsed.
const text = (html) => html
  .replace(/<[^>]+>/g, '')
  .replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m)
  .replace(/\s+/g, ' ')
  .trim()

const problems = []

for (const page of PAGES) {
  const html = readFileSync(page, 'utf8')

  const visible = [...html.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)]
    .map((m) => ({ q: text(m[1]), a: text(m[2]) }))

  const graph = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .flatMap((m) => { const j = JSON.parse(m[1]); return j['@graph'] ?? [j] })
  const faq = graph.find((n) => n['@type'] === 'FAQPage')

  if (!faq) {
    if (visible.length) problems.push(`${page}: ${visible.length} visible FAQ entries but no FAQPage JSON-LD`)
    continue
  }

  const marked = (faq.mainEntity ?? []).map((e) => ({ q: text(e.name ?? ''), a: text(e.acceptedAnswer?.text ?? '') }))

  if (marked.length !== visible.length) {
    problems.push(`${page}: ${visible.length} visible FAQ entries, ${marked.length} in FAQPage`)
  }
  for (let i = 0; i < Math.min(marked.length, visible.length); i++) {
    if (marked[i].q !== visible[i].q) problems.push(`${page}: question ${i + 1} differs\n      visible: ${visible[i].q}\n      JSON-LD: ${marked[i].q}`)
    if (marked[i].a !== visible[i].a) problems.push(`${page}: answer ${i + 1} differs\n      visible: ${visible[i].a}\n      JSON-LD: ${marked[i].a}`)
  }
}

if (problems.length) {
  console.error('  FAQ structured data check FAILED\n')
  for (const p of problems) console.error('    ' + p)
  console.error('\n  Edit the visible FAQ and the FAQPage JSON-LD together.')
  process.exit(1)
}

console.log(`  FAQ structured data matches the visible FAQ on ${PAGES.length} pages`)
