import { LineChart } from 'opengym-frontend'
import { Phone } from '../preview-frame'

// A month of morning weigh-ins, drifting down from 74.2 towards a 70 kg goal. Fixed dates so
// the card renders the same every day.
const DAY = 86400000
const base = Date.UTC(2026, 7, 1, 8)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const weights = [74.2, 74.0, 74.3, 73.8, 73.9, 73.5, 73.6, 73.2, 73.4, 73.0, 72.9, 73.1, 72.6, 72.7, 72.4,
  72.5, 72.1, 72.3, 71.9, 72.0, 71.7, 71.8, 71.5, 71.6, 71.2, 71.4, 71.0, 71.1, 70.8, 70.9]
const points = weights.map((y, i) => ({ t: base + i * DAY, y, d: iso(base + i * DAY) }))

export const Bodyweight = () => (
  <Phone>
    <div className="card">
      <h2>Body weight</h2>
      <div className="big">70.9 <span className="muted" style={{ fontSize: 17, fontWeight: 400 }}>kg</span></div>
      <LineChart points={points} unit="kg" goal={70} />
    </div>
  </Phone>
)

// Effort carried by the dot: `m` in 0..1, bigger and more solid means less left in the tank.
const lifts = [80, 80, 82.5, 82.5, 85, 85, 87.5, 87.5, 90, 90].map((y, i) => ({
  t: base + i * 3 * DAY, y, d: iso(base + i * 3 * DAY), m: [0.2, 0.4, 0.3, 0.6, 0.4, 0.7, 0.5, 0.8, 0.7, 1][i],
}))

export const WithEffort = () => (
  <Phone>
    <div className="card">
      <h2>Bench press · top set</h2>
      <LineChart points={lifts} unit="kg" color="var(--blue)" />
    </div>
  </Phone>
)

export const Sparkline = () => (
  <Phone>
    <div className="card">
      <LineChart points={points} h={60} axes={false} />
    </div>
  </Phone>
)
