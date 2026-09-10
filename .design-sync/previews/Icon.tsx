import { Icon, ICON_NAMES } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const All = () => (
  <Phone>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 10 }}>
      {(ICON_NAMES as string[]).map(n => (
        <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, fontSize: 9, color: 'var(--label-2)' }}>
          <Icon name={n} size={22} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', whiteSpace: 'nowrap' }}>{n}</span>
        </div>
      ))}
    </div>
  </Phone>
)

export const Sizes = () => (
  <Phone>
    <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
      <Icon name="flame" size={16} /><Icon name="flame" size={22} /><Icon name="flame" size={28} /><Icon name="flame" size={40} />
      <span style={{ color: 'var(--acc)', fontSize: 28 }}><Icon name="bolt" /></span>
    </div>
  </Phone>
)
