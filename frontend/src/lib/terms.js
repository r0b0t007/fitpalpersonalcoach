// The coach terms and processor agreement (CHW-357) on fitpal.ma: French, Spanish or English
// (German reads English), as the legal page is. The version a coach accepts comes from the server
// (/api/config terms_version, /api/coach/terms), never from here.
const TERMS = { fr: 'https://fitpal.ma/conditions', es: 'https://fitpal.ma/es/terms' }
export const termsUrl = lang => TERMS[lang] || 'https://fitpal.ma/en/terms'

// Where a follower (CHW-334) or a coach signing up (CHW-375) reads who holds their data, for how
// long, and their rights: the privacy section of fitpal.ma's legal page, in the same languages.
const PRIVACY = { fr: 'https://fitpal.ma/mentions-legales#donnees', es: 'https://fitpal.ma/es/legal#datos' }
export const privacyUrl = lang => PRIVACY[lang] || 'https://fitpal.ma/en/legal#data'
