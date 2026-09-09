import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { fmtDate, fmtNum, todayISO, uid } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import {
  MACROS, addMeal, entriesOn, foodKey, isValidFood, isValidGrams, loggedFood,
  rememberFood, removeMeal, searchFoods, targetOf, totalsFor
} from '../lib/nutrition.js'
import { MacroRows, MACRO_LABEL, MACRO_UNIT } from '../components/MacroRows.jsx'
import Icon from '../components/Icon.jsx'
import { Button, NumberField, SearchField, TextField } from '../components/ui.jsx'

// Log a food with grams, see four numbers against the target the coach set. That is the whole
// screen, and keeping it that small is the feature: every tracker that opens with recipes, meal
// plans, water and micronutrients is a tracker people stop opening.
//
// Everything typed here stays in COMPONENT state until Add is pressed. store.update() deep-clones
// the entire state blob — workouts included — and writes it to localStorage synchronously, so a
// grams field wired straight to it would re-serialise a lifetime of training on every keystroke.
export default function Nutrition() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const compactNutrition = useStore(s => s.compactNutrition)
  const toast = useUI(s => s.toast)

  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(null)     // a row from S.foods, or null
  const [grams, setGrams] = useState(100)
  const [fresh, setFresh] = useState(null)       // the "new food" form, or null when closed

  // Rolling old entries up is the one thing that keeps this feature from being the largest thing
  // in the synced blob, and here is where it costs nothing: the profiles it matters for are the
  // ones that log food, and those are the ones that open this screen.
  useEffect(() => { compactNutrition() }, [])

  const today = todayISO()
  const totals = totalsFor(S, today)
  const target = targetOf(S)
  const entries = entriesOn(S, today)
  const matches = searchFoods(S.foods, query)
  // Someone typing a name that isn't in their list is about to define it — offer that rather than
  // showing them an empty result and no way forward.
  const unknown = !!foodKey(query) && !matches.some(f => foodKey(f.n) === foodKey(query))

  const log = (food, id) => {
    if (!isValidGrams(grams)) { toast(t('Check the numbers — calories are required, and all four are per 100 g.')); return }
    update(s => {
      s.foods = rememberFood(s.foods, { ...food, id })
      s.meals = addMeal(s.meals, loggedFood({ ...food, id }, grams, { id: uid(), d: today }))
    })
    setQuery(''); setPicked(null); setFresh(null); setGrams(100)
    toast(t('Added {0}', food.n))
  }

  const addKnown = () => log(picked, picked.id)

  const addFresh = () => {
    const food = { ...fresh, kcal: +fresh.kcal || 0, p: +fresh.p || 0, c: +fresh.c || 0, f: +fresh.f || 0 }
    if (!isValidFood(food) || !isValidGrams(grams)) {
      toast(t('Check the numbers — calories are required, and all four are per 100 g.'))
      return
    }
    // A brand-new food gets an id here and joins the list, so the second time it is one tap.
    log(food, uid())
  }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Nutrition')}</h1><div className="sub">{fmtDate(today, true)}</div></div>
    </div>

    <div className="card">
      <MacroRows totals={totals} target={target} />
      {target?.note
        ? <div className="small" style={{ marginTop: 10, lineHeight: 1.4 }}>“{target.note}”</div>
        : !target && <div className="dim small" style={{ marginTop: 10, lineHeight: 1.4 }}>
          {t('No targets yet — your coach sets them with your program.')}
        </div>}
    </div>

    <div className="card">
      <h2>{t('Add food')}</h2>
      <SearchField value={query} placeholder={t('What did you eat?')}
        onChange={e => { setQuery(e.target.value); setPicked(null); setFresh(null) }}
        onClear={() => { setQuery(''); setPicked(null); setFresh(null) }} />

      {/* The personal list is the whole search. There is no food database behind this and v1 is
          honest about that — the ten things someone eats every week are the case that matters. */}
      {!picked && !fresh && <div className="list" style={{ gap: 0, marginTop: 6 }}>
        {matches.map(f => <div key={f.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)', cursor: 'pointer' }}
          onClick={() => setPicked(f)}>
          <span className="small" style={{ fontWeight: 600 }}>{f.n}</span>
          <span className="dim" style={{ fontSize: '.72rem' }}>{fmtNum(f.kcal)} kcal · {t('Per 100 g')}</span>
        </div>)}
      </div>}

      {picked && <>
        {/* Tapping the name goes back to the list — the alternative is clearing the search box
            to escape a food you picked by accident. */}
        <div className="row between" style={{ padding: '10px 2px', marginTop: 4 }}>
          <span className="small" style={{ fontWeight: 600, cursor: 'pointer' }} onClick={() => setPicked(null)}>{picked.n}</span>
          <span className="row" style={{ gap: 8, alignItems: 'center' }}>
            <NumberField value={grams} onChange={setGrams} decimal style={{ width: 90, textAlign: 'end' }} />
            <span className="dim small" style={{ width: 18 }}>g</span>
          </span>
        </div>
        <div className="dim small" style={{ margin: '0 2px 10px' }}>
          {MACROS.map(k => fmtNum(Math.round(picked[k] * grams) / 100) + ' ' + MACRO_UNIT(k)).join(' · ')}
        </div>
        {/* Disabled rather than toasted: the only thing that can be wrong here is the grams box
            right above it, and a button that visibly cannot be pressed says that better than a
            message about a form that isn't on screen. */}
        <Button variant="primary" disabled={!isValidGrams(grams)} onClick={addKnown}>{t('Add')}</Button>
      </>}

      {!picked && unknown && !fresh && <Button variant="tinted" icon="plus" style={{ marginTop: 8 }}
        onClick={() => setFresh({ n: query.trim(), kcal: null, p: null, c: null, f: null })}>
        {t('Add a new food')}
      </Button>}

      {fresh && <>
        <div style={{ height: 10 }} />
        <TextField value={fresh.n} placeholder={t('Food name')} maxLength={60}
          onChange={e => setFresh(v => ({ ...v, n: e.target.value }))} />
        <div className="dim small" style={{ margin: '10px 2px 4px' }}>{t('Per 100 g')}</div>
        <div className="list" style={{ gap: 0 }}>
          {MACROS.map(k => <div key={k} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
            <span className="small" style={{ fontWeight: 600 }}>{t(MACRO_LABEL[k])}</span>
            <span className="row" style={{ gap: 8, alignItems: 'center' }}>
              <NumberField value={fresh[k]} nullable onChange={v => setFresh(x => ({ ...x, [k]: v }))}
                style={{ width: 90, textAlign: 'end' }} />
              <span className="dim small" style={{ width: 32 }}>{MACRO_UNIT(k)}</span>
            </span>
          </div>)}
          <div className="row between" style={{ padding: '7px 2px' }}>
            <span className="small" style={{ fontWeight: 600 }}>{t('Grams')}</span>
            <span className="row" style={{ gap: 8, alignItems: 'center' }}>
              <NumberField value={grams} onChange={setGrams} style={{ width: 90, textAlign: 'end' }} />
              <span className="dim small" style={{ width: 32 }}>g</span>
            </span>
          </div>
        </div>
        <div style={{ height: 12 }} />
        <Button variant="primary" onClick={addFresh}>{t('Add')}</Button>
      </>}
    </div>

    <div className="card">
      <h2>{t('Today')}</h2>
      {entries.length
        ? <div className="list" style={{ gap: 0 }}>
          {entries.map(m => <div key={m.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small" style={{ fontWeight: 600 }}>{m.n}</div>
              <div className="dim" style={{ fontSize: '.72rem' }}>
                {fmtNum(m.g)} g · {fmtNum(m.p)} / {fmtNum(m.c)} / {fmtNum(m.f)} g
              </div>
            </div>
            <span className="row" style={{ gap: 10, alignItems: 'center' }}>
              <b>{fmtNum(m.kcal)}</b>
              <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }}
                aria-label={t('Delete')} onClick={() => update(s => { s.meals = removeMeal(s.meals, m.id) })}>
                <Icon name="trash" />
              </button>
            </span>
          </div>)}
        </div>
        : <div className="empty small">{t('Nothing logged today.')}</div>}
    </div>
  </div>
}
