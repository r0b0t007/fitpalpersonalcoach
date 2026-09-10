// The design-system surface of FitPal Coach: every presentational primitive a screen is built
// from, and nothing that reads the store or the router. This is the entry design-sync bundles
// for claude.ai/design (see .design-sync/), so the design agent there composes real components.
// Nothing in the app imports this file; the app keeps importing the modules directly.
export {
  NumberField, TextField, TextArea, SearchField, Switch, Segmented, Stepper, Slider, Check,
  Section, Row, SelectRow, MultiSelectRow, Button,
} from './components/ui.jsx'
export { default as Icon, ICON_NAMES } from './components/Icon.jsx'
export { default as Logo } from './components/Logo.jsx'
export { default as LineChart } from './components/LineChart.jsx'
export { default as Heatmap } from './components/Heatmap.jsx'
export { MacroRows, TargetRows } from './components/MacroRows.jsx'
export { default as BodyMap, BodyMapLegend } from './components/BodyMap.jsx'
export { default as SwipeToDelete } from './components/SwipeToDelete.jsx'
export { default as QrCanvas } from './components/QrCanvas.jsx'
