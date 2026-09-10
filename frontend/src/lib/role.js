// Which of the two shells a signed-in person gets, and the one preference that flips it.
//
// `user.coach` is the server's word (publicUser in api/server.js — an admin counts as a coach
// there too). App.jsx reads these once, at the top of the tree, and nothing below it branches on
// the role again: a coach lands in the coach shell (/today, their clients, their programs), a
// client in the training app (/home). Both route tables fall through to their own home, which
// is also what happens after sign-in — Login never navigates, so a coach still sitting on #/home
// is redirected because the coach table has no /home.
//
// The preference is a coach's own choice to use the app as a trainee for a while — "Train
// myself" — and it lives on this device only. Deliberately not in `S`: it would sync to every
// device and into every backup, and it means nothing for a client. A missing or unreadable
// localStorage (private mode, storage cleared) just means the default, the coach shell.
import { useSyncExternalStore } from 'react'

export const isCoach = user => !!user?.coach

export const shellFor = (user, pref) => (isCoach(user) && pref !== 'client' ? 'coach' : 'client')

export const homeFor = (user, pref) => (shellFor(user, pref) === 'coach' ? '/today' : '/home')

const KEY = 'gym_shell'
const read = () => {
  try { return localStorage.getItem(KEY) === 'client' ? 'client' : 'coach' } catch { return 'coach' }
}
let pref = read()
const subs = new Set()

export const getShellPref = () => pref

export function setShellPref(next) {
  pref = next === 'client' ? 'client' : 'coach'
  // Only the non-default is written, so a coach who came back to coaching leaves nothing behind.
  try { pref === 'client' ? localStorage.setItem(KEY, 'client') : localStorage.removeItem(KEY) } catch { /* storage unavailable: in-memory only */ }
  subs.forEach(fn => fn())
}

export const useShellPref = () =>
  useSyncExternalStore(fn => { subs.add(fn); return () => subs.delete(fn) }, getShellPref, getShellPref)
