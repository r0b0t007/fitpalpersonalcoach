import { useState } from 'react'
import { MultiSelectRow, Section } from 'opengym-frontend'
import { Phone } from '../preview-frame'

const equipment = [
  { value: 'barbell', label: 'Barbell' }, { value: 'dumbbell', label: 'Dumbbells' },
  { value: 'cable', label: 'Cable' }, { value: 'machine', label: 'Machine' }, { value: 'bodyweight', label: 'Body weight' },
]

const useToggle = (initial: string[]) => {
  const [values, setValues] = useState<(string | number)[]>(initial)
  const onToggle = (v: string | number) => setValues(vs => vs.includes(v) ? vs.filter(x => x !== v) : [...vs, v])
  return { values, onToggle }
}

export const Picked = () => {
  const s = useToggle(['barbell', 'dumbbell'])
  return (
    <Phone>
      <Section title="Home gym">
        <MultiSelectRow icon="dumbbell" iconTint="var(--teal)" title="Equipment" options={equipment} noneLabel="Any" doneLabel="Done" {...s} />
      </Section>
    </Phone>
  )
}

export const NothingPicked = () => {
  const s = useToggle([])
  return (
    <Phone>
      <Section title="Home gym">
        <MultiSelectRow icon="dumbbell" iconTint="var(--teal)" title="Equipment" options={equipment} noneLabel="Any" doneLabel="Done" {...s} />
      </Section>
    </Phone>
  )
}
