import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api, fetchExerciseMedia, uploadExerciseMedia } from '../../lib/api.js'
import { setCoachMedia } from '../../lib/coach-media.js'
import { EXIDX, allExercises, matchesExerciseSearch, mediaRowSrc } from '../../lib/exercises.js'
import { fmtDate, fmtMB, uid, DAYN } from '../../lib/format.js'
import { inviteLink } from '../../lib/invite.js'
import { buildPlanBundle } from '../../lib/plan-share.js'
import { confirmSheet } from '../../sheets.jsx'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import { rel } from './parts.jsx'
import { InviteBlocked } from './billing.jsx'
import { nav } from '../../lib/nav.js'
import { t, tp, exerciseNameFor } from '../../lib/i18n.js'

// The coach's sheets: send a program, invite a client, upload a demo. Opened from Today, Clients
// and a client's page.
//
// Saving a program used to be a sheet here too, and it could only ever snapshot the routines in
// the coach's own Plan — which meant the one way to write a program was to first write it into
// your own training. The editor at /programs/:pid replaced it; "copy from my own plan" survives
// there as one way to start rather than the only one.

// Labels and units for the four numbers, in the order a coach reads them. Labels are functions so
// they are read in the current language at render; the keys are the member side's (MacroRows).
const MACRO_FIELDS = [['kcal', () => t('Calories'), 'kcal'], ['p', () => t('Protein'), 'g'], ['c', () => t('Carbs'), 'g'], ['f', () => t('Fat'), 'g']]
// getDay() order, 0 = Sunday, matching lib/checkins.js. Listed Monday-first because that is how a
// training week reads, with Sunday last where the default actually sits.
const CHECKIN_DAYS = [1, 2, 3, 4, 5, 6, 0]

export function SendSheet({ members, close, program, preselect, onSent }) {
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [picked, setPicked] = useState(preselect || [])
  const [note, setNote] = useState('')
  const [schedule, setSchedule] = useState(false)
  const [busy, setBusy] = useState(false)
  // Daily nutrition targets ride on this bundle rather than getting a channel of their own. A
  // target the server wrote into a member's state file would be destroyed by their next
  // whole-state push, so something they ACCEPT is the only kind that survives — and the accept
  // flow already exists, with an inbox, a withdraw and an expiry. Blank means "not this time",
  // and a bundle without the key leaves whatever they already have alone.
  const [macros, setMacros] = useState({ kcal: '', p: '', c: '', f: '' })
  const [macroNote, setMacroNote] = useState('')
  // '' means "this bundle says nothing about the day", which is NOT the same as Sunday. A coach
  // sending a new block should not silently drag a member who has checked in on Wednesdays for
  // months back to the default. Kept as a string precisely so the empty case and the deliberate
  // 0 stay distinguishable — the whole trap in this feature is that Sunday is falsy.
  const [checkinDay, setCheckinDay] = useState('')
  const macro = (k, v) => setMacros(m => ({ ...m, [k]: v.replace(/[^\d]/g, '').slice(0, 5) }))
  const nutrition = MACRO_FIELDS.some(([k]) => +macros[k] > 0)
    ? Object.fromEntries([
      ...MACRO_FIELDS.filter(([k]) => +macros[k] > 0).map(([k]) => [k, +macros[k]]),
      ...(macroNote.trim() ? [['note', macroNote.trim()]] : [])
    ])
    : null

  // A saved program when one was chosen; otherwise the coach's current plan, which is what the
  // very first version always sent.
  const bundle = program ? program.bundle : buildPlanBundle(S, t('{0}’s program', user?.name || t('Coach')))
  const exCount = bundle.routines.reduce((n, r) => n + r.ex.length, 0)
  const days = Object.keys(bundle.week || {}).length
  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.concat(id))

  const send = () => {
    setBusy(true)
    api('/api/coach/assign', {
      method: 'POST',
      body: JSON.stringify({
        memberIds: picked,
        bundle: {
          ...bundle,
          ...(nutrition ? { nutrition } : {}),
          ...(checkinDay === '' ? {} : { checkinDay: +checkinDay })
        },
        note, schedule: schedule && days > 0
      })
    })
      .then(({ sent }) => { toast(tp(sent, 'Sent to {0} client', 'Sent to {0} clients')); close(); onSent?.() })
      .catch(e => { toast(e.message); setBusy(false) })
  }

  if (!bundle.routines.length) return <>
    <h3>{t('Nothing to send yet')}</h3>
    <div className="dim small" style={{ lineHeight: 1.5 }}>
      {t('Build the program in your own Plan first — the routines you have there are what gets sent.')}
    </div>
  </>

  return <>
    <h3>{program ? t('Send “{0}”', program.name) : t('Send your current plan')}</h3>
    <div className="muted small" style={{ marginBottom: 4 }}>
      {tp(bundle.routines.length, '{0} routine', '{0} routines')} · {tp(exCount, '{0} exercise', '{0} exercises')}
      {days ? ' · ' + tp(days, 'scheduled on {0} day', 'scheduled on {0} days') : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      {t('Each client is asked to accept before anything is added. Their own routines are never changed or removed.')}
    </div>

    <input className="input" placeholder={t('Note (optional) — what this block is for')} maxLength={280}
      value={note} onChange={e => setNote(e.target.value)} style={{ marginBottom: 10 }} />

    {/* No toggle for a bundle with no scheduled days: the member's side (mergePlan) ignores
        `schedule` when the incoming week is empty, so ticking it would do nothing and look like
        it did. A saved program hits this for one of two reasons — the coach never put those
        routines on a weekday, or it was saved before buildProgramBundle kept the week at all
        (programs live in S and outlive the fix) — and only a re-save can tell them apart, so
        that is what the note asks for. */}
    {days ? <>
      <label className="row between" style={{ padding: '8px 2px', marginBottom: 6 }}>
        <span className="small">{t('Also set their weekly schedule')}</span>
        <input type="checkbox" checked={schedule} onChange={e => setSchedule(e.target.checked)} />
      </label>
      {schedule && <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.4 }}>
        {t('This replaces which routine sits on each weekday for them. Leave it off to add the routines and let them slot them in.')}
      </div>}
    </> : <div className="dim small" style={{ padding: '8px 2px', marginBottom: 10, lineHeight: 1.4 }}>
      {program
        ? t('No weekly schedule in this program. If its routines are on weekdays in your Plan, save the program again and the schedule comes with it.')
        : t('No weekly schedule to send — none of these routines is on a weekday in your Plan.')}
    </div>}

    <h4 className="sec">{t('Daily nutrition targets (optional)')}</h4>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.4 }}>
      {t('Leave these blank to send the program alone. Filling any of them replaces their current targets when they accept — a half-set target, this block’s calories against the last block’s protein, is a number nobody could explain. Blank fields are not sent, so setting calories and protein means exactly that.')}
    </div>
    <div className="list" style={{ rowGap: 0, marginBottom: 10 }}>
      {MACRO_FIELDS.map(([k, label, unit]) => <label key={k} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
        <span className="small" style={{ fontWeight: 600 }}>{label()}</span>
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input className="input" inputMode="numeric" placeholder="—" style={{ width: 90, textAlign: 'end' }}
            value={macros[k]} onChange={e => macro(k, e.target.value)} />
          <span className="dim small" style={{ width: 34 }}>{unit}</span>
        </span>
      </label>)}
    </div>
    <h4 className="sec" style={{ marginTop: 16 }}>{t('Check-in day')}</h4>
    <div className="dim small" style={{ marginBottom: 8, lineHeight: 1.4 }}>
      {t('Which day their weekly check-in falls on. Leave it alone and this program does not touch it — a client who has been answering on a Wednesday stays on Wednesday.')}
    </div>
    <select className="input" value={checkinDay} onChange={e => setCheckinDay(e.target.value)}
      style={{ marginBottom: 10 }}>
      <option value="">{t('Leave their day as it is')}</option>
      {CHECKIN_DAYS.map(v => <option key={v} value={v}>{t(DAYN[v])}</option>)}
    </select>

    <input className="input" placeholder={t('Note on the diet (optional)')} maxLength={280}
      value={macroNote} onChange={e => setMacroNote(e.target.value)} style={{ marginBottom: 6 }} />

    <h4 className="sec">{t('Send to')}</h4>
    {members.length ? <div className="list" style={{ rowGap: 0 }}>
      {members.map(m => <label key={m.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{m.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{tp(m.workouts, '{0} workout', '{0} workouts')} · {t('synced {0}', rel(m.lastSync))}</div></div>
        <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} />
      </label>)}
    </div> : <div className="empty small">{t('No clients yet.')}</div>}

    <Button variant="primary" style={{ marginTop: 14 }} disabled={!picked.length || busy} onClick={send}>
      {busy ? t('Sending…') : picked.length ? tp(picked.length, 'Send to {0} client', 'Send to {0} clients') : t('Pick at least one client')}
    </Button>
  </>
}

// Saving a program = snapshotting the routines you picked. Copies, not references: a program
// you saved last month must not change because you edited your own Plan this morning.
/* ---------------------------------------------------- exercise demos -- */
/* Videos the coach shoots themselves, keyed on the EXERCISE ID rather than on a dataset row —
   which is what finally gives custom exercises media, since the stock catalogue has no entry for
   a variation you invented last week.

   One sheet, three jobs: pick the exercise, send the file, see what is already up there.

   Every refusal from POST /api/media/exercise is worded FOR THE COACH — "use MP4 or MOV", "set
   the camera to Most Compatible, or export as JPEG", "file is larger than the 90 MB limit". Those
   strings are the instruction; they are printed verbatim and never collapsed into "upload
   failed", which would throw away the only thing that says what to change. */

// EXIDX carries the custom exercises too (the store registers them on load), so one lookup
// covers both. Falling back to the raw id keeps a demo for a deleted exercise visible and
// counted against the cap instead of vanishing from a list it still occupies.
const exName = id => (EXIDX[id] ? exerciseNameFor(EXIDX[id]) : id)

// Taking a client on. The code IS the product here: the coach makes one, reads it out or texts
// it, and the person who redeems it lands on their roster already assigned — which until now took
// an admin running assign-coach by hand after the fact.
/* An invite is a LINK, not sixteen characters to read down a phone.
 *
 * What this screen used to be: make a code, copy it, and tell the client to type it into a field
 * they will only find if the instance happens to gate signup on codes. If it did not, the sheet
 * showed a red card saying the code would not work and to ask an admin to turn invite-only on —
 * a coach being told their own product is switched off until an operator they may not have flips
 * an environment variable. The server no longer works that way (a supplied code is honoured
 * whatever INVITE_ONLY says), so the card is gone and so is the code field as the main event.
 *
 * The code still exists underneath and the list still shows it, because a link is unusable over a
 * phone call and a coach reading one out needs something to read.
 */
export function InviteSheet() {
  const toast = useUI(s => s.toast)
  const [state, setState] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const [failed, setFailed] = useState(false)
  // NOT a { max: 0 } placeholder on failure. That reads as a real answer everywhere downstream:
  // `open.length >= state.max` is 0 >= 0, so the button disables itself permanently with no retry,
  // under a message reading "You have 0 codes waiting. Revoke one you are not going to use."
  // A failure leaves state null and says so.
  const load = () => api('/api/coach/invites')
    .then(d => { setState(d); setFailed(false) })
    .catch(e => { setFailed(true); toast(e.message) })
  useEffect(() => { load() }, [])

  const invites = state?.invites || []
  const open = invites.filter(i => !i.usedAt && !i.revoked)
  const used = invites.filter(i => i.usedAt)
  // Shown, not dropped. Filtering revoked codes out of BOTH lists meant a revoke — accidental or
  // not — erased the row with no trace, so a coach could not tell a code they had sent from one
  // that had never existed. The admin screen keeps them for the same reason.
  const dead = invites.filter(i => i.revoked && !i.usedAt)

  /* Share, then clipboard, then just show the link.
   *
   * Both need transient user activation, which an await can spend, and the two failures are NOT
   * alike: navigator.share rejects (NotAllowedError) but navigator.clipboard.writeText simply
   * never settles when the document is not focused. An unsettled promise is why this button sat on
   * "Making…" for ever with the freshly minted link nowhere on screen — the code existed on the
   * server, and the only thing that could show it to the coach was waiting on a promise with no
   * outcome. So the clipboard gets a deadline, and this function never rejects: the caller is a
   * convenience, not the feature.
   */
  const sendLink = async code => {
    const link = inviteLink(code)
    if (navigator.share) {
      try { await navigator.share({ title: t('Join me on FitPal'), text: t('Here is your invite:'), url: link }); return }
      // AbortError is the user closing the share sheet, not a failure — falling through to the
      // clipboard there would tell them something was copied when they had just said no.
      catch (e) { if (e && e.name === 'AbortError') return }
    }
    try {
      await Promise.race([
        navigator.clipboard.writeText(link),
        new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard never answered')), 2000))
      ])
      toast(t('Invite link copied'))
    } catch { toast(link) }   // last resort: put it on screen, where it can at least be selected
  }

  const mint = async () => {
    setBusy(true)
    let code
    try {
      const { invite } = await api('/api/coach/invites/new', { method: 'POST', body: JSON.stringify({ note }) })
      code = invite.code
    } catch (e) { toast(e.message); setBusy(false); return }
    // Attempted immediately, because WebKit only honours a share or a clipboard write while the
    // activation from the tap is still live and load() is a second round trip — but NOT awaited,
    // because whether the link reaches the share sheet must not decide whether it reaches the
    // list. The row below, with its own Share button one direct tap away, is the reliable path.
    sendLink(code)
    setNote('')
    await load()
    setBusy(false)
  }

  // Confirmed, like the identical action on the admin screen. There is no un-revoke route, this
  // button sits six pixels from Share, and a link the coach has already sent dies on a mis-tap —
  // the client then reads "this invite link is not valid any more" while the coach has no idea
  // why. The message names the code and the note so the sheet is answerable without remembering
  // which row was tapped.
  const revoke = i => confirmSheet({
    title: t('Revoke this invite?'),
    message: i.note
      ? t('“{1}” — {0} stops working immediately. If you have already sent the link, whoever has it will not be able to join.', i.code, i.note)
      : t('{0} stops working immediately. If you have already sent the link, whoever has it will not be able to join.', i.code),
    confirmText: t('Revoke'), danger: true,
    onConfirm: () => api('/api/coach/invites/revoke', { method: 'POST', body: JSON.stringify({ code: i.code }) })
      .then(() => { toast(t('Invite revoked')); return load() }).catch(e => toast(e.message))
  })

  const copyCode = async code => {
    try { await navigator.clipboard.writeText(code); toast(t('Copied {0}', code)) }
    catch { toast(code) }
  }

  const atCap = !!state && open.length >= state.max
  // The plan's client cap (R4, Laravel): `reason` says why this coach takes nobody on right now —
  // `at_cap` or `read_only` — and is null when they can. The Node API sends no such field, so
  // there the sheet is exactly what it was. Not the open-code quota above, which still applies.
  const blocked = state?.reason || null

  return <>
    <h3>{t('Invite a client')}</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Send them a link. They open it, make their profile, and arrive already on your roster — nobody has to assign them afterwards. Each link works once.')}
    </div>

    {blocked ? <InviteBlocked reason={blocked} cap={state.cap} used={state.used}
      onManageClients={() => { useUI.getState().closeAll(); nav('/clients') }} /> : <>
      <input className="input" placeholder={t('Who is it for? (optional)')} value={note} maxLength={60}
        onChange={e => setNote(e.target.value)} style={{ marginBottom: 8 }} />
      <Button variant="primary" icon="link" disabled={busy || !state || atCap} onClick={mint}>
        {busy ? t('Making…') : t('Make an invite link')}
      </Button>
      {/* Only when it is actually in the way. A quota a coach is nowhere near is noise on the one
          screen whose whole job is "send this to somebody". */}
      {atCap && <div className="dim small" style={{ marginTop: 6 }}>
        {tp(state.max, 'You have {0} link waiting. Revoke one you are not going to use.', 'You have {0} links waiting. Revoke one you are not going to use.')}
      </div>}
    </>}

    <h4 className="sec" style={{ marginTop: 18 }}>{t('Waiting')}</h4>
    {failed ? <div className="dim small">{t('Could not load your invites.')}{' '}
      {/* A button, not an <a onClick> — with no href an anchor is not keyboard-focusable and gets
          no pointer cursor, and this is the only retry on a sheet whose Make button is
          disabled until a load succeeds. Unreachable here means stuck here. */}
      <button className="btn" style={{ width: 'auto', padding: '2px 10px' }} onClick={load}>{t('Try again')}</button></div>
      : state === null ? <div className="dim small">{t('Loading…')}</div>
      : open.length ? <div className="list" style={{ rowGap: 0 }}>
        {open.map(i => <div key={i.code} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="small" style={{ fontWeight: 600 }}>{i.note || t('No note')}</div>
            {/* The code is kept visible: a link cannot be read down a phone, and this is the only
                thing a coach standing in front of someone can dictate. */}
            <div className="dim" style={{ fontSize: '.72rem' }}>
              {t('made {0}', fmtDate(String(i.created).slice(0, 10)))} ·{' '}
              <button onClick={() => copyCode(i.code)} aria-label={t('Copy the code {0}', i.code)}
                style={{ font: 'inherit', fontFamily: 'ui-monospace, monospace', color: 'inherit', background: 'none',
                  border: 0, padding: 0, textDecoration: 'underline', cursor: 'pointer' }}>{i.code}</button>
            </div>
          </div>
          <div className="row" style={{ gap: 6, flex: 'none' }}>
            {/* While nobody can join, a link sent now is a sign-up that will be refused. The code
                stays listed, and revocable, so nothing is lost when the seats open again. */}
            {!blocked && <button className="btn" style={{ width: 'auto', padding: '4px 10px' }} onClick={() => sendLink(i.code)}>{t('Share')}</button>}
            <button className="iconbtn" aria-label={t('Revoke {0}', i.code)} onClick={() => revoke(i)}><Icon name="trash" /></button>
          </div>
        </div>)}
      </div> : <div className="dim small">{t('Nothing waiting. Make a link and send it.')}</div>}

    {!!dead.length && <>
      <h4 className="sec" style={{ marginTop: 18 }}>{t('Revoked')}</h4>
      <div className="list" style={{ rowGap: 0 }}>
        {dead.map(i => <div key={i.code} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)', opacity: .55 }}>
          <div><div className="small" style={{ fontWeight: 600, textDecoration: 'line-through' }}>{i.note || t('No note')}</div>
            <div className="dim" style={{ fontSize: '.72rem', fontFamily: 'ui-monospace, monospace' }}>{i.code} · {t('will not work')}</div></div>
        </div>)}
      </div>
    </>}

    {/* Kept rather than hidden once used: this is the record of who came in on which link, and it
        is the only place a coach can see that one they sent was actually taken up. */}
    {!!used.length && <>
      <h4 className="sec" style={{ marginTop: 18 }}>{t('Joined clients')}</h4>
      <div className="list" style={{ rowGap: 0 }}>
        {used.map(i => <div key={i.code} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <div><div className="small" style={{ fontWeight: 600 }}>{i.usedByName || t('someone')}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>
              {i.note ? t('{0} · joined {1}', i.note, fmtDate(String(i.usedAt).slice(0, 10))) : t('joined {0}', fmtDate(String(i.usedAt).slice(0, 10)))}</div></div>
          <span className="dim" style={{ fontSize: '.7rem', fontFamily: 'ui-monospace, monospace' }}>{i.code}</span>
        </div>)}
      </div>
    </>}
  </>
}

export function MediaSheet() {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const [rows, setRows] = useState(null)
  const [ex, setEx] = useState(null)
  const [q, setQ] = useState('')
  const [label, setLabel] = useState('')
  const [pct, setPct] = useState(null)
  const [err, setErr] = useState('')
  const [preview, setPreview] = useState(null)
  const fileRef = useRef(null)
  const job = useRef(null)

  // The same list the members' app reads, so pushing it into the registry here means a demo the
  // coach just uploaded shows up on their OWN exercise cards without a reload.
  const load = () => fetchExerciseMedia()
    .then(m => { setRows(m); setCoachMedia(m) })
    .catch(e => { setRows([]); toast(e.message) })
  useEffect(() => { load(); return () => job.current?.abort() }, [])

  const mine = ex ? (rows || []).filter(m => m.exId === ex.id) : []
  const atCap = mine.length >= 6
  const hits = q.trim().length < 2 ? [] : allExercises(S).filter(e => matchesExerciseSearch(e, q)).slice(0, 8)

  const onFile = e => {
    const file = e.target.files && e.target.files[0]
    // Cleared immediately so picking the SAME file again after a refusal still fires a change
    // event — which is the most likely next thing to happen after "use MP4 or MOV".
    e.target.value = ''
    if (!file || !ex) return
    setErr(''); setPct(0)
    const p = uploadExerciseMedia(ex.id, label.trim(), file, f => setPct(Math.round(f * 100)))
    job.current = p
    p.then(({ media }) => {
      setPct(null); setLabel(''); job.current = null
      toast(media && media.status === 'raw' ? t('Uploaded — read the warning below') : t('Uploaded'))
      load()
    }).catch(e2 => { setPct(null); job.current = null; if (!e2.aborted) setErr(e2.message) })
  }

  const byEx = {}
  for (const m of rows || []) (byEx[m.exId] = byEx[m.exId] || []).push(m)
  const anyRaw = (rows || []).some(m => m.status === 'raw')

  return <>
    <h3>{t('Exercise demos')}</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      {t('Your own video of an exercise, shown to every client in place of the stock animation. Works for exercises you created yourself, which have never had one. MP4 or MOV, up to 90 MB, six per exercise.')}
    </div>

    <h4 className="sec">1 &middot; {t('Pick the exercise')}</h4>
    {ex
      ? <div className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small capitalize" style={{ fontWeight: 600 }}>{exerciseNameFor(ex)}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>
            {t('{0} of {1} uploaded', mine.length, 6)}{ex.custom ? ' \u00b7 ' + t('your own exercise') : ''}</div></div>
        <button className="btn" style={{ width: 'auto', padding: '4px 10px' }} disabled={pct != null}
          onClick={() => { setEx(null); setErr('') }}>{t('Change')}</button>
      </div>
      : <>
        <input className="input" placeholder={t('Search the exercise library')} value={q}
          onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
        {hits.map(e => <div key={e.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}
          onClick={() => { setEx(e); setQ('') }}>
          <div><div className="small capitalize" style={{ fontWeight: 600 }}>{exerciseNameFor(e)}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>
              {e.custom ? t('your own exercise') : t(e.bp)}{(byEx[e.id] || []).length ? ' \u00b7 ' + tp(byEx[e.id].length, '{0} video uploaded', '{0} videos uploaded') : ''}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>)}
        {q.trim().length >= 2 && !hits.length && <div className="empty small">{t('Nothing matches that.')}</div>}
      </>}

    {ex && <>
      <h4 className="sec">2 &middot; {t('Send the video')}</h4>
      <input className="input" placeholder={t('Label (optional) — e.g. side on, 60kg')} maxLength={40}
        value={label} onChange={e => setLabel(e.target.value)} style={{ marginBottom: 10 }} />
      {/* A plain file input behind the app's own button: the native control renders differently
          on every platform and is the loudest unfinished tell there is. */}
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
      {pct == null
        ? <Button variant="primary" icon="upload" disabled={atCap} onClick={() => fileRef.current?.click()}>
          {atCap ? t('This exercise is full ({0} videos)', 6) : t('Choose a video')}
        </Button>
        : <>
          {/* 90 MB over a phone connection is minutes, and fetch has no progress event at all —
              which is the whole reason lib/api.js reaches for XHR for this one call. */}
          <div className="wprog" style={{ marginBottom: 8 }}><i style={{ width: pct + '%' }} /></div>
          <div className="row between">
            <span className="dim small">{pct < 100 ? t('Uploading {0}%', pct) : t('Checking the file…')}</span>
            <button className="btn" style={{ width: 'auto', padding: '4px 10px' }}
              onClick={() => job.current?.abort()}>{t('Cancel')}</button>
          </div>
        </>}
      {atCap && <div className="dim small" style={{ marginTop: 8, lineHeight: 1.4 }}>
        {t('The cap is per exercise and nothing can remove a video yet — the next one has to go on a different exercise.')}
      </div>}
      {/* The server's own words. It knows what was wrong with the file; this screen does not. */}
      {err && <div className="small" style={{ marginTop: 10, lineHeight: 1.45, color: 'var(--red)' }}>{err}</div>}
    </>}

    <h4 className="sec">{t('Already uploaded')}</h4>
    {rows == null ? <div className="dim small">{t('Loading…')}</div>
      : !rows.length ? <div className="empty small">{t('Nothing yet. Clients see the stock animation until you upload one.')}</div>
        : <>
          {Object.keys(byEx).sort((a, b) => exName(a).localeCompare(exName(b))).map(exId => <div key={exId} style={{ marginBottom: 10 }}>
            <div className="small capitalize" style={{ fontWeight: 600, marginBottom: 2 }}>{exName(exId)}</div>
            {byEx[exId].map(m => <div key={m.id}>
              <div className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}
                onClick={() => setPreview(preview === m.id ? null : m.id)}>
                <div><div className="small">{m.label || t('no label')}</div>
                  <div className="dim" style={{ fontSize: '.72rem' }}>
                    {fmtMB(m.bytes)} &middot; {fmtDate(String(m.created).slice(0, 10))}</div></div>
                {m.status === 'raw'
                  ? <span className="tag" style={{ color: 'var(--yellow)' }}>{t('needs conversion')}</span>
                  : <Icon name={preview === m.id ? 'chevronDown' : 'play'} />}
              </div>
              {/* Playable whatever the status says. "raw" is not "broken", it is "nothing has
                  confirmed every browser can decode this" — and the one way to find out is to
                  watch it, which is why the preview is here rather than a download link. */}
              {preview === m.id && <video src={mediaRowSrc(m)} controls playsInline preload="metadata"
                style={{ width: '100%', maxHeight: 260, background: '#000', borderRadius: 10, margin: '8px 0' }} />}
            </div>)}
          </div>)}
          {anyRaw && <div className="dim small" style={{ marginTop: 6, lineHeight: 1.45 }}>
            {t('“Needs conversion” means HEVC inside a .mov — what an iPhone records unless you tell it otherwise. It is stored, listed and played like any other file, and Safari handles it; Chrome and Firefox usually do not, and a client on one of those quietly sees the stock animation instead. Nothing converts it for you. Either set the camera to “Most Compatible”, or re-export as H.264 MP4 and upload that.')}
          </div>}
        </>}
  </>
}
