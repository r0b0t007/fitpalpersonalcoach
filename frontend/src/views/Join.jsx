import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { t, getLang } from '../lib/i18n.js'
import { EQUIPMENT, GOALS, INJURIES_MAX, LEVELS, MIN_FILL_MS, equipmentLabel, forgetRequest, goalLabel, intakeError, levelLabel, privacyUrl, saveRequest, savedRequest } from '../lib/join.js'
import { useCoachTheme } from './PublicCoach.jsx'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import Logo from '../components/Logo.jsx'
import { Button, Check, Notice, Segmented, TextArea, TextField } from '../components/ui.jsx'

/**
 * Asking to join a coach (CHW-336): from their public page, a short intake, the address and the
 * 6-digit code it receives, then "Request sent". No account is made here — the coach accepts or
 * declines (CHW-337), and only acceptance makes one (spec §3.0). The browser keeps the request
 * (lib/join.js), so a reload or a later visit lands on its status. The code is typed here, in
 * whatever browser the follower opened the link in (Instagram's included): a link in the mail
 * would open another browser, away from the request. Wears the coach's theme, as their page does.
 */
export default function Join({ handle }) {
  const [coach, setCoach] = useState(null)
  const [step, setStep] = useState('loading')   // loading | intake | about | email | code | sent | gone
  const [intake, setIntake] = useState({ goal: null, level: null, days: null, injuries: '', equipment: [], phone: '', consent: false })
  const [who, setWho] = useState({ name: '', email: '', hp: '' })
  const [code, setCode] = useState('')
  const [request, setRequest] = useState(null)   // { id } once started; { id, token, status } once sent
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const opened = useRef(Date.now())
  const nav = useNavigate()
  const { setUser, pullState, forgetLocalSession } = useStore()
  const set = (k, v) => { setIntake(i => ({ ...i, [k]: v })); setError(null) }

  useEffect(() => {
    let live = true
    const openPage = () => api('/api/public/coach?h=' + encodeURIComponent(handle))
      .then(r => { if (live) { setCoach(r.coach); setStep('intake') } })
      .catch(e => { if (live) { setError(e.message); setStep('gone') } })
    const saved = savedRequest(handle)
    if (!saved) { openPage(); return () => { live = false } }
    // A request this browser sent comes first, and from its own route: it stays the follower's to
    // see after the page closes (the public card would say "not taking requests" and stop there).
    api('/api/join/status', { method: 'POST', body: JSON.stringify({ id: saved.id, token: saved.token }) })
      .then(s => {
        if (!live) return
        setCoach({ name: s.coachName, handle: s.handle, theme: s.theme })
        setRequest({ ...saved, status: s.status }); setStep('sent')
      })
      .catch(e => {
        if (!live) return
        // Only a request the server no longer knows is forgotten. Offline or a server error keeps
        // the token — it is what signs the follower in once accepted (CHW-337).
        if (e.status === 404) { forgetRequest(handle); openPage(); return }
        setError(e.message || t('Could not load this page')); setStep('gone')
      })
    return () => { live = false }
  }, [handle])

  useCoachTheme(coach?.theme)

  // Waiting on the coach: look again every 20 s and when the tab comes back, so an accept shows
  // (and can be claimed) without a reload. The mail says the same thing; this is for whoever stayed.
  const waiting = step === 'sent' && request?.status === 'pending' && !!request?.token
  useEffect(() => {
    if (!waiting) return
    let live = true
    const look = () => api('/api/join/status', { method: 'POST', body: JSON.stringify({ id: request.id, token: request.token }) })
      .then(s => { if (live && s.status !== 'pending') setRequest(req => ({ ...req, status: s.status })) })
      .catch(e => {
        // Gone: the coach left, or the follower's answers were deleted on request. Said, and forgotten.
        if (!live || e.status !== 404) return
        forgetRequest(handle); setError(e.message); setStep('gone')
      })
    const seen = () => { if (document.visibilityState === 'visible') look() }
    const every = setInterval(look, 20_000)
    document.addEventListener('visibilitychange', seen)
    return () => { live = false; clearInterval(every); document.removeEventListener('visibilitychange', seen) }
  }, [waiting, request?.id, request?.token])

  const next = (to, check) => () => {
    const why = check()
    if (why) { setError(why); return }
    setError(null); setStep(to)
  }
  const basics = () => intakeError({ ...intake, consent: true }) === 'basics' ? t('Tell us your goal, level and days a week') : null
  const about = () => ({
    injuries: t('Keep it under {0} characters', INJURIES_MAX),
    consent: t('Please agree to share your answers with your coach'),
  })[intakeError(intake)] || null

  const start = async () => {
    if (!who.name.trim()) { setError(t('Tell us your name')); return }
    setBusy(true); setError(null)
    try {
      // A person quicker than MIN_FILL_MS (autofill, a second visit) is waited out here rather than
      // taken for a bot by the server, which would quietly send nothing.
      const early = MIN_FILL_MS - (Date.now() - opened.current)
      if (early > 0) await new Promise(r => setTimeout(r, early))
      const r = await api('/api/join/start', { method: 'POST', body: JSON.stringify({
        handle, name: who.name.trim(), email: who.email.trim(), lang: getLang(), intake: { ...intake, injuries: intake.injuries.trim() },
        hp: who.hp, elapsed: Date.now() - opened.current,
      }) })
      // Sending again keeps the request's id: the server reuses the same request, and a throttled
      // resend answers with an id of no request at all — the code already in the inbox still works
      // against the one kept here.
      setRequest(req => (req?.id ? req : { id: r.id })); setCode(''); setStep('code')
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  const verify = async () => {
    setBusy(true); setError(null)
    try {
      const r = await api('/api/join/verify', { method: 'POST', body: JSON.stringify({ id: request.id, code: code.trim() }) })
      saveRequest(handle, { id: request.id, token: r.token })
      setRequest({ id: request.id, token: r.token, status: r.status }); setStep('sent')
    } catch (e) { setError(e.message) }
    setBusy(false)
  }

  // Accepted (CHW-337): this browser's token signs the follower in to the account accept made, and
  // the request is forgotten. Whatever this browser held before — another account signed in, a
  // guest's log — is dropped, never pushed: the session is already the follower's, and their own
  // history (an account accept bound) is on the server. As an emailed link to another account does.
  const claim = async () => {
    setBusy(true); setError(null)
    try {
      const r = await api('/api/join/claim', { method: 'POST', body: JSON.stringify({ id: request.id, token: request.token }) })
      forgetLocalSession()
      setUser(r.user)
      await pullState()
      forgetRequest(handle)
      nav('/home')
    } catch (e) { setError(e.message); setBusy(false) }
  }

  if (step === 'loading') return <div style={{ paddingTop: '42vh', display: 'flex', justifyContent: 'center' }}><Logo size={30} /></div>
  if (step === 'gone') return <div className="narrow gate"><Logo size={30} heading /><Notice icon="info" title={error} /></div>

  const chip = (on, label, onClick, key) => <button key={key} className={'chip nocap' + (on ? ' on' : '')} onClick={onClick}>{label}</button>
  const errorLine = error && <div className="small" role="alert" style={{ color: 'var(--red)', margin: '12px 2px 0' }}>{error}</div>

  return <div className="narrow gate" style={{ textAlign: 'left' }}>
    <div className="sub" style={{ marginBottom: 4 }}>{t('Ask to join')}</div>
    <h1 style={{ marginTop: 0 }}>{coach.name}</h1>

    {step === 'intake' && <>
      <h4 className="sec">{t('Your goal')}</h4>
      <div className="chips">{GOALS.map(g => chip(intake.goal === g, goalLabel(g), () => set('goal', g), g))}</div>
      <h4 className="sec">{t('Your level')}</h4>
      <Segmented options={LEVELS.map(l => ({ value: l, label: levelLabel(l) }))}
        value={intake.level} onChange={v => set('level', v)} />
      <h4 className="sec">{t('Days a week you can train')}</h4>
      {/* Numbers read the same in every language. */}
      <div className="chips">{[1, 2, 3, 4, 5, 6, 7].map(d => chip(intake.days === d, String(d), () => set('days', d), d))}</div>
      {errorLine}
      <div style={{ height: 18 }} />
      <Button variant="primary" onClick={next('about', basics)}>{t('Next')}</Button>
    </>}

    {step === 'about' && <>
      <h4 className="sec">{t('Injuries or pain to know about')}</h4>
      <TextArea name="injuries" rows={3} maxLength={INJURIES_MAX} placeholder={t('Optional')}
        value={intake.injuries} onChange={e => set('injuries', e.target.value)} />
      <h4 className="sec">{t('What you can train with')}</h4>
      <div className="chips">{EQUIPMENT.map(q => chip(intake.equipment.includes(q), equipmentLabel(q),
        () => set('equipment', intake.equipment.includes(q) ? intake.equipment.filter(x => x !== q) : [...intake.equipment, q]), q))}</div>
      <h4 className="sec">{t('WhatsApp (optional)')}</h4>
      <TextField name="phone" type="tel" placeholder="+212 6 12 34 56 78" value={intake.phone} onChange={e => set('phone', e.target.value)} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 18 }}>
        <Check checked={intake.consent} onChange={v => set('consent', v)} />
        <div className="small">{t('I agree that {0} sees these answers, injuries included, to prepare my program. Nobody else sees them.', coach.name)}</div>
      </div>
      <div className="small dim" style={{ marginTop: 8 }}>
        {t('Your answers are erased as soon as {0} says no, and deleted when your coaching with them ends.', coach.name)}{' '}
        <a href={privacyUrl(getLang())} target="_blank" rel="noopener noreferrer">{t('Your data and your rights')}</a>
      </div>
      {errorLine}
      <div style={{ height: 18 }} />
      <Button variant="primary" onClick={next('email', about)}>{t('Next')}</Button>
    </>}

    {step === 'email' && <>
      <TextField name="name" placeholder={t('Your first name')} maxLength={40} autoComplete="given-name"
        value={who.name} onChange={e => { setWho(w => ({ ...w, name: e.target.value })); setError(null) }} />
      <div style={{ height: 10 }} />
      <TextField name="email" type="email" placeholder={t('Email')} maxLength={254} autoComplete="email"
        value={who.email} onChange={e => { setWho(w => ({ ...w, email: e.target.value })); setError(null) }} />
      {/* A field people never see, named so no autofill or password manager fills it: whatever
          does is not a person. */}
      <input name="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={who.hp}
        onChange={e => setWho(w => ({ ...w, hp: e.target.value }))}
        style={{ position: 'absolute', left: '-9999px', width: 1, height: 1, opacity: 0 }} />
      <div className="dim small" style={{ margin: '8px 2px 0' }}>{t('We send you a code to check it is you. No password.')}</div>
      {errorLine}
      <div style={{ height: 18 }} />
      <Button variant="primary" onClick={start} disabled={busy}>{t('Send me a code')}</Button>
    </>}

    {step === 'code' && <>
      <p className="muted">{t('Enter the 6-digit code we sent to {0}.', who.email.trim())}</p>
      <TextField name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
        value={code} onChange={e => { setCode(e.target.value.replace(/\D/g, '')); setError(null) }} />
      {errorLine}
      <div style={{ height: 18 }} />
      <Button variant="primary" onClick={verify} disabled={busy || code.length !== 6}>{t('Send my request')}</Button>
      <div style={{ height: 10 }} />
      <Button onClick={start} disabled={busy}>{t('Send the code again')}</Button>
    </>}

    {step === 'sent' && <>
      {request?.status === 'accepted' ? <>
        <Notice icon="checkCircle" title={t('{0} accepted you', coach.name)} body={t('Your program is waiting in the app.')} />
        {errorLine}
        <div style={{ height: 14 }} />
        <Button variant="primary" onClick={claim} disabled={busy}>{t('Start training')}</Button>
      </> : <Notice icon={request?.status === 'declined' ? 'info' : 'checkCircle'}
        title={request?.status === 'declined' ? t('Not this time') : t('Request sent')}
        body={request?.status === 'declined'
          ? t('{0} cannot take you on right now.', coach.name)
          : t('{0} has your request. You will hear back here and by email.', coach.name)} />}
    </>}

    <div className="dim small" style={{ marginTop: 28, textAlign: 'center' }}>{t('Coached with FitPal')}</div>
  </div>
}
