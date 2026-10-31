#!/usr/bin/env node
/* Pair this MCP server with your account on a running server, once (remote mode, src/remote.js).
 *
 *   node scripts/pair.mjs <server address> <code>
 *
 * The code: in a browser signed in as you, Settings → "Pair the mobile app". It works once and
 * expires in 5 minutes. The token it buys is saved to OPENGYM_TOKEN_FILE (default
 * ~/.opengym-mcp/token.json) and never printed: it is a session for your whole account.
 */
import { pair, tokenFile } from '../src/remote.js'

const [url, code] = process.argv.slice(2)
if (!url || !code) {
  console.error('usage: node scripts/pair.mjs <server address> <code>\n' +
    '  the code: Settings → "Pair the mobile app", in a browser signed in as you')
  process.exit(2)
}
try {
  const user = await pair(url, code, tokenFile())
  console.log(`paired as ${user.name} (${user.id}); token saved to ${tokenFile()}`)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
