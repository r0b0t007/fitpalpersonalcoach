import { fmtNum } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { MACROS, remainingOf } from '../lib/nutrition.js'

/** English keys; the locale packs carry the rest. Exported so every surface that shows these
 *  four numbers labels them identically — the log screen, the Stats panel and the coach. */
export const MACRO_LABEL = { kcal: 'Calories', p: 'Protein', c: 'Carbs', f: 'Fat' }
export const MACRO_UNIT = k => (k === 'kcal' ? 'kcal' : 'g')

// The four numbers, against the target when there is one. Purely prop-driven and it references
// no store at all, which is what lets the coach see their client's intake through the same
// component the client sees on their own screen — pass a different `totals`.
//
// The bar is never coloured by whether you are over. Over on calories is a problem and over on
// protein is not, and only the client and their coach know which target was which way round —
// the same reason the tape's deltas are left uncoloured in MeasurementsCard.
export function MacroRows({ totals, target, compact = false }) {
  const left = remainingOf(totals, target)
  return <div className="list" style={{ gap: 0 }}>
    {MACROS.map(k => {
      const goal = target?.[k]
      const eaten = totals?.[k] || 0
      const pct = goal ? Math.min(100, Math.round((eaten / goal) * 100)) : 0
      return <div key={k} style={{ padding: compact ? '5px 2px' : '8px 2px', borderBottom: 'var(--hair) solid var(--sep)' }}>
        <div className="row between" style={{ alignItems: 'baseline', gap: 10 }}>
          <span className="small" style={{ fontWeight: 600 }}>{t(MACRO_LABEL[k])}</span>
          <span className="row" style={{ gap: 10, alignItems: 'baseline' }}>
            {left[k] != null && <span className="dim" style={{ fontSize: '.72rem' }}>
              {left[k] >= 0 ? t('{0} left', fmtNum(left[k])) : t('{0} over', fmtNum(-left[k]))}
            </span>}
            <b>{fmtNum(eaten)}{goal ? ' / ' + fmtNum(goal) : ''} <span className="dim" style={{ fontWeight: 400 }}>{MACRO_UNIT(k)}</span></b>
          </span>
        </div>
        {!!goal && <div style={{ height: 4, marginTop: 5, borderRadius: 3, background: 'var(--surface-2)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: pct + '%', borderRadius: 3, background: 'var(--acc)' }} />
        </div>}
      </div>
    })}
  </div>
}
