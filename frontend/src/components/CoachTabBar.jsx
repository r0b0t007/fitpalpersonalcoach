import { useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon.jsx'

// The coach's bar — the other half of the split App.jsx makes on lib/role.js.
//
// English-only, like every coach surface (views/Coach.jsx says why). No raised Start cell: that
// is a trainee's affordance, and a coach's primary action differs per screen (Invite on Clients,
// New on Programs), so it lives in each screen's header instead. A cell is added here the day
// its screen lands — Today first, then Clients, Programs, Account as the redesign ships — rather
// than pointing a tab at a page that does not exist yet.
const CELLS = [
  { k: 'today', icon: 'house', to: '/today', label: 'Today' },
  { k: 'account', icon: 'personCircle', to: '/account', label: 'Account' },
]

export default function CoachTabBar() {
  const nav = useNavigate()
  const loc = useLocation()
  const cur = loc.pathname.split('/')[1] || 'today'
  return (
    <nav id="tabbar">
      {CELLS.map(c => (
        <button key={c.k} className={cur === c.k ? 'on' : ''} onClick={() => nav(c.to)}>
          <span className="tb-i"><Icon name={c.icon} /></span>
          <span>{c.label}</span>
        </button>
      ))}
    </nav>
  )
}
