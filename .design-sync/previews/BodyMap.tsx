import { BodyMap } from 'opengym-frontend'
import { Phone } from '../preview-frame'

// Effective sets per muscle for one week of push, pull, legs.
const load = {
  chest: 12, triceps: 8, deltoids: 10, 'upper-back': 9, biceps: 6, trapezius: 4,
  quadriceps: 14, hamstring: 7, gluteal: 11, abs: 4, calves: 3,
}

export const Balance = () => (
  <Phone>
    <div className="card">
      <h2>This week</h2>
      <BodyMap load={load} />
    </div>
  </Phone>
)

export const Female = () => (
  <Phone>
    <div className="card">
      <BodyMap load={load} body="female" />
    </div>
  </Phone>
)

export const Selected = () => (
  <Phone>
    <div className="card">
      <BodyMap load={load} selected="chest" onMuscle={() => {}} className="tappable" />
    </div>
  </Phone>
)
