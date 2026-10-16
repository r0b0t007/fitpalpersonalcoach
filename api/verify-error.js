import { say } from './domain.mjs';

// @simplewebauthn reports an RP_ID or origin mismatch as an opaque "Unexpected ..." string, and
// whoever reads it in the browser has no way to connect that to their .env. A misconfigured
// RP_ID/ORIGIN is the single most common self-hosting failure (see docs/SELF_HOSTING.md), so
// name both values back. Neither is a secret: one is the address bar, the other its hostname.
const MISCONFIGURED = /unexpected (rp id|authentication response origin|registration response origin)/i;

export function verifyError(e, { rpId, origin } = {}) {
  if (!(e && e.message)) return say('verification failed');
  const msg = String(e.message);
  if (!MISCONFIGURED.test(msg)) return say`verification failed: ${msg}`;
  // One template, not two joined: the app has to find the whole sentence as one key.
  return say`${msg} — this server is configured with RP_ID=${rpId} and ORIGIN=${origin}, and both must match the address you opened. See docs/SELF_HOSTING.md.`;
}
