/* FitPal Coach service worker (built on openGym) — runtime caching (works with Vite's hashed asset names).
   Media (img/gif) cache-first; everything else network-first with offline fallback. */
const CACHE = 'fitpal-coach-rt-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
})
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(data.title || 'FitPal Coach', {
    body: data.body || '',
    icon: 'icon-512.png',
    // Android draws the badge from the alpha channel only, so it needs the bare symbol on
    // transparency; the opaque icon tiles would show as a white square.
    badge: 'badge-96.png',
    tag: data.tag || 'fitpal-coach',
    renotify: true
  }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    return c ? c.focus() : self.clients.openWindow('./')
  }))
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return    // never cache auth/data

  // status === 200, not res.ok: `ok` is true for the whole 2xx range, and cache.put() REJECTS on
  // a 206 Partial Content. GIFs and JS never produced a 206, so this never fired; a <video> does,
  // on every seek, and the rejection is unhandled -- the put is fire-and-forget in the else
  // branch and not returned in the media branch.
  const cacheable = res => res.status === 200

  const isMedia = url.pathname.includes('/img/') || url.pathname.includes('/gif/')
  if (isMedia) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { if (cacheable(res)) c.put(e.request, res.clone()); return res })
    )))
  } else {
    e.respondWith(fetch(e.request).then(res => {
      if (cacheable(res)) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
      return res
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))))
  }
})
