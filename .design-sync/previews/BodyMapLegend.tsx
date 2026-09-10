import { BodyMapLegend } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const Legend = () => (
  <Phone>
    <div className="card" style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <BodyMapLegend />
    </div>
  </Phone>
)
