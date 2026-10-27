// Mobile build only, first launch: the choice useStore.boot() couldn't make on its own — keep
// everything on this device, or pair it with their account on a server instead. See
// lib/remote.js for the pairing flow this hands off to.
import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import Logo from '../components/Logo.jsx'
import { BRAND } from '../lib/brand.js'

export function ConnectSheet({ close }) {
  const { connectToServer } = useStore()
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef(null)
  useEffect(() => { setTimeout(() => ref.current?.focus(), 250) }, [])
  const go = async () => {
    if (!url.trim() || !code.trim()) { useUI.getState().toast(t('Enter your server address and the code')); return }
    setBusy(true)
    try { await connectToServer(url.trim(), code.trim()); close(); useUI.getState().toast(t('Connected')) }
    catch (e) { useUI.getState().toast(e.message || t('Could not connect')) }
    finally { setBusy(false) }
  }
  return <>
    <h3>{t('Connect to my server')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Open Settings → “Pair the mobile app” on the {0} site you’re already signed into, then enter its address and the code shown there.', BRAND)}
    </div>
    <input ref={ref} className="input" placeholder={t('Server address (e.g. gym.example.com)')} value={url}
      onChange={e => setUrl(e.target.value)} autoCapitalize="none" autoCorrect="off" inputMode="url" />
    <div style={{ height: 10 }} />
    <input className="input" placeholder={t('Pairing code')} maxLength={8} value={code}
      onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go} disabled={busy}>{busy ? t('Connecting…') : t('Connect')}</Button>
  </>
}

export default function MobileOnboarding() {
  const { chooseLocalMode } = useStore()
  // The same lockup the web sign-in opens with (Login.jsx).
  const head = <h1 style={{ margin: '10px 0 6px' }}><Logo size={40} /></h1>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }
  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('How do you want to use {0}?', BRAND)}</div>
      <Button variant="primary" icon="lock" onClick={() => chooseLocalMode()}>{t('Use on this device')}</Button>
      <div style={{ height: 10 }} />
      <Button icon="rocket" onClick={() => useUI.getState().openSheet(close => <ConnectSheet close={close} />)}>{t('Connect to my server')}</Button>
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>
        {t('“Use on this device” keeps everything on this phone. Connecting syncs it with your {0} account instead — you can switch later in Settings.', BRAND)}
      </div>
    </div>
  )
}
