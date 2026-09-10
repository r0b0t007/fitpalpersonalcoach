import { useState } from 'react'
import { NumberField, Icon } from 'opengym-frontend'
import { Phone } from '../preview-frame'

// NumberField is the bare input the Stepper wraps: `.num` is only styled inside `.stp`, and on
// its own it takes the `.field` look through className. Both real uses are shown.
export const AsField = () => {
  const [v, setV] = useState<number | null>(72.4)
  return <Phone><NumberField value={v} onChange={setV} className="field" placeholder="Body weight" /></Phone>
}

export const InsideStepper = () => {
  const [v, setV] = useState<number | null>(100)
  return (
    <Phone>
      <div className="stp">
        <button type="button"><Icon name="minus" /></button>
        <div className="val"><NumberField value={v} onChange={setV} /><i>kg</i></div>
        <button type="button"><Icon name="plus" /></button>
      </div>
    </Phone>
  )
}

export const Nullable = () => {
  const [v, setV] = useState<number | null>(null)
  return <Phone><NumberField value={v} onChange={setV} nullable decimal={false} className="field" placeholder="RIR (optional)" /></Phone>
}
