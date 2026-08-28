// White-label identity — every user-facing brand string lives here, so a rebrand (or an
// upstream merge) is a one-file diff instead of a fifteen-file sweep. The one exception is
// public/sw.js, which cannot import ESM and keeps its own literals.
export const BRAND = "FIT'ONE"
export const TAGLINE = 'CLUB FITNESS'
export const BRAND_DOMAIN = ''            // shown in the plan-PDF footer when set
export const FILE_PREFIX = 'fitone'       // backup / plan-file name prefix
export const GOLD = '#D4AF37'             // the logo's metallic gold — fixed, not the user accent
