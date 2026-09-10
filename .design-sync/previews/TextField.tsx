import { useState } from 'react'
import { TextField } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const Empty = () => {
  const [v, setV] = useState('')
  return <Phone><TextField value={v} onChange={e => setV(e.target.value)} placeholder="Program name" /></Phone>
}

export const Filled = () => {
  const [v, setV] = useState('Push, pull, legs')
  return <Phone><TextField value={v} onChange={e => setV(e.target.value)} placeholder="Program name" /></Phone>
}
