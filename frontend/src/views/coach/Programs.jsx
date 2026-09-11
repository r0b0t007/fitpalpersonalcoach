import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { fetchPrograms, savePrograms, migrateLocalPrograms } from '../../lib/programs.js'
import { newProgramDraft, bundleOf } from '../../lib/program-draft.js'
import { uid } from '../../lib/format.js'
import { glyphOf } from '../../lib/glyphs.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

// The coach's library. It lives on the server now (lib/programs.js), so it is the same list on
// every device, it does not ride along on every state push, and a coach who never trains still
// has somewhere to keep it.
//
// This screen is now only the list. Everything a program can do — rename, edit its routines,
// schedule it, send it, delete it — moved into the editor at /programs/:pid, which is where a
// coach expects to find it and where there is room to say what each thing means.
//
// A program is a frozen copy of routines: editing your own Plan afterwards never changes one, and
// neither does editing a program change what a client already accepted.
export default function Programs() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  // Subscribed, not read once: boot() pulls the coach's own state from the server AFTER this
  // screen can mount, so a version that read the local library from the first render found it
  // empty and silently skipped the migration for anyone who opened this tab quickly.
  const localCount = (useStore(s => s.S.programs) || []).length
  const [programs, setPrograms] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => fetchPrograms()
    .then(async ({ programs: remote }) => {
      // The one-time lift of a pre-server library. Additive and id-keyed, so a second device
      // running this after the first finds everything already there and does nothing.
      const local = useStore.getState().S.programs || []
      if (local.length) {
        const { moved, failed, programs: after, safeIds } = await migrateLocalPrograms(local, remote)
        // Drop exactly the rows that are now on the server, and nothing else. A row the server
        // refused, or one too damaged to send, stays local where the coach can still see it —
        // clearing the lot would destroy the only copy of it. This also runs when `moved` is 0,
        // which is the second-device case: everything was already up there, so the local copy
        // goes and stops riding every state push. The DEF key stays for a release so an older
        // device pulling its own state cannot resurrect a library that has already moved.
        if (safeIds.size) useStore.getState().update(s => { s.programs = (s.programs || []).filter(p => !safeIds.has(p && p.id)) })
        if (moved || failed.length) {
          setPrograms(after)
          toast(failed.length
            ? `Moved ${moved} · ${failed.length} could not be moved and are still on this device`
            : `Moved ${moved} ${moved === 1 ? 'program' : 'programs'} to your library`)
          return
        }
      }
      setPrograms(remote)
    })
    // A failed load must not read as an empty library: "No programs yet" to a coach whose
    // session expired is the app telling them their work is gone.
    .catch(e => { toast(e.message || 'Failed to load'); setPrograms(false) })

  // Re-runs when the pulled state arrives carrying a library to move.
  useEffect(() => { load() }, [localCount])

  // Created on the server before the editor opens, rather than kept in memory until it looks
  // finished: the editor autosaves against a real id, and a program the coach abandons is one row
  // they can delete — not work that quietly evaporated when they backed out.
  const create = () => {
    if (busy) return
    setBusy(true)
    const id = uid()
    const draft = newProgramDraft()
    savePrograms({ id, name: draft.name, bundle: bundleOf(draft, useStore.getState().S.customEx) })
      .then(() => nav('/programs/' + id))
      .catch(e => { toast(e.message); setBusy(false) })
  }

  return <div className="narrow">
    <div className="hdr">
      <div style={{ flex: 1 }}><h1 style={{ margin: 0 }}>Programs</h1>
        <div className="sub">{programs === false ? 'Could not load' : programs ? (programs.length ? programs.length + ' in your library' : 'Nothing saved yet') : 'Loading…'}</div></div>
      <Button variant="tinted" size="sm" icon="plus" disabled={busy} onClick={create}>New</Button>
    </div>

    <div className="list">
      {(Array.isArray(programs) ? programs : []).map(p => {
        const days = Object.keys(p.bundle?.week || {}).length
        const ex = (p.bundle?.routines || []).reduce((n, r) => n + (r.ex || []).length, 0)
        const routines = p.bundle?.routines?.length || 0
        return <button key={p.id} className="item" onClick={() => nav('/programs/' + p.id)}>
          <span className="thumb" style={{ background: 'var(--acc-soft)', color: 'var(--acc)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
            <Icon name={glyphOf((p.bundle?.routines || [])[0]?.emoji)} />
          </span>
          <div className="grow">
            <div className="tt">{p.name}</div>
            <div className="ss">{routines} {routines === 1 ? 'routine' : 'routines'} · {ex} {ex === 1 ? 'exercise' : 'exercises'}</div>
          </div>
          {days > 0 && <span className="tag acc">{days} {days === 1 ? 'day' : 'days'}/wk</span>}
          <Icon name="chevronRight" className="chev" />
        </button>
      })}
      {programs === false && <div className="empty">
        Could not reach the server, so your library is not shown. Nothing has been lost — try again in a moment.
      </div>}
      {Array.isArray(programs) && !programs.length && <div className="empty">
        No programs yet. Start one here, or copy the routines out of your own Plan, then send it to
        as many clients as you like.
      </div>}
    </div>

    <p className="sect-f">
      Programs live in your library, not in your own plan. Editing one later never changes what a
      client has already accepted.
    </p>
  </div>
}
