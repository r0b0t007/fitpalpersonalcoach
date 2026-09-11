import { useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { fetchPrograms, savePrograms, deleteProgram } from '../../lib/programs.js'
import {
  draftFromProgram, bundleOf, patchRoutine, addRoutine, removeRoutine, toggleDay,
  canRemoveRoutine, WEEK_DAYS,
} from '../../lib/program-draft.js'
import { copyRoutine } from '../../lib/routines.js'
import { glyphOf } from '../../lib/glyphs.js'
import { api } from '../../lib/api.js'
import Icon from '../../components/Icon.jsx'
import { Button, MultiSelectRow, Section } from '../../components/ui.jsx'
import { RoutineTarget } from '../../components/RoutineTarget.jsx'
import { RoutineEditor } from '../RoutineEdit.jsx'
import { confirmSheet } from '../../sheets.jsx'
import { SendSheet } from './sheets.jsx'

const DAY_NAME = { 0: 'Sunday', 1: 'Monday', 2: 'Tuesday', 3: 'Wednesday', 4: 'Thursday', 5: 'Friday', 6: 'Saturday' }
const SAVE_DEBOUNCE_MS = 700

/**
 * The program editor's draft, and the one rule that matters about it.
 *
 * `edit` takes a PRODUCER — `edit(d => toggleDay(d, 1, id))` — never a finished draft. That is not
 * style, it is the whole correctness story, and it mirrors useStore's `update(mut)` for the same
 * reason. A sheet is opened once and its render closure is stored (store/useUI.js), so the
 * callbacks inside it are frozen at the render that opened them, while the sheets that matter here
 * stay open across several taps: the exercise picker deliberately does not close when you add one,
 * and the weekday sheet toggles as many routines as you like before Done. Had `edit` accepted a
 * value computed at the call site, every tap after the first would have been computed from the
 * draft as it stood before the sheet opened — add three exercises and keep only the third, tick two
 * routines onto Monday and store one, with the sheet cheerfully showing both ticked. Reading the
 * latest draft out of a ref at apply time is what makes the second tap see the first.
 *
 * Two screens share this: the page below and the routine editor at `r/:rid`, nested under one shell
 * so there is one draft. Loaded separately, walking into a routine would race the debounced save of
 * the page you just left and could reload the version from before your last keystroke.
 *
 * Like the plan editor it mirrors there is no save button: changes go up ~700ms after you stop, and
 * immediately when you leave.
 */
export function useProgramDraft(pid) {
  const toast = useUI(s => s.toast)
  // null while loading, false when the program is not there, 'error' when the load itself failed.
  // The last two are different things to say and the difference matters — see the render below.
  const [draft, setDraft] = useState(null)
  const [status, setStatus] = useState('')     // '' | 'unsaved' | 'saving' | 'saved' | a refusal
  const draftRef = useRef(null)
  const timer = useRef(null)
  const pendingRef = useRef(null)
  const flushRef = useRef(() => {})

  useEffect(() => {
    let alive = true
    fetchPrograms()
      .then(({ programs }) => {
        if (!alive) return
        const row = (programs || []).find(p => p && p.id === pid)
        draftRef.current = row ? draftFromProgram(row) : null
        setDraft(row ? draftRef.current : false)
      })
      // A failed load is NOT a missing program. Telling a coach whose session expired that their
      // program is gone is the app claiming their work was deleted when it is intact on the server.
      .catch(e => { if (alive) { toast(e.message || 'Could not load this program'); setDraft('error') } })
    return () => { alive = false }
  }, [pid])

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const d = pendingRef.current
    if (!d) return
    setStatus('saving')
    // The whole custom-exercise library goes in; buildProgramBundle keeps only what the routines
    // reference. See bundleOf.
    savePrograms({ id: pid, name: d.name.trim() || 'Program', bundle: bundleOf(d, useStore.getState().S.customEx) })
      // Cleared only once it is actually stored. Clearing before the request meant a refusal threw
      // the edit away: the coach saw red, left the screen, and the unmount flush found nothing to
      // retry with.
      .then(() => { if (pendingRef.current === d) pendingRef.current = null; setStatus('saved') })
      // Printed verbatim: "plan is too large" and the library cap are the only thing that tells the
      // coach what to change, and collapsing them into "save failed" throws that away.
      .catch(e => setStatus(e.message || 'Could not save'))
  }
  flushRef.current = flush

  // Leaving the editor saves whatever is still pending. Fire-and-forget on purpose — the request
  // outlives the component, and there is nothing left on screen to report back to.
  useEffect(() => () => flushRef.current(), [])

  /** Apply `producer` to the LATEST draft (see the note above) and return the result. */
  const edit = producer => {
    const cur = draftRef.current
    if (!cur) return cur
    const next = producer(cur)
    draftRef.current = next
    setDraft(next)
    pendingRef.current = next
    // Nothing has left the browser yet, and saying "Saving…" for 700ms while that is untrue is
    // exactly the window in which a closed tab loses an edit.
    setStatus('unsaved')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current(), SAVE_DEBOUNCE_MS)
    return next
  }

  // Deleting has to call this first. savePrograms is an upsert, so a debounced save still in flight
  // — or one the unmount flush would fire on the way out — puts the row straight back, and the
  // coach's deleted program reappears on the next load.
  const discard = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    pendingRef.current = null
    setStatus('')
  }

  return { draft, status, edit, discard, flush: () => flushRef.current() }
}

export default function ProgramEditShell() {
  const { pid } = useParams()
  const ctx = useProgramDraft(pid)
  return <Outlet context={{ ...ctx, pid }} />
}

const StatusLine = ({ status }) => {
  if (status === 'unsaved') return <span className="dim small">Unsaved</span>
  if (status === 'saving') return <span className="dim small">Saving…</span>
  if (status === 'saved') return <span className="dim small">Saved</span>
  if (status) return <span className="small" style={{ color: 'var(--red)' }}>{status}</span>
  return null
}

function Missing({ title, children }) {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/programs')} aria-label="Programs"><Icon name="chevronLeft" /></button>
      <h1 style={{ margin: '0 0 0 12px' }}>{title}</h1>
    </div>
    <div className="empty">{children}</div>
  </div>
}

export function ProgramEdit() {
  const nav = useNavigate()
  const { draft, status, edit, discard, flush, pid } = useOutletContext()
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const [members, setMembers] = useState([])
  const ownRoutines = useStore(s => s.S.routines) || []

  useEffect(() => {
    api('/api/coach/members').then(d => setMembers(d.members || [])).catch(() => {})
  }, [])

  if (draft === null) return <div className="narrow"><div className="hdr"><h1 style={{ margin: 0 }}>Loading…</h1></div></div>
  if (draft === 'error') return <Missing title="Could not load">
    Could not reach the server, so this program is not shown. Nothing has been lost — try again in a moment.
  </Missing>
  if (draft === false) return <Missing title="Not found">
    This program is no longer in your library. Nothing has been sent or changed.
  </Missing>

  const roster = members.filter(m => !m.disabled)
  const routineOptions = draft.routines.map(r => ({ value: r.id, label: r.name }))
  const open = rid => { flush(); nav('/programs/' + pid + '/r/' + rid) }
  // A program whose routines are all empty passes validateAssignmentBundle — it only refuses ZERO
  // routines — so nothing downstream stops a brand-new "Day 1 · 0 exercises" from being offered to
  // a client, who would accept it and get a training day that opens nothing.
  const sendable = draft.routines.some(r => (r.ex || []).length)

  const add = () => {
    let added
    edit(d => { const { next, routine } = addRoutine(d); added = routine; return next })
    if (added) open(added.id)
  }

  const copyFromPlan = () => openSheet(close => <CopyFromPlanSheet close={close} routines={ownRoutines}
    onPick={picked => {
      // A copy, with fresh ids: the program must not change when the coach edits their own plan
      // afterwards, and two programs built from the same routine must not share a row.
      edit(d => picked.reduce((acc, r) => addRoutine(acc, { ...copyRoutine(r), name: r.name }).next, d))
      toast('Added ' + picked.length + (picked.length === 1 ? ' routine' : ' routines'))
    }} />)

  const send = () => {
    flush()
    openSheet(close => <SendSheet members={roster} close={close}
      program={{ id: pid, name: draft.name, bundle: bundleOf(draft, useStore.getState().S.customEx) }} />)
  }

  const del = () => confirmSheet({
    title: 'Delete this program?',
    message: `“${draft.name || 'This program'}” goes from your library. Clients who already accepted it keep what they have.`,
    confirmText: 'Delete', danger: true,
    onConfirm: () => { discard(); deleteProgram(pid).then(() => nav('/programs')).catch(e => toast(e.message)) },
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/programs')} aria-label="Programs"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" value={draft.name} maxLength={60} placeholder="Program name"
          style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => edit(d => ({ ...d, name: e.target.value }))} />
      </div>
      <StatusLine status={status} />
    </div>

    <h4 className="sec">Routines</h4>
    <div className="list">
      {draft.routines.map(r => <div key={r.id} className="item" role="button" tabIndex={0}
        onClick={() => open(r.id)} onKeyDown={e => { if (e.key === 'Enter') open(r.id) }}>
        <span className="thumb" style={{ background: 'var(--acc-soft)', color: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
          <Icon name={glyphOf(r.emoji)} />
        </span>
        <div className="grow">
          <div className="tt">{r.name}</div>
          <div className="ss">{r.ex.length} {r.ex.length === 1 ? 'exercise' : 'exercises'}</div>
        </div>
        {canRemoveRoutine(draft) && <button className="iconbtn" aria-label={'Remove ' + r.name}
          onClick={e => {
            e.stopPropagation()
            confirmSheet({
              title: 'Remove this routine?',
              message: `“${r.name}” leaves this program and any day it was scheduled on. Your own plan is not touched.`,
              confirmText: 'Remove', danger: true,
              onConfirm: () => edit(d => removeRoutine(d, r.id)),
            })
          }}><Icon name="trash" /></button>}
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>
    <div style={{ height: 10 }} />
    <Button icon="plus" onClick={add}>Add a routine</Button>
    {ownRoutines.length > 0 && <>
      <div style={{ height: 10 }} />
      <Button icon="figureStrength" onClick={copyFromPlan}>Copy from my own plan</Button>
    </>}

    <Section title="Weekly schedule" footer={
      'Optional. A client only gets these days if you turn on “also set their weekly schedule” when you send it.'
    }>
      {WEEK_DAYS.map(d => <MultiSelectRow key={d} icon="calendar" title={DAY_NAME[d]} sheetTitle={DAY_NAME[d]}
        values={[].concat(draft.week[d] || [])} options={routineOptions} noneLabel="Rest"
        onToggle={rid => edit(cur => toggleDay(cur, d, rid))} />)}
    </Section>

    <div style={{ height: 6 }} />
    <Button variant="primary" icon="clipboard" disabled={!roster.length || !sendable} onClick={send}>
      {!roster.length ? 'No clients yet' : sendable ? 'Send to a client' : 'Add an exercise before sending'}
    </Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" icon="trash" onClick={del}>Delete program</Button>
    <p className="sect-f">
      Changes save on their own. Sending takes a copy — editing this program later never changes
      what a client has already accepted.
    </p>
  </div>
}

/** The shared routine editor, bound to a routine inside the program draft instead of to the store. */
export function ProgramRoutineEdit() {
  const { rid, pid } = useParams()
  const { draft, edit } = useOutletContext()
  const nav = useNavigate()
  const back = '/programs/' + pid
  // A program that vanished under us — deleted on another device, or a load that failed — sends you
  // back to the library rather than to an editor bound to nothing.
  const gone = draft === false || draft === 'error'
  useEffect(() => { if (gone) nav(back, { replace: true }) }, [gone])

  if (!draft || gone) return null

  return <RoutineTarget value={{
    routine: draft.routines.find(r => r.id === rid) || null,
    siblings: draft.routines,
    // The coach's equipment profile describes the coach's gym. Warning them that a client's
    // program needs kit they personally do not own would be noise at best and wrong at worst.
    ownEquipment: false,
    canRemove: canRemoveRoutine(draft),
    backPath: back,
    backLabel: 'Program',
    pathFor: id => back + '/r/' + id,
    // Producers, not values: these run inside sheets that stay open across several taps. See the
    // note on useProgramDraft.
    patch: fn => edit(d => patchRoutine(d, rid, fn)),
    addCopy: copy => edit(d => addRoutine(d, copy).next),
    remove: () => edit(d => removeRoutine(d, rid)),
  }}><RoutineEditor /></RoutineTarget>
}

function CopyFromPlanSheet({ close, routines, onPick }) {
  const [picked, setPicked] = useState([])
  const toggle = id => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : p.concat(id))
  const usable = routines.filter(r => (r.ex || []).length)

  if (!usable.length) return <>
    <h3>Nothing to copy</h3>
    <div className="dim small" style={{ lineHeight: 1.5 }}>
      Your own Plan has no routines with exercises in them yet.
    </div>
  </>

  return <>
    <h3>Copy from my own plan</h3>
    <div className="dim small" style={{ marginBottom: 12, lineHeight: 1.4 }}>
      This takes a copy. Editing your own Plan afterwards will not change this program.
    </div>
    <div className="list" style={{ rowGap: 0 }}>
      {usable.map(r => <label key={r.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{r.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{r.ex.length} exercises</div></div>
        <input type="checkbox" checked={picked.includes(r.id)} onChange={() => toggle(r.id)} />
      </label>)}
    </div>
    <Button variant="primary" style={{ marginTop: 14 }} disabled={!picked.length}
      onClick={() => { onPick(usable.filter(r => picked.includes(r.id))); close() }}>
      {picked.length ? 'Copy ' + picked.length + (picked.length === 1 ? ' routine' : ' routines') : 'Pick at least one'}
    </Button>
  </>
}
