// Tiny static server for local Lighthouse runs. Mirrors the two Cloudflare Pages behaviours that
// change what Lighthouse sees: extensionless URLs, and the Cache-Control values that
// site-coach/_headers sets at the edge. Not part of any deploy.
//
//   node scripts/serve-site-coach.mjs [root] [port]
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize, sep } from 'node:path'

const root = process.argv[2] || 'site-coach'
const port = Number(process.argv[3] || 8137)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
}

// Same policy as the _headers the build generates: content-addressed files (hashed CSS, JS and
// fonts) get a year, un-hashed media a day plus stale-while-revalidate, HTML always revalidates.
function cacheFor (p) {
  if (/\.[0-9a-f]{8,}\.(css|js|woff2)$/.test(p)) return 'public, max-age=31536000, immutable'
  if (/\.(woff2|avif|webp|png|jpe?g|mp4|webm)$/.test(p)) return 'public, max-age=86400, stale-while-revalidate=604800'
  if (/\.(css|js)$/.test(p)) return 'public, max-age=86400'
  return 'public, max-age=0, must-revalidate'
}

// A Lighthouse run makes requests this server would otherwise throw on (HEAD, odd paths).
// Node exits the process on an unhandled rejection, which silently kills the run mid-audit,
// so every request is wrapped and the process refuses to die.
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e))
process.on('uncaughtException', (e) => console.error('uncaught exception:', e))

createServer(async (req, res) => {
 try {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p.endsWith('/')) p += 'index.html'

  // Keep the request inside root: strip any leading traversal after normalising.
  const rel = normalize(p).replace(/^([.][.][/\\])+/, '').replace(/^[/\\]+/, '')
  let file = join(root, rel)

  try {
    const s = await stat(file)
    if (s.isDirectory()) file = join(file, 'index.html')
  } catch {
    try {
      await stat(file + '.html')
      file += '.html' // Pages serves /mentions-legales from mentions-legales.html
    } catch {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
      return res.end('<!doctype html><title>404</title>not found')
    }
  }

  let body
  try {
    body = await readFile(file)
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    return res.end('<!doctype html><title>404</title>not found')
  }

  res.writeHead(200, {
    'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
    'cache-control': cacheFor(file),
    'content-length': body.length,
  })
  // HEAD must carry the headers but no body, or the client hangs waiting for bytes.
  res.end(req.method === 'HEAD' ? undefined : body)
 } catch (e) {
  console.error('request failed:', req.url, e && e.message)
  try {
    res.writeHead(500, { 'content-type': 'text/plain' })
    res.end('error')
  } catch { /* response already sent */ }
 }
}).listen(port, '127.0.0.1', () => {
  console.log(`serving ${root}${sep} on http://127.0.0.1:${port}`)
})
