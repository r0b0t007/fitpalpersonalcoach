import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { initInstall } from './lib/install.js'
import './index.css'

// Before React mounts: Chrome can fire `beforeinstallprompt` this early, and a listener added
// later (e.g. in a component effect) would miss it.
initInstall()

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
)

// Not in the mobile build: the native shell already serves everything from disk. Production
// bundles only: sw.js caches every same-origin GET, which under `vite dev` would pin a stale
// module graph to the port long after the server is gone. isSecureContext is the browser's own
// rule for where a service worker may register (https, plus localhost / 127.0.0.1 / [::1]), so
// `vite preview` is installable without an https tunnel.
if (!MOBILE && import.meta.env.PROD && 'serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
