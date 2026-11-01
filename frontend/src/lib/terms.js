// The coach terms and processor agreement (CHW-357) on fitpal.ma: French, Spanish or English
// (German reads English), as the legal page is. The version a coach accepts comes from the server
// (/api/config terms_version, /api/coach/terms), never from here.
const TERMS = { fr: 'https://fitpal.ma/conditions', es: 'https://fitpal.ma/es/terms' }
export const termsUrl = lang => TERMS[lang] || 'https://fitpal.ma/en/terms'
