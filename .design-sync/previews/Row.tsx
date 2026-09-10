import { Row, Switch } from 'opengym-frontend'
import { Phone } from '../preview-frame'

const noop = () => {}
// Rows live inside a Section's `.sect-b`; the wrapper is what gives them their fill and hairlines.
const Group = ({ children }: { children: React.ReactNode }) => <div className="sect-b">{children}</div>

export const Kinds = () => (
  <Phone>
    <Group>
      <Row icon="people" iconTint="var(--blue)" title="Clients" subtitle="12 active" accessory="chevron" onClick={noop} />
      <Row icon="clipboard" iconTint="var(--acc)" title="Programs" accessory="chevron" onClick={noop} />
      <Row icon="chart" iconTint="var(--green)" title="Stats" subtitle="Progress and history" accessory="chevron" onClick={noop} />
    </Group>
  </Phone>
)

export const WithValue = () => (
  <Phone>
    <Group>
      <Row title="Check-in day" value="Sunday" accessory="chevron" onClick={noop} />
      <Row title="Weight unit" value="kg" accessory="chevron" onClick={noop} />
      <Row title="Sara Benali" subtitle="Last workout yesterday" value="86%" />
    </Group>
  </Phone>
)

export const WithControl = () => (
  <Phone>
    <Group>
      <Row icon="bell" iconTint="var(--red)" title="Check-in reminder"><Switch checked onChange={noop} /></Row>
      <Row icon="moon" iconTint="var(--indigo)" title="Keep screen awake" subtitle="During a workout"><Switch checked={false} onChange={noop} /></Row>
    </Group>
  </Phone>
)

export const Selected = () => (
  <Phone>
    <Group>
      <Row title="Push, pull, legs" subtitle="3 routines" accessory="check" onClick={noop} />
      <Row title="Upper / lower" subtitle="4 routines" onClick={noop} />
      <Row title="Remove client" danger onClick={noop} />
    </Group>
  </Phone>
)
