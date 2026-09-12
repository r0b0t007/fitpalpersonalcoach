import { useEffect, useLayoutEffect, useRef } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType } from 'react-router-dom'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang, DEFAULT_LANG } from './lib/i18n.js'
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
import Admin from './views/Admin.jsx'
import CoachToday from './views/coach/CoachToday.jsx'
import Clients from './views/coach/Clients.jsx'
import ClientDetail from './views/coach/ClientDetail.jsx'
import Programs from './views/coach/Programs.jsx'
import ProgramEditShell, { ProgramEdit, ProgramRoutineEdit } from './views/coach/ProgramEdit.jsx'
import CoachAccount from './views/coach/CoachAccount.jsx'
import { BusinessAccounts, BusinessActivity } from './views/coach/Business.jsx'
import CoachChat from './views/CoachChat.jsx'
import CoachIntake from './views/CoachIntake.jsx'
import CoachSetup from './views/CoachSetup.jsx'

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
      {/* The AI Coach screens gate themselves on the instance config; the routes exist
          unconditionally so a deep link from a notification lands somewhere sane
          rather than on the catch-all. */}
      <Route path="/coach" element={<CoachChat />} />
      <Route path="/coach/intake" element={<CoachIntake />} />
      <Route path="/coach/proposal" element={<Navigate to="/coach" replace />} />
      <Route path="/coach/setup" element={<CoachSetup />} />
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
      {/* The operator page stays reachable for the admin account for one release, hidden, while
          the pieces a single coach still needs (activity log, disabling an account) move into
          Account. Everything else on it — classes, timetable, access requests — is gym-only. */}
      <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/today" replace />} />
      {/* Settings (now at /settings) links here on the phone build to choose how the AI coach
          runs — a device setting, not a coaching feature, so the screen stays reachable. */}
      <Route path="/coach/setup" element={<CoachSetup />} />
      {/* Shared screens still say nav('/you') and nav('/home') — Settings after sign-out or reset,
          Admin's back button. Named here so they land on the coach's equivalents instead of
          the catch-all; the catch-all is for paths nobody meant. */}
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
  const { S, user, ready } = useStore()
  const isGuest = useStore(s => s.isGuest())
  const needsMobileOnboarding = useStore(s => s.needsMobileOnboarding)
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  const shellPref = useShellPref()
  const shell = shellFor(user, shellPref)
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])
  // 'system' needs to react live if the OS theme flips while the app is open, not just on
  // the next mount — a fixed 'dark'/'light' choice never re-fires this since matchMedia
  // isn't consulted for those.
  useEffect(() => {
    if (S.theme !== 'system' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(S.theme, S.accent)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [S.theme, S.accent])
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
  useEffect(() => { document.documentElement.lang = S.lang || DEFAULT_LANG }, [langV, S.lang])
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
  if (!ready && !authed) return (
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
          {!authed ? <Login /> : needsMobileOnboarding ? <MobileOnboarding /> : shell === 'coach' ? <CoachRoutes user={user} /> : <ClientRoutes />}
        </ErrorBoundary>
      </div>
      {/* The chat owns the bottom of the screen: its composer sits where the tabs would be. */}
      {loc.pathname !== '/coach' && (shell === 'coach' ? <CoachTabBar /> : <TabBar onStart={startFlow} />)}
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
