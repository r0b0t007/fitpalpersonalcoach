import { TargetRows } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const Full = () => (
  <Phone>
    <div className="card">
      <h2>Daily targets</h2>
      <TargetRows target={{ kcal: 2200, p: 160, c: 220, f: 70 }} />
    </div>
  </Phone>
)

// A macro the coach left unset stays out: no invented zero-carb prescription.
export const Partial = () => (
  <Phone>
    <div className="card">
      <h2>Daily targets</h2>
      <TargetRows target={{ kcal: 2000, p: 150 }} />
    </div>
  </Phone>
)
