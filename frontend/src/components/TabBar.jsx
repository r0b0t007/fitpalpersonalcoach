import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { effectiveRoutineIds, effectiveRoutines } from '../lib/history.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { isCoached } from '../lib/features.js'
import { unreadCount } from '../lib/notes.js'
import Icon from './Icon.jsx'

// Everything the You hub owns. /stats and /library lost their own cells; /settings, /history and
// the AI coach never had one. The two dashboards used to be here too — they now live in the
// coach shell (CoachTabBar.jsx), which this bar never renders alongside.
// 'coach' is the AI chat, which has no cell either. 'mycoach' is NOT here — it has its own cell.
const YOU_ROUTES = ['you', 'stats', 'history', 'library', 'muscles', 'nutrition', 'settings', 'coach']

export default function TabBar({ onStart }) {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  const assignments = useStore(s => s.assignments)
  const coached = isCoached(user)
  const unreadNotes = useStore(s => unreadCount(s.notes))
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  // Several routes have no cell of their own and all belong to the hub, so it stays lit while you
  // are inside any of them. Miss one and the bar reads as though nothing is selected.
  const on = k => cur === k || (k === 'you' && YOU_ROUTES.includes(cur))

  const startWorkout = () => {
    if (!S.active) {
      // A weekday can hold several routines; start the combined session if any of them has
      // exercises, otherwise fall through to the picker.
      if (effectiveRoutines(S, todayISO()).some(r => r.ex.length)) { onStart(effectiveRoutineIds(S, todayISO())); return }
    }
    nav('/workout')
  }
  const Tab = ({ k, icon, to, label, dot }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)}>
      <span className="tb-i"><Icon name={icon} />{dot && <i className="tb-dot" />}</span>
      <span>{label}</span>
    </button>
  )

  return (
    <nav id="tabbar">
      {/* A coached client's tabs read as the CHW-325 design: today, and the session to start. */}
      <Tab k="home" icon="house" to="/home" label={coached ? t('Today') : t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      {/* On the workout screen itself there is nothing to resume, so the button reads as the
          tab it is and stays lit (#29); anywhere else it brings you back to the exercise you
          were on — the marker is kept in S.active.cur and never moves on its own (#21). */}
      <button className={'start' + (S.active ? ' rec' : '') + (S.active && cur === 'workout' ? ' on' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? (cur === 'workout' ? 'dumbbell' : 'play') : 'dumbbell'} /></span>
        <span>{S.active ? (cur === 'workout' ? t('Workout') : t('Resume')) : coached ? t('Workout') : t('Start')}</span>
      </button>
      {/* The dot moved here from You with the offers themselves: an unanswered program is the one
          thing on this tab that is waiting on the client, and a dot on the hub pointed at a screen
          that no longer carries it. */}
      <Tab k="mycoach" icon="people" to="/mycoach" label={t('Coach')} dot={!!assignments?.length || unreadNotes > 0} />
      <Tab k="you" icon="personCircle" to="/you" label={t('You')} />
    </nav>
  )
}
