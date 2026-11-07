import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { referralLink } from '../../lib/referrals.js'
import { shareLink } from '../../lib/share.js'
import { useUI } from '../../store/useUI.js'
import { Row, Section } from '../../components/ui.jsx'

/**
 * Account's "Refer a coach" (CHW-350): the coach's referral link, to copy or share, and how many
 * coaches signed up through it and activated. Counts only, never who. The link is their public
 * page's handle, so a coach with no page is sent to make one first. Nothing is drawn until the
 * server answers, and nothing if it can't.
 */
export default function ReferralCard() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [r, setR] = useState(null)
  useEffect(() => {
    let live = true
    api('/api/coach/referrals').then(x => { if (live) setR(x) }, () => {})
    return () => { live = false }
  }, [])
  if (!r) return null

  const footer = t('One free month for every coach who signs up through your link, once a client who joined through their public page trains.')
  if (!r.handle) return <Section title={t('Refer a coach')} footer={footer}>
    <Row icon="link" iconTint="var(--acc)" title={t('Publish your page to get your referral link.')}
      accessory="chevron" onClick={() => nav('/account/page')} />
  </Section>

  const link = referralLink(r.handle)
  const share = async () => {
    const how = await shareLink({ url: link, title: t('Coach your clients with FitPal') })
    if (how === 'copied') toast(t('Referral link copied'))
    else if (how === 'failed') toast(link)
  }
  return <Section title={t('Refer a coach')} footer={footer}>
    <Row icon="link" iconTint="var(--acc)" title={link} subtitle={t('Copy or share your link')} accessory="chevron" onClick={share} />
    <Row icon="person" iconTint="var(--blue)" title={t('Coaches you referred')}
      value={t('{0} signed up · {1} active', r.signedUp, r.activated)} />
  </Section>
}
