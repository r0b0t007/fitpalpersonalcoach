#!/usr/bin/env node
// Guards the one invariant every locale in src/locales/ shares: the same key set.
// English is the source language and has no locale file, so a key that exists in only
// some locales falls back to English silently, mid-sentence, with nothing failing
// anywhere. This catches that at review time instead of in the app.
//
//   node scripts/check-locales.mjs
//
// The reference is the union of all locales, not one blessed file: a key added to a
// single locale then flags the other ten instead of passing unnoticed.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const localesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'locales')
const files = readdirSync(localesDir).filter(f => f.endsWith('.js')).sort()

if (!files.length) {
  console.error(`No locale files found in ${localesDir}`)
  process.exit(1)
}

const locales = new Map()
for (const file of files) {
  const { default: dict } = await import(pathToFileURL(join(localesDir, file)).href)
  if (!dict || typeof dict !== 'object') {
    console.error(`${file}: no default-exported object`)
    process.exit(1)
  }
  locales.set(file.replace(/\.js$/, ''), new Set(Object.keys(dict)))
}

// How many locales carry each key — 1 means the key was added to a single file only,
// which is the usual shape of the bug and worth naming separately from plain gaps.
const seen = new Map()
for (const keys of locales.values()) for (const k of keys) seen.set(k, (seen.get(k) || 0) + 1)
const union = [...seen.keys()]

let failed = false

// A key written twice in one file is not an error to JavaScript: the later value silently
// wins, and nothing else here can see it, because the import above has already collapsed it.
// That is how the client tab came to read "Toi" when the line meant for it said "Profil".
// So read the source text as well.
const KEY = /^\s*(['"])((?:\\.|(?!\1).)*)\1\s*:/gm
for (const file of files) {
  const src = readFileSync(join(localesDir, file), 'utf8')
  const count = new Map()
  for (const m of src.matchAll(KEY)) count.set(m[2], (count.get(m[2]) || 0) + 1)
  const dupes = [...count].filter(([, n]) => n > 1)
  if (dupes.length) {
    failed = true
    console.error(`\n${file}: keys defined more than once (the last one wins)`)
    for (const [k, n] of dupes) console.error(`  ${n}x: ${JSON.stringify(k)}`)
  }
}

for (const [lang, keys] of locales) {
  const missing = union.filter(k => !keys.has(k))
  const orphans = union.filter(k => keys.has(k) && seen.get(k) === 1)
  if (missing.length || orphans.length) {
    failed = true
    console.error(`\n${lang}.js: ${keys.size}/${union.length} keys`)
    for (const k of missing) console.error(`  missing:   ${JSON.stringify(k)}`)
    for (const k of orphans) console.error(`  only here: ${JSON.stringify(k)}`)
  }
}

if (failed) {
  console.error('\nLocale key sets differ, or a key is defined twice. Every locale must carry the same keys, once.')
  process.exit(1)
}

console.log(`${locales.size} locales, ${union.length} keys each — in sync.`)
