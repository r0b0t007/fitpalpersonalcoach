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

// Not in the mobile build: the native shell already serves everything from disk. Browsers treat
// localhost as a secure context even over plain http, so installability (and this feature) can
// be exercised in `vite preview` without an https tunnel.
if (!MOBILE && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}
