import { Logo } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const Wordmark = () => (
  <Phone>
    <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}><Logo size={40} /></div>
  </Phone>
)

export const Compact = () => (
  <Phone>
    <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0' }}><Logo size={24} subtitle={false} /></div>
  </Phone>
)
