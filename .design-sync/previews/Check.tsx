import { Check } from 'opengym-frontend'
import { Phone } from '../preview-frame'

const noop = () => {}

export const States = () => (
  <Phone>
    <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
      <Check checked onChange={noop} />
      <Check checked={false} onChange={noop} />
      <Check checked size={38} onChange={noop} />
    </div>
  </Phone>
)

const sets: [string, boolean][] = [['Bench press', true], ['Incline dumbbell press', true], ['Cable fly', false]]

export const InRows = () => (
  <Phone>
    <div className="sect-b">
      {sets.map(([name, done]) => (
        <div key={name} className="lrow">
          <span className="lrow-m"><span className="lrow-t">{name}</span></span>
          <Check checked={done} onChange={noop} />
        </div>
      ))}
    </div>
  </Phone>
)
