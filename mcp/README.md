# openGym MCP server

> **In FitPal Coach, use remote mode** (below). The file mode reads the `state-<uid>.json` files
> upstream's Node API wrote into `DATA_DIR`; the Laravel backend that replaced it (CHW-301) keeps
> that data in its database, so there are no such files. Remote mode (CHW-316) reads the same state
> from the server's own `GET /api/data`, with a token you pair once like the mobile app.

A [Model Context Protocol](https://modelcontextprotocol.io) bridge that lets an external LLM
application (Claude Desktop, Cursor, Cline, Continue, etc.) read your openGym profile —
routines, workouts, body-weight log, estimated 1RMs, and muscle balance — directly from your
self-hosted `./data` directory.

It is read-only, runs locally as a stdio process spawned by the LLM client, adds no new
container, and requires no extra authentication. The LLM never sees passkeys, VAPID keys, or
session secrets — it can only read the same `state-<uid>.json` files the openGym api already
writes.

The numbers it answers with are computed by the **same pure functions the React UI uses**
(`frontend/src/lib/*.js`) — `estimate1RM`, `loadOfWorkouts`, `effectiveRoutine`, etc. — so a
"what's my bench 1RM?" answer matches the Stats screen exactly.

> Phase 1 of a multi-phase plan. Read-only today; long-lived token auth + write tools are
> planned but not shipped yet. See **Roadmap** below.

## Remote mode: a running server (FitPal Coach)

```bash
cd mcp && npm install

# Once: in a browser signed in as you, Settings → "Pair the mobile app" shows a code (5 minutes).
node scripts/pair.mjs https://coach.fitpal.ma <code>
# → paired as <you> (<id>); token saved to ~/.opengym-mcp/token.json
```

Then register it with `OPENGYM_URL` instead of `OPENGYM_DATA`:

```jsonc
{
  "mcpServers": {
    "fitpal": {
      "command": "node",
      "args": ["/absolute/path/to/fitpal-coach/mcp/src/index.js"],
      "env": { "OPENGYM_URL": "https://coach.fitpal.ma" }
    }
  }
}
```

- **What the token is.** The same session a paired phone holds: your whole account, not a
  read-only key. It is kept in `~/.opengym-mcp/token.json` (owner-only; `OPENGYM_TOKEN_FILE`
  moves it), never in the client config and never printed. The server only ever GETs `/api/me` and
  `/api/data` with it.
- **When it stops working.** It expires after the server's `SESSION_DAYS` (90 by default), and
  Settings → "Sign out everywhere" ends it at once. A tool call then says so; run `pair.mjs`
  again, no restart needed.
- **Fresh on every call.** Each tool call reads `/api/data` again, so a session the phone just
  synced is in the next answer. https only, except `localhost` for a dev server.
- **Whose data.** Yours, as your app syncs it. A coach's clients are not readable this way.

## File mode: upstream's Node API

### 1. Install

```bash
cd mcp
npm install
```

### 2. Point it at your data

The MCP server reads the same `./data` directory the API writes to. Pick the profile
to answer for — its user id is in `./data/db.json` under `users[].id`:

```bash
# single-user instance (the common self-hosted case) — auto-detected:
node src/index.js

# multi-user instance, or just to be explicit:
OPENGYM_UID=<your-uid> OPENGYM_DATA=/path/to/openGym/data node src/index.js
```

### 3. Register with your LLM client

Add the server to your LLM client's MCP config. For Claude Desktop, edit
`claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```jsonc
{
  "mcpServers": {
    "opengym": {
      "command": "node",
      "args": ["/absolute/path/to/openGym/mcp/src/index.js"],
      "env": {
        "OPENGYM_DATA": "/absolute/path/to/openGym/data",
        "OPENGYM_UID": "<your-uid>"   // optional — auto-detected if you have one profile
      }
    }
  }
}
```

For Cursor and other MCP-compatible clients, see the client's MCP docs — the same `command` +
`args` + `env` shape is what every stdio MCP server expects.

Restart the client; you should see the openGym tools appear with "serving profile \<name\>" on
the server's stderr.

## Tools

Nine read-only tools in v1:

| Tool | What it answers |
|---|---|
| `list_routines` | What routines are saved in my profile? (names + exercise counts) |
| `get_routine` | What does the Push Day routine prescribe? (sets/reps/weight and rest per exercise) |
| `preview_session` | What will the app actually put on screen when I start this routine — after the progression policy and my history have overridden the plan? |
| `get_week_plan` | What's on my plan this week, including today with any date-specific override? |
| `list_workouts` | Recent sessions — newest first, with dates, sets done/planned, volume, duration, PRs. |
| `get_workout` | Full set-by-set breakdown of one session, by `workout_id` or by date. On a day with two sessions the date alone returns both ids to pick from rather than guessing at one. |
| `get_bodyweight` | Weigh-ins with the latest weight, the goal line, and deltas vs goal. |
| `estimate_1rm` | All-time best 1RM for an exercise + the trend, or a PR table across all exercises. |
| `muscle_balance` | Which muscles I've trained this week/month/all-time, ranked + which I've neglected. |

`get_routine` and `preview_session` answer two different questions, and confusing them is the
easiest way for a coach to give wrong advice. `get_routine` reports what the routine *stores*.
`preview_session` reports what the athlete will actually *see*: a routine holding "squat 3×8 @
60 kg" opens at 75 kg if the policy deloaded from the last logged session, and the rep counts
come from history, not the plan. The routine's own numbers are the last fallback the session
builder consults, not the first. Ask `preview_session` before naming a weight.

Each tool returns JSON the LLM can format as it likes; structured fields (sets, dates, levels)
are pre-formatted into human-readable labels in `src/labels.js` so the LLM doesn't need to
re-interpret them.

## How it reuses the training logic

The MCP server imports the training helpers under `frontend/src/lib/` directly as Node ESM
and calls the same functions the React UI does (`history.js`, `onerm.js`, `muscles.js`,
`exercises.js`). The numbers it returns match what the Stats screen shows, because they are
the same code.

The one lib file that wasn't Node-safe was `i18n.js` (Vite's `import.meta.glob` at module
top level) — split into `i18n-core.js` (pure, Node-safe) + `i18n.js` (Vite/React bits,
re-exports from core). `exercises.js` got a one-line `import.meta.env || {}` guard. No new
dependencies landed in `frontend/`, no public exports changed.

## Design constraints honoured

- **One runtime dependency beyond the MCP SDK:** none. No database driver, no HTTP framework:
  remote mode uses Node's own `fetch`, through the API's own sign-in and tenancy.
- **No new process to run.** stdio transport is spawned by the LLM client; nothing extra to
  deploy or keep alive.
- **No new auth.** The filesystem is the boundary — same as the API running on the
  user's box. No passkey material, VAPID keys, or session secrets ever cross it.
- **No telemetry.** File mode makes no network call: it reads `./data/*.json` and exits when the
  LLM client disconnects. Remote mode calls the one server you paired with, and nothing else.

## Tests

```bash
cd mcp && npm test
```

58 cases seeding state from `frontend/src/lib/demoSeed.js` (the same deterministic fixture
the public demo runs on). Pins JSON shape and the user-facing edge cases: rest-day override,
missing routine, zero-workout history, no synced state, superset links, three 1RM formulas.
"Today" is pinned via `vi.useFakeTimers({ now: ..., toFake: ['Date'] })` so date-dependent
tools see consistent values regardless of when the suite runs. The pure lib functions have
their own 92 tests in `frontend/src/lib/*.test.js`.

`test/remote.test.js` covers remote mode against a fake server that checks the bearer token:
pairing, the token file, a refused or foreign token, a fresh read on every call, an account
that never synced, and re-pairing without a restart.

## Roadmap

- **Done (Phase 1):** read-only stdio, 8 tools, direct `./data` access.
- **Done (Phase 1.5):** `preview_session` — the policy's next prescription, the opening set
  rows it produces, and which of plan / confirmed weight / history each number came from.
- **Phase 2:** read+write over stdio. Requires a long-lived token auth path minted from the
  admin dashboard (new `./data/tokens.json`) and a write-lock against the web UI's read-modify-
  write of `state-<uid>.json`. Tools: `log_workout`, `add_bodyweight`, `edit_routine`,
  `assign_weekday`, `override_day`.
- **Phase 3:** Streamable HTTP transport, opt-in second listener beside the API. Same
  tool implementations, second transport — the MCP SDK supports both behind one tool registration.


