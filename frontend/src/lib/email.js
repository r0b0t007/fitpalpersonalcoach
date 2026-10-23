// Whether a string looks enough like an email address to send a link to. Only a guard against
// an obvious slip before a request (or a passkey prompt) is spent: the server checks properly and
// has the last word. ONE copy — a hand-copied variant of this once lost its backslashes and
// turned away every address with an "s" in it.
export const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim())
