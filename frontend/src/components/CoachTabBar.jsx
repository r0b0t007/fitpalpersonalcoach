import { useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'

// The coach's bar — the other half of the split App.jsx makes on lib/role.js.
//
// No raised Start cell: that
// is a trainee's affordance, and a coach's primary action differs per screen (Invite on Clients,
// New on Programs), so it lives in each screen's header instead. A cell is added here the day
// its screen lands — Today first, then Clients, Programs, Account as the redesign ships — rather
// than pointing a tab at a page that does not exist yet.
// Labels are functions so they are read in the current language at render, not once at import.
const CELLS = [
  { k: 'today', icon: 'house', to: '/today', label: () => t('Today') },
  { k: 'clients', icon: 'people', to: '/clients', label: () => t('Clients') },
  { k: 'programs', icon: 'clipboard', to: '/programs', label: () => t('Programs') },
  { k: 'account', icon: 'personCircle', to: '/account', label: () => t('Account') },
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
          <span>{c.label()}</span>
        </button>
      ))}
    </nav>
  )
}
