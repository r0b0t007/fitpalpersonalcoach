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
 * The program editor.
 *
 * Two screens share one draft: this page, and the routine editor at `r/:rid`. They are nested
 * routes under a single shell for exactly that reason — if each loaded the program itself, walking
 * into a routine would race the debounced save of the page you just left and could reload the
 * version from before your last keystroke.
 *
 * Like the plan editor it mirrors, there is no save button: changes go up ~700ms after you stop,
 * and immediately when you leave. What the header shows is whether that has happened yet, because
 * a coach who closes the tab mid-save deserves to know the difference.
 */
function useProgramDraft(pid) {
  const toast = useUI(s => s.toast)
  const [draft, setDraft] = useState(null)     // null while loading, false when it is not there
  const [status, setStatus] = useState('')     // '' | 'saving' | 'saved' | a refusal, printed as-is
  const timer = useRef(null)
  const pendingRef = useRef(null)
  const flushRef = useRef(() => {})

  useEffect(() => {
    let alive = true
    fetchPrograms()
      .then(({ programs }) => {
        if (!alive) return
        const row = (programs || []).find(p => p && p.id === pid)
        setDraft(row ? draftFromProgram(row) : false)
      })
      // A failed load must not read as an empty program: showing a blank editor to a coach whose
      // session expired invites them to rebuild something that is still perfectly fine on the server.
      .catch(e => { if (alive) { toast(e.message || 'Could not load this program'); setDraft(false) } })
    return () => { alive = false }
  }, [pid])

  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const d = pendingRef.current
    if (!d) return
    pendingRef.current = null
    setStatus('saving')
    // The whole custom-exercise library goes in; buildPlanBundle keeps only what the routines
    // reference. See bundleOf.
    savePrograms({ id: pid, name: d.name.trim() || 'Program', bundle: bundleOf(d, useStore.getState().S.customEx) })
      .then(() => setStatus('saved'))
      // Printed verbatim: "plan is too large" and the library cap are the only thing that tells the
      // coach what to change, and collapsing them into "save failed" throws that away.
      .catch(e => setStatus(e.message || 'Could not save'))
  }
  flushRef.current = flush

  // Leaving the editor saves whatever is still pending. Fire-and-forget on purpose — the request
  // outlives the component, and there is nothing left on screen to report back to.
  useEffect(() => () => flushRef.current(), [])

  const edit = next => {
    setDraft(next)
    pendingRef.current = next
    setStatus('saving')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => flushRef.current(), SAVE_DEBOUNCE_MS)
  }

  return { draft, status, edit, flush: () => flushRef.current() }
}

export default function ProgramEditShell() {
  const { pid } = useParams()
  const ctx = useProgramDraft(pid)
  return <Outlet context={{ ...ctx, pid }} />
}

const StatusLine = ({ status }) => {
  if (status === 'saving') return <span className="dim small">Saving…</span>
  if (status === 'saved') return <span className="dim small">Saved</span>
  if (status) return <span className="small" style={{ color: 'var(--red)' }}>{status}</span>
  return null
}

export function ProgramEdit() {
  const nav = useNavigate()
  const { draft, status, edit, flush, pid } = useOutletContext()
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const [members, setMembers] = useState([])
  const ownRoutines = useStore(s => s.S.routines) || []

  useEffect(() => {
    api('/api/coach/members').then(d => setMembers(d.members || [])).catch(() => {})
  }, [])

  if (draft === null) return <div className="narrow"><div className="hdr"><h1 style={{ margin: 0 }}>Loading…</h1></div></div>
  if (draft === false) return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/programs')} aria-label="Programs"><Icon name="chevronLeft" /></button>
      <h1 style={{ margin: '0 0 0 12px' }}>Not found</h1>
    </div>
    <div className="empty">This program is no longer in your library. Nothing has been sent or changed.</div>
  </div>

  const roster = members.filter(m => !m.disabled)
  const routineOptions = draft.routines.map(r => ({ value: r.id, label: r.name }))
  const open = rid => { flush(); nav('/programs/' + pid + '/r/' + rid) }

  const add = () => { const { next, routine } = addRoutine(draft); edit(next); open(routine.id) }

  const copyFromPlan = () => openSheet(close => <CopyFromPlanSheet close={close} routines={ownRoutines}
    onPick={picked => {
      // A copy, with fresh ids: the program must not change when the coach edits their own plan
      // afterwards, and two programs built from the same routine must not share a row.
      let next = draft
      for (const r of picked) next = addRoutine(next, { ...copyRoutine(r), name: r.name }).next
      edit(next)
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
    onConfirm: () => deleteProgram(pid).then(() => nav('/programs')).catch(e => toast(e.message)),
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/programs')} aria-label="Programs"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input className="input" value={draft.name} maxLength={60} placeholder="Program name"
          style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => edit({ ...draft, name: e.target.value })} />
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
              onConfirm: () => edit(removeRoutine(draft, r.id)),
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
        onToggle={rid => edit(toggleDay(draft, d, rid))} />)}
    </Section>

    <div style={{ height: 6 }} />
    <Button variant="primary" icon="clipboard" disabled={!roster.length} onClick={send}>
      {roster.length ? 'Send to a client' : 'No clients yet'}
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
  // A program that vanished under us (deleted on another device) sends you back to the library
  // rather than to an editor bound to nothing.
  useEffect(() => { if (draft === false) nav(back, { replace: true }) }, [draft === false])

  if (!draft) return null

  return <RoutineTarget value={{
    routine: draft.routines.find(r => r.id === rid) || null,
    siblings: draft.routines,
    // The coach's equipment profile describes the coach's gym. Warning them that a client's
    // program needs kit they personally do not own would be noise at best and wrong at worst.
    ownEquipment: false,
    canRemove: canRemoveRoutine(draft),
    backPath: back,
    pathFor: id => back + '/r/' + id,
    patch: fn => edit(patchRoutine(draft, rid, fn)),
    addCopy: copy => edit(addRoutine(draft, copy).next),
    remove: () => edit(removeRoutine(draft, rid)),
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
