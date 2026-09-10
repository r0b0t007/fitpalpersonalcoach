import { Button } from 'opengym-frontend'
import { Phone, Stack } from '../preview-frame'

export const Variants = () => (
  <Phone>
    <Stack gap={10}>
      <Button variant="primary">Send program</Button>
      <Button variant="tinted" icon="plus">Invite a client</Button>
      <Button variant="danger" icon="trash">Revoke link</Button>
      <Button variant="ghost">Not now</Button>
    </Stack>
  </Phone>
)

export const Sizes = () => (
  <Phone>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button variant="tinted" size="sm" icon="plus">New program</Button>
      <Button variant="primary" size="sm">Save</Button>
      <Button variant="tinted" size="xs" icon="pencil">Edit</Button>
      <Button variant="plain" size="sm" trailingIcon="chevronRight">See all</Button>
    </div>
  </Phone>
)

export const Disabled = () => (
  <Phone>
    <Button variant="primary" disabled>Sending…</Button>
  </Phone>
)
