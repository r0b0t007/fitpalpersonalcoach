import { useState } from 'react'
import { TextArea } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const Empty = () => {
  const [v, setV] = useState('')
  return <Phone><TextArea value={v} onChange={e => setV(e.target.value)} placeholder="A note for Sara: what to focus on this block" /></Phone>
}

export const Filled = () => {
  const [v, setV] = useState('Week 1 is a deload. Keep 3 reps in reserve on every set and log your bodyweight every morning.')
  return <Phone><TextArea value={v} onChange={e => setV(e.target.value)} /></Phone>
}
