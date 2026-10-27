#!/usr/bin/env node
// `npm run build:mobile`: the mobile bundle, then `cap sync` into android/ and ios/.
//
// A script rather than `VITE_MOBILE=1 … vite build && cap sync` in package.json because npm runs
// package scripts through cmd.exe on Windows — whichever shell started npm, Git Bash included —
// and cmd rejects POSIX-style variables ("'VITE_MOBILE' is not recognized"). Setting them here
// works the same everywhere without a cross-env dependency.
//
// The media bases are build-time values (docs/SELF_HOSTING.md): the app ships without media/, so
// it reads the exercise images and animations from the pinned dataset on the CDN. The web build
// pins the same commit as its default in .github/workflows/deploy-web.yml; move both together.

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))
// A package's CLI, found the way npm finds it: through the bin its package.json declares.
const bin = (pkg, name) => {
  const manifest = require.resolve(`${pkg}/package.json`)
  const { bin: b } = require(manifest)
  return join(dirname(manifest), typeof b === 'string' ? b : b[name])
}
const DATASET = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd'
const env = {
  ...process.env,
  VITE_MOBILE: '1',
  VITE_IMG_BASE: `${DATASET}/images/`,
  VITE_GIF_BASE: `${DATASET}/videos/`,
}

for (const [cli, ...args] of [
  [bin('vite', 'vite'), 'build'],
  [bin('@capacitor/cli', 'cap'), 'sync'],
]) {
  const { status, error } = spawnSync(process.execPath, [cli, ...args], { cwd: root, env, stdio: 'inherit' })
  if (error) throw error
  if (status !== 0) process.exit(status ?? 1)
}
