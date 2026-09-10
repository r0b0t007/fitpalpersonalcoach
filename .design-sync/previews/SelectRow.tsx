import { useState } from 'react'
import { SelectRow, Section } from 'opengym-frontend'
import { Phone } from '../preview-frame'

const langs = [
  { value: 'en', label: 'English' }, { value: 'de', label: 'Deutsch' },
  { value: 'es', label: 'Español' }, { value: 'fr', label: 'Français' },
]
const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((label, value) => ({ value, label }))

export const InSettings = () => {
  const [lang, setLang] = useState<string | number>('fr')
  const [day, setDay] = useState<string | number>(0)
  return (
    <Phone>
      <Section title="Preferences">
        <SelectRow icon="globe" iconTint="var(--blue)" title="Language" value={lang} options={langs} onChange={setLang} />
        <SelectRow icon="calendar" iconTint="var(--acc)" title="Check-in day" value={day} options={days} onChange={setDay} />
      </Section>
    </Phone>
  )
}

// A long value gets its own line under the title instead of squeezing it.
export const StackedValue = () => {
  const [v, setV] = useState<string | number>('linear')
  const rules = [
    { value: 'linear', label: 'Follow the routine (Linear progression)' },
    { value: 'double', label: 'Double progression' },
    { value: 'none', label: 'No progression' },
  ]
  return (
    <Phone>
      <Section title="Bench press">
        <SelectRow title="Progression" value={v} options={rules} onChange={setV} stackedValue />
      </Section>
    </Phone>
  )
}
