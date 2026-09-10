import { SwipeToDelete, Icon } from 'opengym-frontend'
import { Phone } from '../preview-frame'

// The swipe itself cannot be shown statically; the card shows the rows at rest, as the
// routine editor renders them.
const rows = [
  ['Bench press', '4 × 8 · 80 kg'],
  ['Incline dumbbell press', '3 × 10 · 26 kg'],
  ['Cable fly', '3 × 15 · 15 kg'],
]

export const Rows = () => (
  <Phone>
    <div className="list">
      {rows.map(([name, sets]) => (
        <SwipeToDelete key={name} onDelete={() => {}} onClick={() => {}}>
          <div className="item">
            <div className="grow"><div className="tt">{name}</div><div className="ss">{sets}</div></div>
            <Icon name="chevronRight" className="chev" />
          </div>
        </SwipeToDelete>
      ))}
    </div>
  </Phone>
)
