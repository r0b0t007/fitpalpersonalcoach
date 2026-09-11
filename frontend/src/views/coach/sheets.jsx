import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api, fetchExerciseMedia, uploadExerciseMedia } from '../../lib/api.js'
import { setCoachMedia } from '../../lib/coach-media.js'
import { EXIDX, allExercises, matchesExerciseSearch, mediaRowSrc } from '../../lib/exercises.js'
import { fmtDate, uid } from '../../lib/format.js'
import { buildPlanBundle, buildProgramBundle } from '../../lib/plan-share.js'
import { savePrograms } from '../../lib/programs.js'
import { confirmSheet } from '../../sheets.jsx'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'
import { rel } from './parts.jsx'

// The coach's sheets: send a program, save one, invite a client, upload a demo. Moved out of the
// old single-file dashboard unchanged when it split into screens; they are opened from Today,
// Clients and a client's page. English-only, like every coach surface.
//
// Programs are authored in the ordinary Plan screen and then SAVED as a named snapshot — a frozen
// copy of the routines you chose. That keeps one place to write routines while still separating
// client programming from personal training: once saved, changing your own Plan does not touch a
// program you already have in the library, and sending picks a program rather than shipping
// everything you happen to have.

// Labels and units for the four numbers, in the order a coach reads them. English, like the rest
// of this screen; the member's side of the same four numbers is translated (components/MacroRows).
const MACRO_FIELDS = [['kcal', 'Calories', 'kcal'], ['p', 'Protein', 'g'], ['c', 'Carbs', 'g'], ['f', 'Fat', 'g']]
// getDay() order, 0 = Sunday, matching lib/checkins.js. Listed Monday-first because that is how a
// training week reads, with Sunday last where the default actually sits.
const CHECKIN_DAYS = [[1, 'Monday'], [2, 'Tuesday'], [3, 'Wednesday'], [4, 'Thursday'],
  [5, 'Friday'], [6, 'Saturday'], [0, 'Sunday']]

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
  const bundle = program ? program.bundle : buildPlanBundle(S, (user?.name || 'Coach') + '’s program')
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
      .then(({ sent }) => { toast('Sent to ' + sent + (sent === 1 ? ' member' : ' members')); close(); onSent?.() })
      .catch(e => { toast(e.message); setBusy(false) })
  }

  if (!bundle.routines.length) return <>
    <h3>Nothing to send yet</h3>
    <div className="dim small" style={{ lineHeight: 1.5 }}>
      Build the program in your own Plan first — the routines you have there are what gets sent.
    </div>
  </>

  return <>
    <h3>{program ? 'Send “' + program.name + '”' : 'Send your current plan'}</h3>
    <div className="muted small" style={{ marginBottom: 4 }}>
      {bundle.routines.length} {bundle.routines.length === 1 ? 'routine' : 'routines'} · {exCount} exercises
      {days ? ' · scheduled on ' + days + (days === 1 ? ' day' : ' days') : ''}
    </div>
    <div className="dim small" style={{ marginBottom: 14, lineHeight: 1.4 }}>
      Each member is asked to accept before anything is added. Their own routines are never changed or removed.
    </div>

    <input className="input" placeholder="Note (optional) — what this block is for" maxLength={280}
      value={note} onChange={e => setNote(e.target.value)} style={{ marginBottom: 10 }} />

    {/* No toggle for a bundle with no scheduled days: the member's side (mergePlan) ignores
        `schedule` when the incoming week is empty, so ticking it would do nothing and look like
        it did. A saved program hits this for one of two reasons — the coach never put those
        routines on a weekday, or it was saved before buildProgramBundle kept the week at all
        (programs live in S and outlive the fix) — and only a re-save can tell them apart, so
        that is what the note asks for. */}
    {days ? <>
      <label className="row between" style={{ padding: '8px 2px', marginBottom: 6 }}>
        <span className="small">Also set their weekly schedule</span>
        <input type="checkbox" checked={schedule} onChange={e => setSchedule(e.target.checked)} />
      </label>
      {schedule && <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.4 }}>
        This replaces which routine sits on each weekday for them. Leave it off to add the routines and let them slot them in.
      </div>}
    </> : <div className="dim small" style={{ padding: '8px 2px', marginBottom: 10, lineHeight: 1.4 }}>
      {program
        ? 'No weekly schedule in this program. If its routines are on weekdays in your Plan, save the program again and the schedule comes with it.'
        : 'No weekly schedule to send — none of these routines is on a weekday in your Plan.'}
    </div>}

    <h4 className="sec">Daily nutrition targets (optional)</h4>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.4 }}>
      Leave these blank to send the program alone. Filling any of them replaces their current targets when
      they accept — a half-set target, this block's calories against the last block's protein, is a number
      nobody could explain. Blank fields are not sent, so setting calories and protein means exactly that.
    </div>
    <div className="list" style={{ rowGap: 0, marginBottom: 10 }}>
      {MACRO_FIELDS.map(([k, label, unit]) => <label key={k} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
        <span className="small" style={{ fontWeight: 600 }}>{label}</span>
        <span className="row" style={{ gap: 8, alignItems: 'center' }}>
          <input className="input" inputMode="numeric" placeholder="—" style={{ width: 90, textAlign: 'end' }}
            value={macros[k]} onChange={e => macro(k, e.target.value)} />
          <span className="dim small" style={{ width: 34 }}>{unit}</span>
        </span>
      </label>)}
    </div>
    <h4 className="sec" style={{ marginTop: 16 }}>Check-in day</h4>
    <div className="dim small" style={{ marginBottom: 8, lineHeight: 1.4 }}>
      Which day their weekly check-in falls on. Leave it alone and this program does not touch it —
      a member who has been answering on a Wednesday stays on Wednesday.
    </div>
    <select className="input" value={checkinDay} onChange={e => setCheckinDay(e.target.value)}
      style={{ marginBottom: 10 }}>
      <option value="">Leave their day as it is</option>
      {CHECKIN_DAYS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>

    <input className="input" placeholder="Note on the diet (optional)" maxLength={280}
      value={macroNote} onChange={e => setMacroNote(e.target.value)} style={{ marginBottom: 6 }} />

    <h4 className="sec">Send to</h4>
    {members.length ? <div className="list" style={{ rowGap: 0 }}>
      {members.map(m => <label key={m.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{m.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{m.workouts} workouts · synced {rel(m.lastSync)}</div></div>
        <input type="checkbox" checked={picked.includes(m.id)} onChange={() => toggle(m.id)} />
      </label>)}
    </div> : <div className="empty small">No members assigned to you yet.</div>}

    <Button variant="primary" style={{ marginTop: 14 }} disabled={!picked.length || busy} onClick={send}>
      {busy ? 'Sending…' : picked.length ? 'Send to ' + picked.length + (picked.length === 1 ? ' member' : ' members') : 'Pick at least one member'}
    </Button>
  </>
}

// Saving a program = snapshotting the routines you picked. Copies, not references: a program
// you saved last month must not change because you edited your own Plan this morning.
export function SaveProgramSheet({ close, onSaved }) {
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.concat(id))

  // Straight to the library on the server. The old version pushed into the coach's own S, which
  // is why a program used to ride along on every state sync (lib/programs.js says more).
  const save = () => {
    if (!picked.length) { toast('Pick at least one routine'); return }
    const label = name.trim() || 'Program'
    setBusy(true)
    savePrograms({ id: uid(), name: label, bundle: buildProgramBundle(S, picked, label) })
      .then(d => { toast('Program saved'); onSaved?.(d.programs); close() })
      .catch(e => { toast(e.message); setBusy(false) })
  }

  const usable = (S.routines || []).filter(r => (r.ex || []).length)
  if (!usable.length) return <>
    <h3>Nothing to save yet</h3>
    <div className="dim small" style={{ lineHeight: 1.5 }}>
      Build the routines in your own Plan first, then come back and save the ones that make up this program.
    </div>
  </>

  return <>
    <h3>Save a program</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>
      This takes a copy of the routines you pick. Editing your own Plan later will not change it.
    </div>
    <input className="input" placeholder="Program name (e.g. Beginner Block A)" maxLength={40}
      value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 10 }} />
    <h4 className="sec">Routines to include</h4>
    <div className="list" style={{ rowGap: 0 }}>
      {usable.map(r => <label key={r.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{r.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{r.ex.length} exercises</div></div>
        <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
      </label>)}
    </div>
    <Button variant="primary" style={{ marginTop: 14 }} disabled={!picked.length || busy} onClick={save}>
      {picked.length ? 'Save ' + picked.length + (picked.length === 1 ? ' routine' : ' routines') + ' as a program' : 'Pick at least one routine'}
    </Button>
  </>
}

/* ---------------------------------------------------- exercise demos -- */
/* Videos the coach shoots themselves, keyed on the EXERCISE ID rather than on a dataset row —
   which is what finally gives custom exercises media, since the stock catalogue has no entry for
   a variation you invented last week.

   One sheet, three jobs: pick the exercise, send the file, see what is already up there.

   Every refusal from POST /api/media/exercise is worded FOR THE COACH — "use MP4 or MOV", "set
   the camera to Most Compatible, or export as JPEG", "file is larger than the 90 MB limit". Those
   strings are the instruction; they are printed verbatim and never collapsed into "upload
   failed", which would throw away the only thing that says what to change. */

const MB = b => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB'
// EXIDX carries the custom exercises too (the store registers them on load), so one lookup
// covers both. Falling back to the raw id keeps a demo for a deleted exercise visible and
// counted against the cap instead of vanishing from a list it still occupies.
const exName = id => (EXIDX[id] && EXIDX[id].n) || id

// Taking a client on. The code IS the product here: the coach makes one, reads it out or texts
// it, and the person who redeems it lands on their roster already assigned — which until now took
// an admin running assign-coach by hand after the fact.
//
// English-only raw strings, like the rest of this screen. It is an operator surface.
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

  const mint = async () => {
    setBusy(true)
    try {
      const { invite } = await api('/api/coach/invites/new', { method: 'POST', body: JSON.stringify({ note }) })
      // Straight to the clipboard: the only thing anyone does with a fresh code is send it to
      // somebody, and reading sixteen hex characters off a screen into a message is where a typo
      // becomes "your code doesn't work".
      //
      // BEFORE load(), not after. WebKit only honours a clipboard write while the user activation
      // from the tap is still live, and load() is a second round trip — so on Safari, which is
      // most of the phones and iPads a coach holds on a gym floor, awaiting it first meant the
      // write was refused every single time and the feature silently degraded to the fallback.
      try { await navigator.clipboard.writeText(invite.code); toast('Code copied — ' + invite.code) }
      catch { toast('Code ready — ' + invite.code) }
      setNote('')
      await load()
    } catch (e) { toast(e.message) } finally { setBusy(false) }
  }

  // Confirmed, like the identical action on the admin screen. There is no un-revoke route, this
  // button sits six pixels from Copy, and a code the coach has already texted to someone dies on
  // a mis-tap — the client then reads "invite code is no longer valid" while the coach has no
  // idea why. The message names the code and the note so the sheet is answerable without
  // remembering which row was tapped.
  const revoke = i => confirmSheet({
    title: 'Revoke this code?',
    message: (i.note ? `“${i.note}” — ` : '') + `${i.code} stops working immediately. If you have already sent it out, whoever has it will not be able to join.`,
    confirmText: 'Revoke', danger: true,
    onConfirm: () => api('/api/coach/invites/revoke', { method: 'POST', body: JSON.stringify({ code: i.code }) })
      .then(() => { toast('Code revoked'); return load() }).catch(e => toast(e.message))
  })

  const copy = async code => {
    try { await navigator.clipboard.writeText(code); toast('Copied ' + code) }
    catch { toast(code) }
  }

  return <>
    <h3>Take a client on</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      Make a code and give it to the person joining. They enter it when they sign up, and they
      arrive already on your roster — nobody has to assign them afterwards.
    </div>

    {/* A code only does anything on an instance that gates signup on codes. With INVITE_ONLY off
        registration never looks at an invite at all, so the code would be real, redeemable, and
        bind nothing — worth saying before they hand one out, not after. */}
    {state && !state.inviteOnly && <div className="card" style={{ borderColor: 'var(--red)', marginBottom: 12 }}>
      <div className="small" style={{ lineHeight: 1.45 }}>
        This gym does not require a code to sign up, so a code will not put anyone on your roster.
        Ask an admin to turn invite-only on first.
      </div>
    </div>}

    <input className="input" placeholder="Who is it for? (optional)" value={note} maxLength={60}
      onChange={e => setNote(e.target.value)} style={{ marginBottom: 8 }} />
    <Button variant="primary" disabled={busy || !state || open.length >= state.max} onClick={mint}>
      {busy ? 'Making…' : 'Make a code'}
    </Button>
    {!!state && open.length >= state.max && <div className="dim small" style={{ marginTop: 6 }}>
      You have {state.max} codes waiting. Revoke one you are not going to use.
    </div>}

    <h4 className="sec" style={{ marginTop: 18 }}>Waiting to be used</h4>
    {failed ? <div className="dim small">Could not load your codes.{' '}
      {/* A button, not an <a onClick> — with no href an anchor is not keyboard-focusable and gets
          no pointer cursor, and this is the only retry on a sheet whose Make-a-code button is
          disabled until a load succeeds. Unreachable here means stuck here. */}
      <button className="btn" style={{ width: 'auto', padding: '2px 10px' }} onClick={load}>Try again</button></div>
      : state === null ? <div className="dim small">Loading…</div>
      : open.length ? <div className="list" style={{ rowGap: 0 }}>
        {open.map(i => <div key={i.code} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <div>
            <div className="small" style={{ fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>{i.code}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>
              {i.note ? i.note + ' · ' : ''}made {fmtDate(String(i.created).slice(0, 10))}</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn" style={{ width: 'auto', padding: '4px 10px' }} onClick={() => copy(i.code)}>Copy</button>
            <button className="iconbtn" aria-label={'Revoke ' + i.code} onClick={() => revoke(i)}><Icon name="trash" /></button>
          </div>
        </div>)}
      </div> : <div className="dim small">No codes waiting.</div>}

    {!!dead.length && <>
      <h4 className="sec" style={{ marginTop: 18 }}>Revoked</h4>
      <div className="list" style={{ rowGap: 0 }}>
        {dead.map(i => <div key={i.code} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)', opacity: .55 }}>
          <div><div className="small" style={{ fontWeight: 600, textDecoration: 'line-through', fontFamily: 'ui-monospace, monospace' }}>{i.code}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>{i.note || 'no note'} · will not work</div></div>
        </div>)}
      </div>
    </>}

    {/* Kept rather than hidden once used: this is the record of who came in on which code, and
        it is the only place a coach can see that a code they sent was actually redeemed. */}
    {!!used.length && <>
      <h4 className="sec" style={{ marginTop: 18 }}>Used</h4>
      <div className="list" style={{ rowGap: 0 }}>
        {used.map(i => <div key={i.code} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
          <div><div className="small" style={{ fontWeight: 600 }}>{i.usedByName || 'someone'}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>
              {i.note ? i.note + ' · ' : ''}joined {fmtDate(String(i.usedAt).slice(0, 10))}</div></div>
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
      toast(media && media.status === 'raw' ? 'Uploaded — read the warning below' : 'Uploaded')
      load()
    }).catch(e2 => { setPct(null); job.current = null; if (!e2.aborted) setErr(e2.message) })
  }

  const byEx = {}
  for (const m of rows || []) (byEx[m.exId] = byEx[m.exId] || []).push(m)
  const anyRaw = (rows || []).some(m => m.status === 'raw')

  return <>
    <h3>Exercise demos</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.45 }}>
      Your own video of an exercise, shown to every member in place of the stock animation.
      Works for exercises you created yourself, which have never had one. MP4 or MOV, up to 90 MB,
      six per exercise.
    </div>

    <h4 className="sec">1 &middot; Pick the exercise</h4>
    {ex
      ? <div className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small capitalize" style={{ fontWeight: 600 }}>{ex.n}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>
            {mine.length} of 6 uploaded{ex.custom ? ' \u00b7 your own exercise' : ''}</div></div>
        <button className="btn" style={{ width: 'auto', padding: '4px 10px' }} disabled={pct != null}
          onClick={() => { setEx(null); setErr('') }}>Change</button>
      </div>
      : <>
        <input className="input" placeholder="Search the exercise library" value={q}
          onChange={e => setQ(e.target.value)} style={{ marginBottom: 6 }} />
        {hits.map(e => <div key={e.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}
          onClick={() => { setEx(e); setQ('') }}>
          <div><div className="small capitalize" style={{ fontWeight: 600 }}>{e.n}</div>
            <div className="dim" style={{ fontSize: '.72rem' }}>
              {e.custom ? 'your own exercise' : e.bp}{(byEx[e.id] || []).length ? ' \u00b7 ' + byEx[e.id].length + ' uploaded' : ''}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>)}
        {q.trim().length >= 2 && !hits.length && <div className="empty small">Nothing matches that.</div>}
      </>}

    {ex && <>
      <h4 className="sec">2 &middot; Send the video</h4>
      <input className="input" placeholder="Label (optional) — e.g. side on, 60kg" maxLength={40}
        value={label} onChange={e => setLabel(e.target.value)} style={{ marginBottom: 10 }} />
      {/* A plain file input behind the app's own button: the native control renders differently
          on every platform and is the loudest unfinished tell there is. */}
      <input ref={fileRef} type="file" accept="video/*" hidden onChange={onFile} />
      {pct == null
        ? <Button variant="primary" icon="upload" disabled={atCap} onClick={() => fileRef.current?.click()}>
          {atCap ? 'This exercise is full (6 videos)' : 'Choose a video'}
        </Button>
        : <>
          {/* 90 MB over a phone connection is minutes, and fetch has no progress event at all —
              which is the whole reason lib/api.js reaches for XHR for this one call. */}
          <div className="wprog" style={{ marginBottom: 8 }}><i style={{ width: pct + '%' }} /></div>
          <div className="row between">
            <span className="dim small">{pct < 100 ? 'Uploading ' + pct + '%' : 'Checking the file…'}</span>
            <button className="btn" style={{ width: 'auto', padding: '4px 10px' }}
              onClick={() => job.current?.abort()}>Cancel</button>
          </div>
        </>}
      {atCap && <div className="dim small" style={{ marginTop: 8, lineHeight: 1.4 }}>
        The cap is per exercise and nothing can remove a video yet — the next one has to go on a
        different exercise.
      </div>}
      {/* The server's own words. It knows what was wrong with the file; this screen does not. */}
      {err && <div className="small" style={{ marginTop: 10, lineHeight: 1.45, color: 'var(--red)' }}>{err}</div>}
    </>}

    <h4 className="sec">Already uploaded</h4>
    {rows == null ? <div className="dim small">Loading…</div>
      : !rows.length ? <div className="empty small">Nothing yet. Members see the stock animation until you upload one.</div>
        : <>
          {Object.keys(byEx).sort((a, b) => exName(a).localeCompare(exName(b))).map(exId => <div key={exId} style={{ marginBottom: 10 }}>
            <div className="small capitalize" style={{ fontWeight: 600, marginBottom: 2 }}>{exName(exId)}</div>
            {byEx[exId].map(m => <div key={m.id}>
              <div className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}
                onClick={() => setPreview(preview === m.id ? null : m.id)}>
                <div><div className="small">{m.label || 'no label'}</div>
                  <div className="dim" style={{ fontSize: '.72rem' }}>
                    {MB(m.bytes)} &middot; {fmtDate(String(m.created).slice(0, 10))}</div></div>
                {m.status === 'raw'
                  ? <span className="tag" style={{ color: 'var(--yellow)' }}>needs conversion</span>
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
            “Needs conversion” means HEVC inside a .mov — what an iPhone records unless you tell it
            otherwise. It is stored, listed and played like any other file, and Safari handles it;
            Chrome and Firefox usually do not, and a member on one of those quietly sees the stock
            animation instead. Nothing converts it for you. Either set the camera to “Most
            Compatible”, or re-export as H.264 MP4 and upload that.
          </div>}
        </>}
  </>
}
