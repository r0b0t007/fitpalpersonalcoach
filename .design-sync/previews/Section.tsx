import { Section, Row, Switch } from 'opengym-frontend'
import { Phone } from '../preview-frame'

const noop = () => {}

export const Settings = () => (
  <Phone>
    <Section title="Coaching" footer="Clients see your name and the programs you send them.">
      <Row icon="link" iconTint="var(--acc)" title="Invite link" subtitle="2 links waiting" accessory="chevron" onClick={noop} />
      <Row icon="camera" iconTint="var(--teal)" title="Exercise demos" subtitle="6 videos" accessory="chevron" onClick={noop} />
      <Row icon="figureStrength" iconTint="var(--indigo)" title="Train myself" accessory="chevron" onClick={noop} />
    </Section>
    <Section title="Notifications">
      <Row icon="bell" iconTint="var(--red)" title="Check-in reminders"><Switch checked onChange={noop} /></Row>
      <Row icon="clock" iconTint="var(--grey)" title="Reminder time" value="18:30" accessory="chevron" onClick={noop} />
    </Section>
  </Phone>
)

export const Values = () => (
  <Phone>
    <Section title="Program">
      <Row title="Weekly check-in" value="Sunday" accessory="chevron" onClick={noop} />
      <Row title="Language" value="Français" accessory="chevron" onClick={noop} />
      <Row title="Push, pull, legs" subtitle="3 routines · sent 2 days ago" accessory="check" />
      <Row title="Delete program" danger onClick={noop} />
    </Section>
  </Phone>
)
