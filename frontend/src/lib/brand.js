// White-label identity — every user-facing brand string lives here, so a rebrand (or an
// upstream merge) is a one-file diff instead of a fifteen-file sweep. The exceptions cannot
// import ESM and keep their own literals: public/sw.js, index.html and public/manifest.json.
// If you change BRAND, change the title check in .github/workflows/deploy-web.yml with it —
// that grep is what stops this app and FIT'ONE being deployed over each other.
export const BRAND = 'FitPal Coach'
export const TAGLINE = 'PERSONAL COACHING'
export const BRAND_DOMAIN = 'coach.fitpal.ma'   // shown in the plan-PDF footer when set
export const FILE_PREFIX = 'fitpal-coach'       // backup / plan-file name prefix
// The FitPal metallic, taken from fitpal.ma itself — fixed, not the user accent, so the logo
// never recolours when someone picks a different accent in Settings.
export const GOLD = '#D4AF37'
