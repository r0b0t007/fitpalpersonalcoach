import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, uploadCoachPhoto } from '../../lib/api.js'
import { copyTemplate, fetchPrograms } from '../../lib/programs.js'
import { programTemplates } from '../../lib/program-templates.js'
import { BIO_MAX, normaliseHandle, validHandle } from '../../lib/coach-page.js'
import { t } from '../../lib/i18n.js'
import { waInput } from '../../lib/whatsapp.js'
import { PHOTOS_REACHABLE, prepareSquarePhoto } from '../../lib/photo.js'
import { useUI } from '../../store/useUI.js'
import Icon from '../../components/Icon.jsx'
import { Button, Notice, Row, Section, Segmented, SelectRow, Switch, TextArea, TextField } from '../../components/ui.jsx'

// The starter picker's value for a template not yet copied (CHW-345).
const TEMPLATE = 'template:'

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
  const [form, setForm] = useState({ handle: '', bio: '', whatsapp: '', open: true, theme: 'dark', starterProgramId: null, autoAccept: false })
  const [programs, setPrograms] = useState([])
  const [error, setError] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [busy, setBusy] = useState(false)
  // The photo is the server's, apart from the form (CHW-356): adding one never sends half-typed
  // fields, and saving the form never sends it.
  const [photo, setPhoto] = useState(null)
  const [photoBusy, setPhotoBusy] = useState(false)
  const fileRef = useRef(null)
  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setError(null) }
  const took = r => {
    if (!r.page) return
    const { photo: p, ...page } = r.page
    setForm(page); setPhoto(p || null); setSaved({ handle: page.handle, url: r.url })
  }
  const toast = msg => useUI.getState().toast(msg)

  const onPhoto = async e => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''   // so picking the same file again still fires
    if (!file) return
    setPhotoBusy(true); setError(null)
    try {
      let square
      try { square = await prepareSquarePhoto(file) } catch (e2) {
        // The phone's own refusals, in English in lib/photo.js: said here in the coach's language.
        setError(e2.code === 'small' ? t('Pick a larger photo — at least 200 pixels on each side.') : t('That image could not be read — try another photo.'))
        return
      }
      const r = await uploadCoachPhoto(square)
      setPhoto(r.page?.photo || null)
      toast(t('Photo added'))
    } catch (e2) { setError(e2.message) } finally { setPhotoBusy(false) }
  }
  const removePhoto = async () => {
    setPhotoBusy(true); setError(null)
    try {
      await api('/api/coach/page/photo/remove', { method: 'POST', body: '{}' })
      setPhoto(null)
      toast(t('Photo removed'))
    } catch (e) { setError(e.message) }
    setPhotoBusy(false)
  }

  // The library, for the starter program; without it the picker offers "None" only.
  useEffect(() => { fetchPrograms().then(r => setPrograms(r.programs)).catch(() => {}) }, [])

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
      let page = form
      // A template picked as the starter (CHW-345) is copied into the library here, on Save, not
      // when it is picked: browsing the picker writes nothing, and the page can only name a
      // program the coach owns. The form then names the copy, so a page save refused next and
      // tried again does not make a second one.
      if (String(form.starterProgramId || '').startsWith(TEMPLATE)) {
        const { program, programs: after } = await copyTemplate(form.starterProgramId.slice(TEMPLATE.length))
        setPrograms(after)
        set('starterProgramId', program.id)
        page = { ...form, starterProgramId: program.id }
        toast(t('Copied to your library'))
      }
      took(await api('/api/coach/page/save', { method: 'POST', body: JSON.stringify({ ...page, handle, whatsapp: waInput(page.whatsapp) }) }))
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

    {/* On the saved page's row, so once there is one. Not shown on the paired phone app, which
        cannot load it (lib/photo.js PHOTOS_REACHABLE): the camera says it is there to change. */}
    {saved && <Section title={t('Photo')} footer={t('Your face, square, first thing on your page and in the link preview. Anyone with your link sees it.')}>
      <div style={{ padding: '12px 16px', display: 'flex', gap: 14, alignItems: 'center' }}>
        <span style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden', flex: 'none', background: 'var(--surface-2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--label-2)' }}>
          {photo && PHOTOS_REACHABLE
            ? <img src={photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <Icon name="camera" />}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minWidth: 0 }}>
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={photoBusy}>{photo ? t('Change photo') : t('Add a photo')}</Button>
          {photo && <Button size="sm" onClick={removePhoto} disabled={photoBusy}>{t('Remove photo')}</Button>}
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPhoto} data-testid="page-photo" />
      </div>
    </Section>}

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
          onChange={e => set('whatsapp', e.target.value)} onBlur={e => set('whatsapp', waInput(e.target.value))} />
      </div>
    </Section>

    {/* CHW-338: what a new client finds on day one, and whether they wait for the coach at all. */}
    <Section title={t('New clients')} footer={t('The starter program is added to their plan, and their first workout is put on the day they join.')}>
      <SelectRow icon="clipboard" iconTint="var(--acc)" title={t('Starter program')} sheetTitle={t('Starter program')}
        value={form.starterProgramId || ''} onChange={v => set('starterProgramId', v || null)}
        options={[{ value: '', label: t('None') }, ...programs.map(p => ({ value: p.id, label: p.name || t('Untitled program') })),
          ...programTemplates().map(tpl => ({ value: TEMPLATE + tpl.key, label: t('{0} (template)', tpl.name) }))]} />
      <Row icon="checkCircle" iconTint="var(--green)" title={t('Accept requests automatically')}
        subtitle={t('Each request is accepted as soon as the email is confirmed, while you have places on your plan.')}>
        <Switch checked={!!form.autoAccept} onChange={v => set('autoAccept', v)} />
      </Row>
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
