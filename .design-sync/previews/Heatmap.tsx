import { Heatmap } from 'opengym-frontend'
import { Phone } from '../preview-frame'

// The heatmap always ends on the current week, so the fixture is built relative to today:
// three or four sessions a week over the last eight months, 40 to 75 minutes each.
const DAY = 86400000
const today = new Date(); today.setHours(12, 0, 0, 0)
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const workouts: { d: string; start: number; end: number; vol: number }[] = []
for (let back = 240; back >= 0; back--) {
  const dow = (back * 3) % 7
  if (dow === 0 || dow === 2 || dow === 4 || (dow === 6 && back % 2 === 0)) {
    const start = today.getTime() - back * DAY
    const minutes = 40 + ((back * 7) % 36)
    workouts.push({ d: iso(start), start, end: start + minutes * 60000, vol: 4000 + (back % 9) * 800 })
  }
}

export const Year = () => (
  <Phone>
    <div className="card">
      <h2>Training days</h2>
      <Heatmap S={{ workouts }} onDay={() => {}} />
    </div>
  </Phone>
)
