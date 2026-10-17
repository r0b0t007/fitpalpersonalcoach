import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { effectiveRoutines, effectiveRoutineIds, nextTrainingDay, streakWeeks, lastBW, setsDoneActive } from '../lib/history.js'
import { fmtNum, fmtDate, todayISO, isoOf, weekKey, weekStartOf, weekDayOffset, DAYS, DAYN } from '../lib/format.js'
import { t, tp, dateLocale } from '../lib/i18n.js'
import { BRAND } from '../lib/brand.js'
import { bwSheet, goalSheet, dayOverrideSheet, calendarSheet, startFlow, starterPlanSheet, bwDeltaColor, checkinSheet } from '../sheets.jsx'
import { checkinStreak, isCheckinDue, periodStart, currentCheckin } from '../lib/checkins.js'
import { targetOf, totalsFor } from '../lib/nutrition.js'
import { posesFor, POSES, PHOTOS_REACHABLE } from '../lib/photo.js'
import { fetchMyPhotos } from '../lib/api.js'
import { MacroRows } from '../components/MacroRows.jsx'
import { OfferCard } from './MyCoach.jsx'
import LineChart from '../components/LineChart.jsx'
import Icon from '../components/Icon.jsx'
import InstallCard from '../components/InstallCard.jsx'
import { Button } from '../components/ui.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'
import { glyphOf } from '../lib/glyphs.js'

/**
 * "You checked in, but the photos did not go with it."
 *
 * The gate is AFTER the check-in, not before it, and that is the whole point. Photos live in the
 * three slots inside the check-in sheet, so while one is still due the check-in card is already on
 * screen asking — a second card with a second button opening the same sheet tells nobody anything.
 * The state worth naming is the one nothing else covers: the check-in is filed, some or all of the
 * angles are missing, and no other screen mentions it. An earlier version of this gated on
 * isCheckinDue and so could only ever appear alongside the card it duplicated, while being hidden
 * in the one state it was written for.
 *
 * Two other gates, both load-bearing:
 * - A COACH. Progress photos exist to be sent to somebody. Without one this asked a solo user to
 *   file images nobody would look at, and for a guest fetchMyPhotos took a 401 on every Home mount
 *   before offering an Add button whose sheet only says "sign in".
 * - PHOTOS_REACHABLE: on the paired mobile build an <img> resolves against capacitor://localhost
 *   with no Authorization header, so the thumbnails could never render (lib/photo.js).
 */
function PhotosDue({ S, today, coached }) {
  const due = coached && !!currentCheckin(S, today) && PHOTOS_REACHABLE
  const [rows, setRows] = useState(null)
  // Re-read whenever every sheet has closed. The check-in sheet is opened FROM this card and the
  // photos go up as part of it, but only SAVING the check-in changes anything this component
  // watches — somebody who uploads all three angles and dismisses without saving would otherwise
  // be told "none sent this week" with three of them already on the server.
  const sheetsOpen = useUI(s => s.sheets.length)
  useEffect(() => {
    if (!due || sheetsOpen) return
    let alive = true
    fetchMyPhotos()
      .then(r => { if (alive) setRows(r) })
      // Left null, not []. Offline, a 401 or a 5xx would otherwise render exactly the same card as
      // a genuinely empty week, so a client who had already sent all three got nagged to send them
      // again every time the request failed. No answer means no card — the same call loadAssignments
      // makes about offers.
      .catch(() => {})
    return () => { alive = false }
  }, [due, sheetsOpen])

  if (!due || rows === null) return null
  const have = posesFor(rows, periodStart(S, today))
  const missing = POSES.filter(p => !have[p.id])
  if (!missing.length) return null

  return <div className="card" style={{ marginBottom: 12 }}>
    <div className="row between">
      <div style={{ minWidth: 0 }}>
        <div className="tt">{t('Progress photos')}</div>
        <div className="ss">{missing.length === POSES.length
          ? t('You checked in without photos this week.')
          : t('{0} of {1} sent this week.', POSES.length - missing.length, POSES.length)}</div>
      </div>
      <Button size="sm" icon="camera" onClick={() => checkinSheet()}>{t('Add')}</Button>
    </div>
  </div>
}

/**
 * What the coach asked them to eat, against what they have eaten so far today.
 *
 * Only when a target exists, which means only when a coach set one — this is not a nutrition app
 * and a tracker that opens on food is one people stop opening. It is a statement of where the day
 * stands, not an invitation to log lunch; tapping goes to the screen that is for that.
 */
function TodayTargets({ S, nav, today }) {
  const target = targetOf(S)
  if (!target) return null
  return <div className="card tappable" style={{ marginBottom: 12, cursor: 'pointer' }} {...tappable(() => nav('/nutrition'))}>
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{t('Today’s targets')}</h2>
      <Icon name="chevronRight" className="chev" />
    </div>
    <MacroRows totals={totalsFor(S, today)} target={target} />
  </div>
}

// Home = what to do now + a quick glance. Deep charts & history live in Stats.
export default function Home() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const assignments = useStore(s => s.assignments)
  const [weekOffset, setWeekOffset] = useState(0)

  // Programs a coach sent. Cards rather than an auto-opening sheet: arriving to a modal you did
  // not ask for is a bad way to be told, and the push notification already got their attention.
  // ALL of them — a coach can send a block and a deload, and this used to read assignments[0] and
  // silently swallow the rest. The same card as the Coach tab, from one definition.
  const offers = assignments || []
  const today = new Date()
  // A weekday can hold several routines. `todayRoutines` is the whole day; `routine` is the
  // first, kept for the one-routine glyph. The derived session name joins them (§9).
  const todayRoutines = effectiveRoutines(S, todayISO())
  const routine = todayRoutines[0] || null
  const todayName = todayRoutines.map(r => r.name).join(' + ')
  const todayOvr = S.dayPlan[todayISO()] !== undefined
  // On a rest day, saying when you train next beats leaving the row as a full stop.
  const next = !S.active && !todayRoutines.length ? nextTrainingDay(S, todayISO()) : null
  /**
   * What to say to somebody with nothing to train — one value, not two conditions.
   *
   * Three states that must be mutually exclusive, and writing them as two independent booleans is
   * how this went wrong twice: first the welcome ignored offers, then it ignored offers from a
   * coach who is not bound yet (an admin can assign one by hand, without the invite flow, so
   * coachName is null while a real program sits unanswered). Both times Home showed the offer AND
   * told them to load a starter plan. Deriving it once makes that shape unrepresentable.
   *
   * An offer outranks both: it IS the message, and answering it is the thing to do.
   */
  const emptyState = S.routines.length || S.active ? null
    : offers.length ? null
      : user?.coachName ? 'waiting'
        : 'welcome'
  const bw = lastBW(S)
  const prevBW = S.bodyweight.length > 1 ? S.bodyweight[S.bodyweight.length - 2] : null
  const delta = bw && prevBW ? bw.w - prevBW.w : null

  const ws = weekStartOf(S)
  // The first day of the shown week. Named for the role, not for Monday — which day that is
  // is the setting.
  const wkStart = new Date(today)
  wkStart.setDate(today.getDate() - weekDayOffset(today.getDay(), ws) + weekOffset * 7)
  const doneDays = new Set(S.workouts.map(w => w.d))
  // The last session logged for today, if any — what the row below reports instead of asking
  // you to start the one you already did. Last wins, so a second session names itself.
  const doneToday = S.workouts.filter(w => w.d === todayISO()).at(-1) || null
  const strip = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(wkStart); d.setDate(wkStart.getDate() + i)
    const iso = isoOf(d)
    const eff = effectiveRoutineIds(S, iso).length > 0, ovr = S.dayPlan[iso] !== undefined, done = doneDays.has(iso)
    const dot = done ? ' done' : ovr && eff ? ' ovr' : eff ? ' plan' : ''
    strip.push(<div key={i} className={'wday' + (iso === todayISO() ? ' today' : '')} {...tappable(() => dayOverrideSheet(iso))}>
      <div className="lbl">{t(DAYS[d.getDay()])}</div><div className="num">{d.getDate()}</div><div className={'dot' + dot} /></div>)
  }
  const wkEnd = new Date(wkStart); wkEnd.setDate(wkStart.getDate() + 6)
  const wkLabel = weekOffset === 0 ? t('This week') : `${wkStart.getDate()} ${wkStart.toLocaleDateString(dateLocale(), { month: 'short' })} – ${wkEnd.getDate()} ${wkEnd.toLocaleDateString(dateLocale(), { month: 'short' })}`

  const wThisWeek = S.workouts.filter(w => weekKey(w.d, ws) === weekKey(todayISO(), ws)).length
  // Days scheduled, not routines — a combined day counts as 1, matching wThisWeek (one w).
  const plannedPerWeek = Object.values(S.week).filter(ids => ids?.length).length
  const bwPoints = S.bodyweight.slice(-30).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))

  // today's session shown right under the week strip
  const onToday = () => { if (S.active) nav('/workout'); else if (todayRoutines.length) startFlow(effectiveRoutineIds(S, todayISO())); else dayOverrideSheet(todayISO()) }

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{user ? t('Hi {0}', user.name) : BRAND}</h1><div className="sub">{today.toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    {offers.map(o => <OfferCard key={o.id} offer={o} />)}

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w - 1)} aria-label={t('Previous week')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500 }}>{wkLabel}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => setWeekOffset(w => w + 1)} aria-label={t('Next week')}><Icon name="chevronRight" /></button>
      </div>
      <div className="week">{strip}</div>
      {/* Once today's session is logged the row stops asking for it. The week strip already
          knew (its dot goes 'done'); this row did not, so a finished day kept showing the
          routine name behind a green Start tag and read as still outstanding (issue #4).
          An in-progress session still wins — that one is happening right now. Tapping the
          row keeps working, so a second session in one day is a tap away, just not urged. */}
      <div className="today-row" {...tappable(onToday)}>
        <div className="row" style={{ gap: 9, minWidth: 0 }}>
          <span className="lrow-i" style={{ background: S.active ? 'var(--orange)' : doneToday ? 'var(--surface-3)' : routine ? 'var(--acc)' : 'var(--surface-3)' }}>
            <Icon name={S.active ? 'timer' : doneToday ? 'checkCircle' : routine ? glyphOf(routine.emoji) : 'moon'}
              style={doneToday && !S.active ? { color: 'var(--green)' } : undefined} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="lbl2">{t('Today')}</div>
            <div className="ttl">{S.active ? t('{0} — in progress', S.active.name)
              : doneToday ? (doneToday.name ? t('{0} — done', doneToday.name) : t('Workout done'))
              : routine ? todayName : t('Rest day')}{todayOvr && routine && !doneToday ? ' · ' + t('rescheduled') : ''}</div>
            {next && !doneToday && <div className="ss">{t('Next session: {0}, {1}', t(DAYN[next.weekday]), next.routine.name)}</div>}
          </div>
        </div>
        {S.active ? <span className="tag" style={{ color: 'var(--orange)', background: 'color-mix(in srgb,var(--orange) 16%,transparent)' }}>{t('Resume')}</span>
          : doneToday ? <span className="tag" style={{ color: 'var(--green)', background: 'color-mix(in srgb,var(--green) 16%,transparent)' }}>{t('Done')}</span>
          : routine ? <span className="tag acc">{t('Start')}</span>
          : <Icon name="plus" className="chev" />}
      </div>
    </div>

    {/* Only when one is owed, and it disappears the moment it is filed. A permanent "check in"
        button is ignored within a fortnight; a card that appears because something is actually
        due is the thing that keeps the habit. */}
    {isCheckinDue(S, todayISO()) && <div className="card" style={{ marginBottom: 12 }}>
      <div className="row between">
        <div>
          <div className="tt">{t('Weekly check-in')}</div>
          <div className="ss">{checkinStreak(S, todayISO()) > 0
            ? tp(checkinStreak(S, todayISO()), '{0} week running — keep it going.', '{0} weeks running — keep it going.')
            : t('Five quick scales and anything your coach should know.')}</div>
        </div>
        <Button size="sm" icon="plus" onClick={() => checkinSheet()}>{t('Check in')}</Button>
      </div>
    </div>}
    <PhotosDue S={S} today={todayISO()} coached={!!user?.coachName} />
    <TodayTargets S={S} nav={nav} today={todayISO()} />
    <InstallCard />

    {emptyState === 'waiting' && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="clock" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('{0} is preparing your program', user.coachName)}</div>
        </div>
        <div className="muted small">{t('It will show up here as soon as they send it. Nothing for you to do.')}</div>
      </div>
    )}

    {emptyState === 'welcome' && (
      <div className="card">
        <div className="row" style={{ gap: 10, marginBottom: 6 }}>
          <span className="lrow-i"><Icon name="sparkles" /></span>
          <div className="big" style={{ fontSize: 22 }}>{t('Welcome!')}</div>
        </div>
        <div className="muted small" style={{ marginBottom: 12 }}>{t('Set up your weekly routine to get going — or load a ready-made starter plan.')}</div>
        <Button variant="primary" icon="sparkles" onClick={starterPlanSheet}>{t('Load starter plan')}</Button>
        <div style={{ height: 8 }} /><Button onClick={() => nav('/plan')}>{t('Build my own plan')}</Button>
      </div>
    )}

    <div className="card">
      <div className="row between" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{t('Body weight')}</h2>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button>
          <Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button>
        </div>
      </div>
      {bw ? <>
        <div className="row" style={{ gap: 8, alignItems: 'baseline' }}>
          <div className="big">{fmtNum(bw.w)} <span className="muted" style={{ fontSize: '1rem' }}>{S.unit}</span></div>
          {/* only when it actually moved — an unchanged weight used to read as "− 0" */}
          {!!delta && (
            <span className="small row" style={{ gap: 2, fontWeight: 500, color: bwDeltaColor(delta, bw.w) }}>
              <Icon name={delta > 0 ? 'arrowUp' : 'arrowDown'} style={{ fontSize: 12 }} />
              {fmtNum(Math.abs(delta))}
            </span>
          )}
          <span className="dim small" style={{ marginLeft: 'auto' }}>{fmtDate(bw.d, true)}</span>
        </div>
        {S.targetW && (
          <div className="small row" style={{ color: 'var(--yellow)', marginTop: 4, gap: 5 }}>
            <Icon name="target" style={{ fontSize: 13 }} />
            <span>{t('Goal')} {fmtNum(S.targetW)} {S.unit} · {Math.abs(S.targetW - bw.w) < 0.05 ? t('reached!') : t(S.targetW > bw.w ? '{0} to gain' : '{0} to lose', fmtNum(Math.abs(S.targetW - bw.w)) + ' ' + S.unit)}</span>
          </div>
        )}
        <div className="chart" style={{ marginTop: 8 }}><LineChart points={bwPoints} h={130} unit={S.unit} goal={S.targetW} /></div>
      </> : <div className="muted small">{t("No entries yet — log your weight to start the curve. It's also asked before every workout.")}</div>}
    </div>

    {/* Stats no longer has a cell in the tab bar, and this card is already a stats summary —
        streak, this week, lifetime total — so it becomes the way through to the full screen.
        The calendar it used to open keeps its own target rather than being lost. */}
    <div className="card tappable" style={{ cursor: 'pointer' }} {...tappable(() => nav('/stats'))}>
      <div className="row between">
        <div>
          <div className="row" style={{ gap: 7, fontSize: 22, fontWeight: 600, letterSpacing: '-.021em' }}>
            <Icon name="flame" style={{ color: 'var(--orange)' }} />
            {tp(streakWeeks(S), '{0} week streak', '{0} weeks in a row')}
          </div>
          <div className="muted small" style={{ marginTop: 2 }}>{wThisWeek}{plannedPerWeek ? ' / ' + plannedPerWeek : ''} {t('this week')} · {tp(S.workouts.length, '{0} workout total', '{0} workouts total')}</div>
        </div>
        <button className="iconbtn" style={{ width: 34, height: 34, fontSize: 17 }}
          onClick={e => { e.stopPropagation(); calendarSheet() }} aria-label={t('Calendar')} title={t('Calendar')}>
          <Icon name="calendar" />
        </button>
      </div>
    </div>
  </div>
}
