import { createReadStream, existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The backend: `php artisan serve` in backend/ listens on 8000 (backend/README.md). It was the
// Node API on 3000 until that was retired (CHW-301).
const backend = process.env.API_TARGET || 'http://127.0.0.1:8000'
// The API refuses a state-changing request that a browser sent from anywhere other than its own
// ORIGIN (the CSRF guard, backend/app/Http/Middleware/CsrfOrigin.php). The dev server is on a different port, so the page's
// real Origin is not ORIGIN — modern browsers get through on Sec-Fetch-Site: same-origin, and
// presenting the expected Origin here covers the ones that don't send it. Match your .env if you
// changed ORIGIN: API_ORIGIN=https://gym.example.com npm run dev
const apiOrigin = process.env.API_ORIGIN || 'http://localhost:5173'
// Exercise images and GIFs. fetch-media.sh puts them in ../media; the app asks for them at
// /img and /gif (frontend/src/lib/exercises.js). The nginx container used to mount that folder
// into its web root — with it gone, the dev server serves the files itself, below. MEDIA_TARGET
// still wins if you have them somewhere else and want to proxy instead.
const media = process.env.MEDIA_TARGET || ''
const mediaDir = fileURLToPath(new URL('../media', import.meta.url))

// Hand out ../media/{img,gif} at /img and /gif. Deliberately not `publicDir`: that would copy
// ~140 MB of third-party media into every production build, and the built app points at the
// CDN dataset instead (VITE_IMG_BASE).
const localMedia = {
  name: 'local-media',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const m = /^\/(img|gif)\/([^/?#]+)/.exec(req.url || '')
      if (!m) return next()
      // basename only — no traversal out of mediaDir.
      const file = join(mediaDir, m[1], basename(decodeURIComponent(m[2])))
      if (!existsSync(file)) return next()
      res.setHeader('Content-Type', m[1] === 'gif' ? 'image/gif' : 'image/jpeg')
      createReadStream(file).pipe(res)
    })
  }
}

// The filming harness for the tutorial series (docs/VIDEO_CAPTURE.md). Headless Chrome cannot
// pass the app's passkey sign-in and the screenshots have to be the exact size of the video's
// device frame, so this page plants a session cookie, opens the app in an iframe of that size,
// and clicks its way to the state being filmed.
//
// Served from frontend/dev/ rather than public/, and only by the dev server: anything in public/
// is copied into dist/ and rsynced to coach.fitpal.ma, and a page that takes a session cookie
// from a query string and drives the app inside an iframe has no business on a production origin.
const captureHarness = {
  name: 'capture-harness',
  apply: 'serve',
  configureServer(server) {
    const file = fileURLToPath(new URL('./dev/capture-boot.html', import.meta.url))
    server.middlewares.use((req, res, next) => {
      if (!/^\/capture-boot\.html(\?|$)/.test(req.url || '')) return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      createReadStream(file).pipe(res)
    })
  }
}

// Optional web analytics (Umami). Injected only when BOTH vars are set at build time,
// so a plain `npm run build` — and every self-hosted install — stays telemetry-free.
// Set for the public instance: VITE_UMAMI_SRC=https://stats.example/script.js VITE_UMAMI_ID=<uuid>
const umamiSrc = process.env.VITE_UMAMI_SRC
const umamiId = process.env.VITE_UMAMI_ID

const umami = {
  name: 'opengym-umami',
  transformIndexHtml() {
    if (!umamiSrc || !umamiId) return
    return [{
      tag: 'script',
      attrs: { defer: true, src: umamiSrc, 'data-website-id': umamiId },
      injectTo: 'head'
    }]
  }
}

// The version people are asked for in #install-help and on every bug report. Read from
// package.json so it cannot drift from the release it was built in, and inlined at build
// time so no runtime fetch is involved.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [react(), umami, localMedia, captureHarness],
  base: './',
  server: {
    // The workspace is wider than frontend/ — ../media is served from here, and the mobile
    // build reaches across too.
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: backend, changeOrigin: true, headers: { Origin: apiOrigin } },
      // Only when MEDIA_TARGET is set; otherwise the localMedia plugin above answers these.
      ...(media ? {
        '/img': { target: media, changeOrigin: true },
        '/gif': { target: media, changeOrigin: true }
      } : {})
    }
  },
  build: { chunkSizeWarningLimit: 1500 },
  // Each suite still picks its own environment via a `@vitest-environment` docblock; this only
  // adds a guard that repairs a broken localStorage before any of them run. See test/setup.js.
  test: { setupFiles: ['./test/setup.js'] }
})
