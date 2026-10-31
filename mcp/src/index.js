#!/usr/bin/env node
/* openGym MCP server — stdio transport. The LLM client (Claude Desktop, Cursor, …) spawns
   this process locally, talks JSON-RPC over stdin/stdout, tears it down when the session ends.
   No extra container. File mode makes no network call — your data stays in a folder you control;
   remote mode (remote.js) calls the one server you paired with, and only that. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { TOOLS } from './tools.js'
import { init, getUser, isRemote, refresh } from './state.js'
import { remoteBase, savedPairing, tokenFile } from './remote.js'

const server = new McpServer({
  name: 'opengym',
  version: '0.1.0'
})

// Fail fast on bad config so a misnamed OPENGYM_DATA doesn't silently answer every call with
// the no-state sentinel. Always register every tool so the LLM sees the full list at
// handshake, even when state didn't resolve.
// Remote mode checks only what is on this machine here (the address, the saved pairing): the
// handshake must not wait on the network, and every tool call reads the server anyway.
try {
  if (isRemote()) {
    const base = remoteBase(process.env.OPENGYM_URL)
    const { user } = savedPairing(base, tokenFile())
    console.error(`[opengym-mcp] serving profile ${user?.name} (${user?.id}) from ${base}, read on each call`)
  } else {
    init()
    const u = getUser()
    console.error(`[opengym-mcp] serving profile ${u.name} (${u.id})`)
  }
} catch (e) {
  console.error(`[opengym-mcp] ${e.message}`)
  // Don't exit — keep the tool listings up so the user sees a useful error after fixing their
  // env and restarting.
}

for (const t of TOOLS) {
  server.tool(
    t.name,
    t.description,
    t.schema,
    async (params) => {
      try {
        await refresh()   // remote mode: the state as the server has it now; file mode: a no-op
        const result = t.handler(params || {})
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      } catch (err) {
        const code = err.code || 'ERROR'
        return {
          isError: true,
          content: [{ type: 'text', text: `${code}: ${err.message}` }]
        }
      }
    }
  )
}

const transport = new StdioServerTransport()
await server.connect(transport)
// Process stays alive serving JSON-RPC over stdio until the LLM client disconnects.
