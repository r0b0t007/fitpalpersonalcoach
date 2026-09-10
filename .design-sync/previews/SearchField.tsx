import { useState } from 'react'
import { SearchField } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const Empty = () => {
  const [q, setQ] = useState('')
  return <Phone><SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder="Search clients" /></Phone>
}

export const WithQuery = () => {
  const [q, setQ] = useState('sara')
  return <Phone><SearchField value={q} onChange={e => setQ(e.target.value)} onClear={() => setQ('')} placeholder="Search clients" /></Phone>
}
