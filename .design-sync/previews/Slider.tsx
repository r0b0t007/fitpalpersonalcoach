import { useState } from 'react'
import { Slider } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const RestTime = () => {
  const [v, setV] = useState(90)
  return (
    <Phone>
      <div className="row between" style={{ marginBottom: 6 }}>
        <span className="small muted">Rest between sets</span><span>{v} s</span>
      </div>
      <Slider value={v} onChange={setV} min={0} max={180} step={5} />
    </Phone>
  )
}

export const Extremes = () => {
  const [a, setA] = useState(0)
  const [b, setB] = useState(100)
  return (
    <Phone>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Slider value={a} onChange={setA} />
        <Slider value={b} onChange={setB} />
      </div>
    </Phone>
  )
}
