import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { BIO_MAX, normaliseHandle, validHandle } from '../../lib/coach-page.js'
import { t } from '../../lib/i18n.js'
import { Button, Notice, Row, Section, Segmented, Switch, TextArea, TextField } from '../../components/ui.jsx'

/**
 * Account › My page (CHW-330): the coach's public page — the one link in their Instagram bio. The
 * handle is checked here as the server checks it (lib/coach-page.js), so most slips never leave
 * the phone; the server's own refusal ("that handle is taken") is shown as it comes.
 */
export default function PublicPage() {
  const nav = useNavigate()
  const [loaded, setLoaded] = useState(false)
  // What the server holds, apart from what is being typed: the link and "See my page" are the
  // saved page's, never a half-typed handle's.
  const [saved, setSaved] = useState(null)
  // A new page starts open: a coach making one wants it live, and a closed one only tells visitors
  // "not taking requests".
  const [form, setForm] = useState({ handle: '', bio: '', whatsapp: '', open: true, theme: 'dark' })
  const [error, setError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setError(null) }
  const took = r => { if (r.page) { setForm(r.page); setSaved({ handle: r.page.handle, url: r.url }) } }

  useEffect(() => {
    api('/api/coach/page').then(r => { took(r); setLoaded(true) })
      // No form on a failed load: saved, its blanks would overwrite the page the coach has.
      .catch(e => { setLoadError(e.message || t('Could not load this page')); setLoaded(true) })
  }, [])

  const save = async () => {
    const handle = normaliseHandle(form.handle)
    if (!validHandle(handle)) { setError(t('Handles are 3–30 letters, numbers, dots or underscores')); return }
    setBusy(true)
    try {
      took(await api('/api/coach/page/save', { method: 'POST', body: JSON.stringify({ ...form, handle }) }))
      setError(null)
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  if (!loaded) return null
  const header = <div className="hdr"><div style={{ flex: 1 }}><h1 style={{ margin: 0 }}>{t('My page')}</h1>
    <div className="sub">{t('The one link for your Instagram bio.')}</div></div></div>
  if (loadError) return <div className="narrow">
    {header}
    <Notice icon="warning" tone="warn" title={loadError} />
  </div>
  return <div className="narrow">
    {header}

    <Section title={t('Your link')} footer={saved?.url || t('Pick a handle — your Instagram name works.')}>
      <div style={{ padding: '10px 16px' }}>
        <TextField name="handle" placeholder="sara.fit" autoCapitalize="none" autoCorrect="off" maxLength={31}
          value={form.handle} onChange={e => set('handle', e.target.value)} />
      </div>
      <Row icon="link" iconTint="var(--acc)" title={t('Page open')}
        subtitle={t('Closed, the link says you are not taking requests.')}>
        <Switch checked={form.open} onChange={v => set('open', v)} />
      </Row>
    </Section>

    {/* The count is digits and a slash in every language: nothing to translate. */}
    <Section title={t('About you')} footer={`${form.bio.length} / ${BIO_MAX}`}>
      <div style={{ padding: '10px 16px' }}>
        <TextArea name="bio" rows={3} maxLength={BIO_MAX} placeholder={t('Who you coach, and how.')}
          value={form.bio} onChange={e => set('bio', e.target.value)} />
      </div>
    </Section>

    {/* WhatsApp is a name, the same in every language. */}
    <Section title="WhatsApp" footer={t('With the country code, e.g. +212 6… Leave empty to hide the button.')}>
      <div style={{ padding: '10px 16px' }}>
        <TextField name="whatsapp" type="tel" placeholder="+212 6 12 34 56 78" value={form.whatsapp}
          onChange={e => set('whatsapp', e.target.value)} />
      </div>
    </Section>

    <Section title={t('Page theme')}>
      <div style={{ padding: '10px 16px' }}>
        <Segmented options={[{ value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={form.theme} onChange={v => set('theme', v)} />
      </div>
    </Section>

    {error && <div className="small" role="alert" style={{ color: 'var(--red)', margin: '0 4px 12px' }}>{error}</div>}
    <Button variant="primary" onClick={save} disabled={busy}>{t('Save')}</Button>
    {/* Open or closed: a closed page shows what visitors get, which is the thing to check. */}
    {saved && <>
      <div style={{ height: 10 }} />
      <Button icon="link" onClick={() => nav('/c/' + saved.handle)}>{t('See my page')}</Button>
    </>}
  </div>
}
