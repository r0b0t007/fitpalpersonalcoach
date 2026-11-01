import { getLang, t } from '../lib/i18n.js'
import { termsUrl } from '../lib/terms.js'
import { Check } from './ui.jsx'

/**
 * The coach terms box (CHW-357), the one control both the Start page and the terms screen use:
 * named by its sentence alone (the link beside it is not part of the name), and the sentence
 * ticks it too.
 */
export default function TermsConsent({ checked, onChange, id }) {
  return <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
    <Check checked={checked} onChange={onChange} labelledBy={id} />
    <div className="small">
      <span id={id} onClick={() => onChange(!checked)}>{t('I accept the coach terms and the data processing agreement')}</span>{' '}
      <a href={termsUrl(getLang())} target="_blank" rel="noopener noreferrer">{t('Read the coach terms')}</a>
    </div>
  </div>
}
