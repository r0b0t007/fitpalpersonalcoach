import { useState } from 'react'
import { Stepper } from 'opengym-frontend'
import { Phone } from '../preview-frame'

export const Weight = () => {
  const [v, setV] = useState(62.5)
  return <Phone><Stepper value={v} onChange={setV} step={2.5} unit="kg" label="Weight" /></Phone>
}

export const Reps = () => {
  const [v, setV] = useState(8)
  return <Phone><Stepper value={v} onChange={setV} step={1} decimal={false} label="Reps" /></Phone>
}

export const SideBySide = () => {
  const [w, setW] = useState(80)
  const [r, setR] = useState(5)
  return (
    <Phone>
      <div className="grid2">
        <Stepper value={w} onChange={setW} step={2.5} unit="kg" label="Weight" />
        <Stepper value={r} onChange={setR} step={1} decimal={false} label="Reps" />
      </div>
    </Phone>
  )
}

export const Invalid = () => {
  const [v, setV] = useState(0)
  return <Phone><Stepper value={v} onChange={setV} step={2.5} unit="kg" label="Weight" invalid /></Phone>
}
