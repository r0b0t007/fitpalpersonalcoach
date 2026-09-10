import { useState } from 'react'
import { Segmented } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const Tabs = () => {
  const [v, setV] = useState<string | number>('overview')
  return (
    <Phone>
      <Segmented value={v} onChange={setV} options={[
        { value: 'overview', label: 'Overview' }, { value: 'program', label: 'Program' }, { value: 'checkins', label: 'Check-ins' },
      ]} />
    </Phone>
  )
}

export const Scale = () => {
  const [v, setV] = useState<string | number>(4)
  return (
    <Phone>
      <Segmented value={v} onChange={setV} options={[1, 2, 3, 4, 5].map(n => ({ value: n, label: String(n) }))} />
    </Phone>
  )
}

export const WithIcons = () => {
  const [v, setV] = useState<string | number>('system')
  return (
    <Phone>
      <Segmented value={v} onChange={setV} options={[
        { value: 'dark', icon: 'moon', label: 'Dark' }, { value: 'light', icon: 'sun', label: 'Light' }, { value: 'system', label: 'System' },
      ]} />
    </Phone>
  )
}

// A scale nobody has answered yet: no pill, so five blank check-in scales never read as "1/5".
export const Unanswered = () => (
  <Phone>
    <Segmented value={null} onChange={() => {}} options={[1, 2, 3, 4, 5].map(n => ({ value: n, label: String(n) }))} />
  </Phone>
)
