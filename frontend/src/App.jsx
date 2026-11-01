import { useEffect, useLayoutEffect, useRef } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { pendingInvite } from './lib/invite.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang, getLang, DEFAULT_LANG } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { fetchExerciseMedia } from './lib/api.js'
import { setCoachMedia } from './lib/coach-media.js'
import { initBackButton } from './lib/back.js'
import { useWakeLock } from './lib/wakelock.js'
import { shellFor, useShellPref } from './lib/role.js'
import { installViewportGuard } from './lib/viewport-guard.js'
import { startFlow } from './sheets.jsx'
import Logo from './components/Logo.jsx'
import TabBar from './components/TabBar.jsx'
import CoachTabBar from './components/CoachTabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import TimerFlash from './components/TimerFlash.jsx'
import Login from './views/Login.jsx'
import Start, { startOpen } from './views/Start.jsx'
import Link, { linkOpen } from './views/Link.jsx'
import PublicCoach from './views/PublicCoach.jsx'
import Join from './views/Join.jsx'
import { coachHandleFromPath } from './lib/coach-page.js'
import { joinHandleFromPath } from './lib/join.js'
import MobileOnboarding from './views/MobileOnboarding.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import Nutrition from './views/Nutrition.jsx'
import History from './views/History.jsx'
import Library from './views/Library.jsx'
import Muscles from './views/Muscles.jsx'
import Settings from './views/Settings.jsx'
import You from './views/You.jsx'
import MyCoach from './views/MyCoach.jsx'
import CoachToday from './views/coach/CoachToday.jsx'
import Clients from './views/coach/Clients.jsx'
import ClientDetail from './views/coach/ClientDetail.jsx'
import Programs from './views/coach/Programs.jsx'
import ProgramEditShell, { ProgramEdit, ProgramRoutineEdit } from './views/coach/ProgramEdit.jsx'
import CoachAccount from './views/coach/CoachAccount.jsx'
import PublicPage from './views/coach/PublicPage.jsx'
import Requests from './views/coach/Requests.jsx'
import TermsGate, { TermsWaiting, useCoachTerms } from './views/coach/TermsGate.jsx'
import { BusinessAccounts, BusinessActivity } from './views/coach/Business.jsx'

// last known scrollY per route, so back-navigation can put the page where it was
const scrollPositions = new Map()

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// theme === 'system' follows the OS/browser preference instead of a fixed choice.
const resolveTheme = theme => theme === 'light' || theme === 'dark'
  ? theme
  : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  de.dataset.accent = ACCENTS[accent] ? accent : 'gold'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

// The two shells. Which one a signed-in person gets is decided once, here, from the role the
// server reports (lib/role.js) — nothing below this branches on it again. A coach is the tenant:
// their clients, their programs, their account, and none of a trainee's own plan. A client, or a
// coach who chose "Train myself", gets the training app. Each table falls through to its own
// home, which is also what happens after sign-in: Login never navigates, so a coach still
// sitting on #/home lands on /today because this table has no /home.
function ClientRoutes() {
  return (
    <Routes>
      <Route path="/home" element={<Home />} />
      <Route path="/plan" element={<Plan />} />
      <Route path="/plan/r/:id" element={<RoutineEdit />} />
      <Route path="/workout" element={<Workout />} />
      <Route path="/stats" element={<Stats />} />
      <Route path="/nutrition" element={<Nutrition />} />
      <Route path="/history" element={<History />} />
      <Route path="/library" element={<Library />} />
      <Route path="/muscles" element={<Muscles />} />
      {/* /mycoach, not /coach — upstream's AI chat took that path during the 401-commit merge,
          and it is the client table so both have to coexist. */}
      <Route path="/mycoach" element={<MyCoach />} />
      <Route path="/you" element={<You />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="*" element={<Navigate to="/home" replace />} />
    </Routes>
  )
}

// /account is the coach's own screen; the shared Settings screen it used to be now sits at
// /settings, reachable from a row on it. /trainer was the old dashboard's address (it could not
// be /coach — upstream's AI chat owns that path in the client table).
function CoachRoutes({ user }) {
  return (
    <Routes>
      <Route path="/today" element={<CoachToday />} />
      <Route path="/clients" element={<Clients />} />
      <Route path="/clients/:id" element={<ClientDetail />} />
      <Route path="/programs" element={<Programs />} />
      {/* One shell, two screens: the library row's editor and the shared routine editor inside it.
          Nested so both work off a single draft — see ProgramEdit.jsx for why that matters. */}
      <Route path="/programs/:pid" element={<ProgramEditShell />}>
        <Route index element={<ProgramEdit />} />
        <Route path="r/:rid" element={<ProgramRoutineEdit />} />
      </Route>
      <Route path="/account" element={<CoachAccount />} />
      <Route path="/account/page" element={<PublicPage />} />
      <Route path="/requests" element={<Requests />} />
      {/* The two operator jobs a single coach keeps, out of the gym dashboard. Both are gated on
          user.admin inside, so a URL typed by a plain coach lands back on /account rather than on
          a screen whose every request 403s. */}
      <Route path="/account/accounts" element={<BusinessAccounts />} />
      <Route path="/account/activity" element={<BusinessActivity />} />
      {/* The coach's own training settings — units, language, notifications, rest timers, export —
          are the same screen a client gets, because they are the same settings. Reached from the
          "Training settings" row on Account, and named here so a link or a back button that
          predates the split does not fall through to the catch-all. */}
      <Route path="/settings" element={<Settings />} />
      {/* Shared screens still say nav('/you') and nav('/home') — Settings after sign-out or a
          reset. Named here so they land on the coach's equivalents instead of the catch-all;
          the catch-all is for paths nobody meant. */}
      <Route path="/you" element={<Navigate to="/account" replace />} />
      <Route path="/home" element={<Navigate to="/today" replace />} />
      <Route path="/trainer" element={<Navigate to="/today" replace />} />
      <Route path="*" element={<Navigate to="/today" replace />} />
    </Routes>
  )
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const navType = useNavigationType()
  const { S, user, ready, config } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const needsMobileOnboarding = useStore(s => s.needsMobileOnboarding)
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  const shellPref = useShellPref()
  const shell = shellFor(user, shellPref)
  useEffect(() => { setNav(navigate) }, [navigate])
  // Somebody already signed in who taps their coach's invite link.
  //
  // The link carries ?invite= and the app is hash-routed, so it opens on whatever screen they
  // were last on — and every other reader of pendingInvite() is on the signed-OUT path (the
  // sign-in screen, the register sheet). So a client of six months following a link landed on
  // Home with nothing changed: no prompt, no dot, and the code they were sent visible only if
  // they happened to think of opening the Coach tab. Once, to the one screen that can act on it;
  // a client who already has a coach is left alone, because redeeming would be refused anyway.
  const sentInvite = useRef(false)
  useEffect(() => {
    // Not from the email-link page, which moves on by itself and must not be cut short.
    if (sentInvite.current || !ready || !user || user.coachName || !pendingInvite() || loc.pathname === '/link') return
    sentInvite.current = true
    navigate('/mycoach')
  }, [ready, user, navigate])
  // A screen that wears someone else's theme (a coach's public page) says so in useUI, and this one
  // place applies it — the status-bar colour with it — so a sync landing meanwhile cannot flip it
  // back, and leaving gives the person's own theme as it now is.
  const theme = useUI(s => s.themeOverride) || S.theme
  useEffect(() => { applyPrefs(theme, S.accent) }, [theme, S.accent])
  // 'system' needs to react live if the OS theme flips while the app is open, not just on
  // the next mount — a fixed 'dark'/'light' choice never re-fires this since matchMedia
  // isn't consulted for those.
  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(theme, S.accent)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme, S.accent])
  useEffect(() => { setLang(S.lang || DEFAULT_LANG) }, [S.lang])
  // The coach's exercise demos. Server state, so it lives in a plain module registry rather than
  // in `S` (lib/coach-media.js argues that at length) and this is its single load — one request
  // per sign-in, after which every card resolves its demo synchronously. Signed-in only: the
  // route needs a session, and a guest has no coach. A failure is deliberate silence — no demo
  // just means the dataset animation, which is what every build did until now.
  useEffect(() => {
    if (!user) { setCoachMedia([]); return }
    let live = true
    fetchExerciseMedia().then(rows => { if (live) setCoachMedia(rows) }).catch(() => {})
    return () => { live = false }
  }, [user?.id])
  // getLang, not S.lang: a stored language the app no longer ships ('it') loads English, and the
  // sentence-case CSS and capFirst must agree on which one is showing.
  useEffect(() => { document.documentElement.lang = getLang() }, [langV, S.lang])
  // Forward navigation starts at the top; going back lands where you left off.
  // The position is recorded from scroll events rather than read at route
  // change, because by then a shorter page may already have clamped it.
  const pathRef = useRef(loc.pathname)
  // iOS leaves the page displaced after the keyboard goes away (see lib/viewport-guard.js).
  useEffect(() => installViewportGuard(), [])
  useEffect(() => {
    const onScroll = () => {
      // Modals pins the body while a sheet is open; scrollY is 0 then, not a position.
      if (document.body.style.position === 'fixed') return
      scrollPositions.set(pathRef.current, window.scrollY)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useLayoutEffect(() => {
    pathRef.current = loc.pathname
    if (navType !== 'POP') { window.scrollTo(0, 0); return }
    const y = scrollPositions.get(loc.pathname) || 0
    // the restored view needs a layout pass before it is tall enough to scroll to y
    const frame = window.requestAnimationFrame(() => window.scrollTo(0, y))
    return () => window.cancelAnimationFrame(frame)
  }, [loc.pathname, navType])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  const authed = user || isGuest
  // Signed out, every path is the sign-in screen — except a coach's sign-up from the site's pricing
  // links, on an instance that sells plans (views/Start.jsx). On one that does not (the Node API,
  // which has no `billing` in its config) /start stays the sign-in screen it always was.
  const signedOut = loc.pathname === '/start' && startOpen(config) ? <Start /> : <Login />
  // An emailed sign-in link (views/Link.jsx) lands here signed in or not — an address change is
  // confirmed from a signed-in device too — so it comes before either shell, with no tab bar.
  const onLink = loc.pathname === '/link' && linkOpen(config)
  // A coach's public page (CHW-330), and asking to join from it (CHW-336), are anyone's, signed in
  // or not — before either shell, like /link, with no tab bar.
  const coachPage = coachHandleFromPath(loc.pathname)
  const joinPage = joinHandleFromPath(loc.pathname)
  // The coach terms (CHW-357), asked here — App stays mounted across routes, the screens below are
  // keyed on them — so a tab change neither asks again nor shows the roster before the answer.
  const coachShell = !!user && shell === 'coach' && !coachPage && !joinPage && !onLink
  const [terms, setTerms] = useCoachTerms(coachShell, user?.id)
  // Not before boot has finished: a signed-in coach is drawn from the cached user while the config
  // is on its way (the coach routes' catch-all would bounce /link to /today with the token in it),
  // and boot's own /api/me and sync must not race a redemption that switches the session cookie.
  // A config that failed to load counts as "maybe" (linkOpen): the link is tried, not dropped.
  const linkPending = loc.pathname === '/link' && !ready
  if ((!ready && !authed) || linkPending) return (
    <div id="app">
      <div style={{ paddingTop: '42vh', display: 'flex', justifyContent: 'center' }}>
        <Logo size={30} />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {coachPage ? <PublicCoach handle={coachPage} /> : joinPage ? <Join handle={joinPage} /> : onLink ? <Link /> : !authed ? signedOut : needsMobileOnboarding ? <MobileOnboarding /> : shell === 'coach' ? (!terms ? <TermsWaiting /> : terms.accepted ? <CoachRoutes user={user} /> : <TermsGate terms={terms} onChange={setTerms} />) : <ClientRoutes />}
        </ErrorBoundary>
      </div>
      {/* The chat owns the bottom of the screen: its composer sits where the tabs would be. */}
      {!onLink && !coachPage && !joinPage && (shell === 'coach' ? (terms?.accepted || !coachShell) && <CoachTabBar /> : <TabBar onStart={startFlow} />)}
      <RestTimer />
      <Modals />
      <Toast />
      <TimerFlash />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  // Android system back — sheet, then page, then press-again-to-exit (see lib/back.js)
  useEffect(() => {
    let stop = null, gone = false
    initBackButton().then(fn => { if (gone) fn(); else stop = fn })
    return () => { gone = true; stop?.() }
  }, [])
  return <HashRouter><Shell /></HashRouter>
}
