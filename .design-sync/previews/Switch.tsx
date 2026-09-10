import { Switch } from 'opengym-frontend'
import { Phone } from '../preview-frame'

const noop = () => {}
const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
    <span>{label}</span>{children}
  </div>
)

export const States = () => (
  <Phone>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Labeled label="On"><Switch checked onChange={noop} /></Labeled>
      <Labeled label="Off"><Switch checked={false} onChange={noop} /></Labeled>
      <Labeled label="Disabled"><Switch checked disabled onChange={noop} /></Labeled>
    </div>
  </Phone>
)
