#!/usr/bin/env node
// Rewrites French text from the informal "tu" to the formal "vous" (CHW-202). The app speaks to
// people as "vous"; the upstream instruction dataset, and part of the UI pack, said "tu".
//
//   node scripts/french-vous.mjs            rewrite frontend/src/instr/fr.js in place
//   node scripts/french-vous.mjs --check    exit 1 if any "tu" form is left
//
// Rule-based, not free-form, so every change is one a reader can predict:
//   - an imperative is converted where a verb stands — the start of a sentence, or after "puis",
//     "et", "ou", "ensuite" or a comma — because several of these forms are also nouns ("place",
//     "pose", "sens", "plante", "règle"). With a hyphenated pronoun ("Lève-le", "Penche-toi") it
//     cannot be a noun and is converted wherever it stands;
//   - "tu" + verb uses a table of the forms that actually occur, each in its own mood
//     ("que tu sentes" → "que vous sentiez");
//   - ton/ta → votre, tes → vos, te/t'/toi → vous.
// Word boundaries are Unicode-aware: JavaScript's \b treats "ô" as a non-letter, so /\btes\b/
// matches inside "côtes" and /\bte\b/ inside "tête".
//
// It is kept, not thrown away, because build-instructions.mjs regenerates instr packs from the
// upstream dataset — which is "tu". That script no longer writes fr.js; if French is ever rebuilt
// from upstream, run this over it.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const L = String.raw`\p{L}`
const B = `(?<![${L}'’-])`     // start of a word (not after a letter, apostrophe or hyphen)
const E = `(?![${L}])`         // end of a word

// tu-imperative → vous-imperative, for the forms the general rules below get wrong.
const IRREGULAR = {
  tiens: 'tenez', maintiens: 'maintenez', retiens: 'retenez', reviens: 'revenez', deviens: 'devenez',
  fais: 'faites', refais: 'refaites', assieds: 'asseyez', rassieds: 'rasseyez', mets: 'mettez', remets: 'remettez',
  prends: 'prenez', reprends: 'reprenez', comprends: 'comprenez', étends: 'étendez', tends: 'tendez',
  détends: 'détendez', descends: 'descendez', redescends: 'redescendez', suspends: 'suspendez',
  rends: 'rendez', sors: 'sortez', pars: 'partez', cours: 'courez', bats: 'battez', abats: 'abattez',
  suis: 'suivez', sens: 'sentez', ressens: 'ressentez', joins: 'joignez', rejoins: 'rejoignez',
  va: 'allez', sois: 'soyez', vois: 'voyez', dis: 'dites', lis: 'lisez', bois: 'buvez', ouvre: 'ouvrez',
  écris: 'écrivez', accroupis: 'accroupissez', inscris: 'inscrivez',
}
// -ir verbs of the second group: fléchis → fléchissez.
const SECOND = new Set(['fléchis', 'saisis', 'ralentis', 'atterris', 'choisis', 'rebondis', 'accomplis', 'finis',
  'réussis', 'raidis', 'arrondis', 'agis', 'durcis', 'élargis', 'grandis', 'unis', 'réunis'])
// è in the stem that becomes é, not e (répéter, régler); every other è becomes e (lever, mener).
const E_ACUTE = new Set(['répète', 'règle', 'complète', 'accélère', 'protège', 'considère', 'intègre', 'libère',
  'exagère', 'tolère', 'allège', 'abrège', 'sèche', 'pénètre', 'récupère', 'transfère'])

function vousImperative(tu) {
  const w = tu.toLowerCase()
  if (IRREGULAR[w]) return IRREGULAR[w]
  if (SECOND.has(w)) return w.slice(0, -1) + 'ssez'
  if (!w.endsWith('e')) return null
  if (/uie$/.test(w)) return w.replace(/uie$/, 'uyez')
  if (/aie$/.test(w)) return w.replace(/aie$/, 'ayez')
  if (/oie$/.test(w)) return w.replace(/oie$/, 'oyez')
  if (/ette$/.test(w)) return w.replace(/ette$/, 'etez')
  if (/elle$/.test(w)) return w.replace(/elle$/, 'elez')
  const i = w.lastIndexOf('è')
  const stem = i < 0 ? w : w.slice(0, i) + (E_ACUTE.has(w) ? 'é' : 'e') + w.slice(i + 1)
  return stem + 'z'
}

// The tu-imperatives this text uses. A word only converts if it is here: "les", "une", "juste"
// and "parallèle" stand where verbs stand too.
export const VERBS = new Set(`
  abaisse abats accompagne accroupis agenouille agrippe aide ajuste alterne amène amorce appuie arrête
  assieds assure atterris attache attrape augmente avance balance bascule bats cale change claque
  commence concentre continue contracte cours croise décolle demande déplace descends détends
  développe diminue écarte effectue élève éloigne enchaîne enlace enroule engage entrelace essaie
  étends étire évite exerce expire explose fais fixe fléchis gaine garde glisse hausse hisse incline
  inspire installe inverse joins lance laisse lève maintiens marche marque mets monte ouvre passe
  penche pense pivote place plante plie pose positionne pousse presse projette propulse rabaisse
  ralentis ramène rapproche rattrape réceptionne recommence recule récupère redescends redresse
  règle relâche relève remets remonte renvoie répète repose repousse resserre respire rétracte
  reviens roule saisis saute sélectionne sens serre sollicite sors soulève stabilise suis suspends
  tape tends termine tiens tire touche reporte prends veille tourne transfère trouve utilise verrouille allonge
`.trim().split(/\s+/))

// tu + a conjugated form, as it occurs. Each keeps its mood: indicative stays indicative,
// subjunctive and imperfect stay what they were.
const TU_FORMS = {
  abaisses: 'abaissez', attrapes: 'attrapez', avances: 'avancez', commences: 'commencez', courais: 'couriez',
  descends: 'descendez', dégages: 'dégagez', devrais: 'devriez', effectues: 'effectuez', enroules: 'enroulez',
  essayais: 'essayiez', expires: 'expirez', faisais: 'faisiez', lançais: 'lanciez', montes: 'montez',
  nageais: 'nagiez', pédalais: 'pédaliez', peux: 'pouvez', pousses: 'poussez', puisses: 'puissiez',
  ramènes: 'ramenez', réalises: 'réalisez', ressens: 'ressentez', ressentes: 'ressentiez', sens: 'sentez',
  sentes: 'sentiez', sois: 'soyez', souhaites: 'souhaitez', soulèves: 'soulevez', tires: 'tirez',
  étends: 'étendez', as: 'avez', es: 'êtes', vas: 'allez', fais: 'faites', dois: 'devez', veux: 'voulez',
  asseyais: 'asseyiez', penches: 'penchez',
}

const cap = (src, out) => (src[0] === src[0].toUpperCase() && src[0] !== src[0].toLowerCase()
  ? out[0].toUpperCase() + out.slice(1) : out)

const PRON = '(?:toi|le|la|les|lui|leur|en|y|moi|nous)'
// Where a verb stands: the start of a sentence, or after a comma, a dash, "(", "puis", "et", "ou"
// or "ensuite"; after "fois" ("cette fois faites"); and after "ne" when no third-person subject
// precedes it — "ne verrouillez pas", but "avant qu’il ne touche le sol" stays.
const AT = `(?<=^|[.;:!?]\\s+|\\(\\s*|[,—–]\\s+|${B}(?:puis|et|ou|ensuite|fois|Puis|Et|Ensuite),?\\s+|(?<!(?:il|elle|ils|elles|on|qui)\\s)${B}ne\\s+)`
const WORD = `[${L}]+`

export function toVous(s) {
  let out = s
  // "tu te penches", "tu t'asseyais", "tu t'es déplacé": the reflexive pronoun follows the subject.
  out = out.replace(new RegExp(`${B}([Tt])u (?:te |t['’])(${WORD})${E}`, 'gu'), (m, T, v) => {
    const f = TU_FORMS[v.toLowerCase()]; if (!f) return m
    return (T === 'T' ? 'Vous' : 'vous') + ' vous ' + f
  })
  // "tu le peux", "tu le souhaites": an object pronoun between subject and verb.
  out = out.replace(new RegExp(`${B}([Tt])u (le |la |les |l['’])?(${WORD})${E}`, 'gu'), (m, T, obj, v) => {
    const f = TU_FORMS[v.toLowerCase()]; if (!f) return m
    return (T === 'T' ? 'Vous' : 'vous') + ' ' + (obj ? (/^l['’]$/.test(obj) ? 'l’' : obj) : '') + f
  })
  // "tu expires et pousses": the second verb shares the subject.
  out = out.replace(/(vous [\p{L}]+ez et )(pousses|tires|soulèves|abaisses)(?![\p{L}])/gu, (m, a, v) => a + TU_FORMS[v])

  // Imperatives with a hyphenated pronoun: unambiguous, so anywhere.
  out = out.replace(new RegExp(`${B}(${WORD})-(${PRON})${E}`, 'gu'), (m, v, p) => {
    if (!VERBS.has(v.toLowerCase())) return m
    return cap(v, vousImperative(v)) + '-' + (p.toLowerCase() === 'toi' ? (p === 'Toi' ? 'Vous' : 'vous') : p)
  })
  // Bare imperatives, where a verb stands. AT is a lookbehind, not a consumed prefix: in ", puis
  // abaisse" the comma's match would swallow "puis", and the verb after it would never be tried.
  out = out.replace(new RegExp(`${AT}${B}(${WORD})${E}(?!-)`, 'gu'), (m, v) =>
    (VERBS.has(v.toLowerCase()) ? cap(v, vousImperative(v)) : m))

  // Pronouns and possessives.
  out = out.replace(new RegExp(`${B}([Tt])oi-même${E}`, 'gu'), (m, T) => (T === 'T' ? 'V' : 'v') + 'ous-même')
  out = out.replace(new RegExp(`${B}([Tt])oi${E}`, 'gu'), (m, T) => (T === 'T' ? 'V' : 'v') + 'ous')
  out = out.replace(new RegExp(`${B}([Tt])on${E}`, 'gu'), (m, T) => (T === 'T' ? 'V' : 'v') + 'otre')
  out = out.replace(new RegExp(`${B}([Tt])a${E}`, 'gu'), (m, T) => (T === 'T' ? 'V' : 'v') + 'otre')
  out = out.replace(new RegExp(`${B}([Tt])es${E}`, 'gu'), (m, T) => (T === 'T' ? 'V' : 'v') + 'os')
  out = out.replace(new RegExp(`${B}([Tt])e${E}`, 'gu'), (m, T) => (T === 'T' ? 'V' : 'v') + 'ous')
  out = out.replace(new RegExp(`${B}([Tt])['’](?=[${L}])`, 'gu'), (m, T) => (T === 'T' ? 'V' : 'v') + 'ous ')
  return out
}

// What is left that still reads as "tu": the pronouns, and any listed verb in its tu form.
export function tuLeft(s) {
  const hits = []
  for (const re of [
    new RegExp(`${B}(?:tu|toi|ton|ta|tes|te)${E}`, 'giu'),
    new RegExp(`${B}t['’](?=[${L}])`, 'giu'),
    new RegExp(`${B}(${WORD})-toi${E}`, 'giu'),
  ]) for (const m of s.matchAll(re)) hits.push(m[0])
  for (const m of s.matchAll(new RegExp(`${AT}${B}(${WORD})${E}`, 'gu')))
    if (VERBS.has(m[1].toLowerCase())) hits.push(m[1])
  return hits
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend', 'src', 'instr', 'fr.js')
  const src = readFileSync(file, 'utf8')
  const header = src.slice(0, src.indexOf('export default '))
  const pack = JSON.parse(src.slice(src.indexOf('export default ') + 'export default '.length))
  if (process.argv.includes('--check')) {
    const left = []
    for (const [id, steps] of Object.entries(pack)) steps.forEach((s, i) => { for (const h of tuLeft(s)) left.push(`${id}[${i}] ${h}: ${s}`) })
    if (left.length) { console.error(left.length + ' "tu" form(s) left:\n' + left.join('\n')); process.exit(1) }
    console.log(`ok    ${Object.keys(pack).length} exercises, no "tu" left`)
  } else {
    let changed = 0
    for (const steps of Object.values(pack)) steps.forEach((s, i) => { const v = toVous(s); if (v !== s) { steps[i] = v; changed++ } })
    writeFileSync(file, header + 'export default ' + JSON.stringify(pack) + '\n')
    console.log(`${changed} steps rewritten`)
  }
}
