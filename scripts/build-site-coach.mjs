// Build site-coach/ into dist/site-coach/ for deployment.
//
//   node scripts/build-site-coach.mjs
//
// site-coach/ stays the authored source: readable, heavily commented, openable straight from
// disk. This produces the thing visitors actually get.
//
// What it does and why:
//
//   minify css/js    styles.css is 48% comment by weight, and those comments are the design
//                    documentation - they belong in source and nowhere near the wire. esbuild
//                    does the minifying; a regex CSS minifier is a bug farm.
//
//   content hashing  styles.css?v=15 becomes styles.<hash>.css, and every font under fonts/
//                    becomes <name>.<hash>.woff2. A query string is NOT a safe cache key for
//                    `immutable`: some intermediaries ignore it, and `immutable` promises the
//                    bytes at a URL never change. Hashing the filename makes that promise true,
//                    which is what lets _headers hand out a year.
//
//   FAQPage          generated from each page's visible <details> FAQ and added to its JSON-LD,
//                    so the structured data cannot disagree with what a visitor reads.
//
//   _headers rewrite the cache block is generated here rather than hand-written, so the
//                    hashed filenames in it can never drift from the ones in the HTML.
//
// img/ and assets/ are NOT hashed, and so are NOT immutable. build-images.py rewrites posters
// in place, the promo videos have been re-encoded in place, and og-*.png is linked by absolute
// URL from outside this site (site/ and every social card already scraped), so renaming those
// would break links we do not control. They get a day plus stale-while-revalidate instead: a
// changed file reaches a returning visitor within a day, and the revalidation is a cheap 304.
//
// Everything else is copied byte for byte.
import { readFile, writeFile, mkdir, rm, readdir, stat, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, relative, dirname, extname } from 'node:path'
import { execFileSync } from 'node:child_process'

const SRC = 'site-coach'
const OUT = join('dist', 'site-coach')

// Pinned: npx with no version takes whatever is newest on npm at deploy time, so two builds of
// one commit could differ and a bad publish would ship straight to fitpal.ma unreviewed. Bump
// this deliberately and look at the size line the build prints.
const ESBUILD = 'esbuild@0.28.2'

const hash8 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 8)

const withHash = (name, h) => {
  const ext = extname(name)
  return `${name.slice(0, -ext.length)}.${h}${ext}`
}

async function walk (dir, acc = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, acc)
    else acc.push(p)
  }
  return acc
}

// esbuild is invoked through the shell: Node on Windows refuses to spawn a .cmd shim directly
// (EINVAL) since the CVE-2024-27980 hardening, and npx resolves to one.
// Fed on stdin so the CSS can have its font URLs rewritten first, which is also the one case
// where esbuild accepts an explicit --loader.
function minify (source, loader) {
  return execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--yes', ESBUILD, '--minify', `--loader=${loader}`],
    // input as a Buffer: `encoding` also applies to a string input, and 'buffer' is not one.
    { input: Buffer.from(source), encoding: 'buffer', shell: process.platform === 'win32', maxBuffer: 32 * 1024 * 1024 }
  )
}

const kib = (n) => (n / 1024).toFixed(1).padStart(6) + ' KiB'

async function main () {
  await rm(OUT, { recursive: true, force: true })
  await mkdir(OUT, { recursive: true })

  const files = await walk(SRC)

  // 1. Fonts first, because the stylesheet names them and its own hash must cover the
  //    rewritten URLs. `fonts/<name>` -> `fonts/<built>`, matched with the directory so
  //    archivo-latin.woff2 can never hit inside archivo-latin-ext.woff2.
  const fontRefs = {} // "fonts/archivo-latin.woff2" -> "fonts/archivo-latin.<hash>.woff2"
  await mkdir(join(OUT, 'fonts'), { recursive: true })
  for (const f of files) {
    const rel = relative(SRC, f).split(/[/\\]/).join('/')
    if (!rel.startsWith('fonts/') || !rel.endsWith('.woff2')) continue
    const built = withHash(rel.slice('fonts/'.length), hash8(await readFile(f)))
    await copyFile(f, join(OUT, 'fonts', built))
    fontRefs[rel] = `fonts/${built}`
    console.log(`  ${rel.padEnd(28)} -> fonts/${built}`)
  }
  const rewriteFonts = (text) => {
    for (const [from, to] of Object.entries(fontRefs)) text = text.split(from).join(to)
    return text
  }

  // 2. Hash and minify the two assets every page references.
  const hashed = {} // source basename -> built basename
  for (const [name, loader] of [['styles.css', 'css'], ['site.js', 'js']]) {
    const src = join(SRC, name)
    try { await stat(src) } catch { continue }
    const raw = await readFile(src, 'utf8')
    const min = minify(loader === 'css' ? rewriteFonts(raw) : raw, loader)
    const built = withHash(name, hash8(min))
    await writeFile(join(OUT, built), min)
    hashed[name] = built
    console.log(`  ${name.padEnd(12)} ${kib(Buffer.byteLength(raw))} -> ${kib(min.length)}  ${built}`)
  }
  if (Object.keys(fontRefs).length) {
    const css = await readFile(join(OUT, hashed['styles.css']), 'utf8')
    for (const to of Object.values(fontRefs)) {
      if (!css.includes(to)) throw new Error(`built stylesheet does not reference ${to}`)
    }
  }

  // 3. Copy everything else, rewriting HTML references and _headers as we go.
  let copied = 0
  for (const f of files) {
    const rel = relative(SRC, f)
    const relPosix = rel.split(/[/\\]/).join('/')
    const base = relPosix.split('/').pop()
    if (hashed[base] && !relPosix.includes('/')) continue // originals not shipped
    if (fontRefs[relPosix]) continue // shipped under the hashed name in step 1
    if (base === 'METRICS.txt') continue // build provenance, not a web asset
    if (relPosix === 'README.md') continue // maintainer notes; the deploy root is public

    const dest = join(OUT, rel)
    await mkdir(dirname(dest), { recursive: true })

    if (rel.endsWith('.html')) {
      let html = rewriteFonts(await readFile(f, 'utf8')) // the <link rel=preload> for the font
      for (const [name, built] of Object.entries(hashed)) {
        // Matches "styles.css?v=15", "../styles.css?v=15" and "/styles.css?v=15" alike,
        // preserving whatever prefix the page used.
        const ext = extname(name)
        const stem = name.slice(0, -ext.length)
        html = html.replace(
          new RegExp(`((?:\\.\\./|/)?)${stem}\\${ext}(\\?v=\\d+)?`, 'g'),
          (_m, prefix) => `${prefix}${built}`
        )
      }
      html = addFaqPage(html, relPosix)
      await writeFile(dest, html)
    } else if (base === '_headers') {
      await writeFile(dest, rewriteHeaders(await readFile(f, 'utf8'), hashed))
    } else {
      await copyFile(f, dest)
      copied++
    }
  }

  console.log(`\n  copied ${copied} other files -> ${OUT}`)
}

// The FAQPage structured data is generated here from the visible FAQ, never written by hand.
// Google requires the two to match, and a hand-kept copy drifts the first time someone edits
// an answer in one place and not the other - nothing renders JSON-LD, so nobody would see it.
// Generating it makes that drift impossible. Every page is handled, not a fixed list, so a
// future locale with a FAQ is covered without touching this.
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c', laquo: '\u00ab', raquo: '\u00bb',
  hellip: '\u2026', mdash: '\u2014', ndash: '\u2013', middot: '\u00b7', euro: '\u20ac', thinsp: '\u2009',
  eacute: '\u00e9', egrave: '\u00e8', ecirc: '\u00ea', agrave: '\u00e0', acirc: '\u00e2', ccedil: '\u00e7',
  ocirc: '\u00f4', ucirc: '\u00fb', ugrave: '\u00f9', icirc: '\u00ee', iuml: '\u00ef', euml: '\u00eb',
  auml: '\u00e4', ouml: '\u00f6', uuml: '\u00fc', szlig: '\u00df', ntilde: '\u00f1', oelig: '\u0153',
}

function plainText (html, where) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
      if (e in ENTITIES) return ENTITIES[e]
      // Fail loudly rather than ship "&foo;" as literal text in the structured data.
      throw new Error(`${where}: unknown HTML entity ${m} in the FAQ - add it to ENTITIES`)
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function addFaqPage (html, where) {
  const entries = [...html.matchAll(/<details[^>]*>\s*<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g)]
  if (!entries.length) return html

  const ldRe = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/
  const m = ldRe.exec(html)
  if (!m) throw new Error(`${where}: has a FAQ but no JSON-LD block to add the FAQPage to`)
  const ld = JSON.parse(m[2])
  const graph = ld['@graph'] ?? [ld]
  if (graph.some((n) => n['@type'] === 'FAQPage')) {
    throw new Error(`${where}: FAQPage is generated by the build - delete the hand-written one`)
  }

  graph.push({
    '@type': 'FAQPage',
    mainEntity: entries.map(([, q, a]) => ({
      '@type': 'Question',
      name: plainText(q, where),
      acceptedAnswer: { '@type': 'Answer', text: plainText(a, where) },
    })),
  })
  const out = ld['@graph'] ? ld : { '@context': ld['@context'], '@graph': graph }

  // `<` escaped so no answer text can ever close the <script> element early.
  const json = JSON.stringify(out).replace(/</g, '\\u003c')
  return html.replace(ldRe, (_all, open, _body, close) => open + json + close)
}

// Path rules this script owns. Any hand-written block for one of these in the source _headers
// is dropped and regenerated, whatever header lines it carries.
const MANAGED = new Set(['/styles.css', '/site.js', '/fonts/*', '/img/*', '/assets/*'])

function rewriteHeaders (text, hashed) {
  // CRLF-tolerant: a Windows checkout with core.autocrlf=true hands us \r\n, and a parser that
  // only knows \n would silently keep the old rules beside the new ones - Pages then merges the
  // two Cache-Control values into one contradictory header.
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const kept = []
  let skipping = false
  for (const line of lines) {
    // Only a path line opens or closes a block. A comment or a blank line between a managed
    // path and its header lines must not end the skip, or those header lines would survive
    // with their path line removed and attach to whatever rule precedes them.
    if (/^#/.test(line)) { kept.push(line); continue }
    if (/^\S/.test(line)) skipping = MANAGED.has(line.trim())
    if (!skipping) kept.push(line)
  }
  const out = kept.join('\n')

  for (const line of out.split('\n')) {
    if (MANAGED.has(line.trim())) throw new Error(`_headers still carries a rule for ${line.trim()}`)
  }

  const YEAR = '  Cache-Control: public, max-age=31536000, immutable'
  const DAY = '  Cache-Control: public, max-age=86400, stale-while-revalidate=604800'
  const block = [
    '',
    '# Generated by scripts/build-site-coach.mjs - edit the script, not this block.',
    '#',
    '# A year plus immutable only where the URL is content-addressed: the CSS, the JS and the',
    '# fonts all carry a hash of their own bytes in the filename. img/ and assets/ do not - their',
    '# files are rewritten in place under the same name - so they get a day plus',
    '# stale-while-revalidate. Never mark an un-hashed path immutable.',
    ...Object.values(hashed).flatMap((built) => [`/${built}`, YEAR]),
    '',
    '/fonts/*',
    YEAR,
    '',
    '/img/*',
    DAY,
    '',
    '/assets/*',
    DAY,
    '',
  ].join('\n')

  return out.trimEnd() + '\n' + block
}

main().catch((e) => { console.error(e); process.exit(1) })
