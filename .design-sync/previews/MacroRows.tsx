import { MacroRows } from 'opengym-frontend'
import { Phone } from '../preview-frame'

const target = { kcal: 2200, p: 160, c: 220, f: 70 }
const totals = { kcal: 1450, p: 112, c: 140, f: 48 }

export const Today = () => (
  <Phone>
    <div className="card">
      <h2>Today</h2>
      <MacroRows totals={totals} target={target} />
    </div>
  </Phone>
)

export const NoTarget = () => (
  <Phone>
    <div className="card">
      <h2>Today</h2>
      <MacroRows totals={totals} />
    </div>
  </Phone>
)

export const Compact = () => (
  <Phone>
    <div className="card">
      <MacroRows totals={{ kcal: 2310, p: 165, c: 240, f: 74 }} target={target} compact />
    </div>
  </Phone>
)
