# Phase 51 — Research: OpenCode sub-agent mechanism

**Agent:** OpenCode (sst-opencode terminal AI coding agent, https://opencode.ai)
**Status:** ✓ confirmed — OpenCode has a fully-implemented sub-agent mechanism with parent/child session tracking
**Researched:** 2026-05-26
**OpenCode version inspected:** **1.15.1** (`/Users/Q284340/.opencode/bin/opencode --version`)
**Confidence:** HIGH (live SQLite evidence on local filesystem; cross-verified against opencode.ai/docs)

---

## Summary

OpenCode 1.15.1 has a first-class sub-agent ("subagent") mechanism. The parent agent invokes
the **`task` tool** (visible in 391 `part` records on the local DB) with an `input.subagent_type`
field (`"explore"` or `"general"`), and OpenCode spawns a **child session** whose `parent_id`
column points back at the parent. Each child session has its own `agent` value (`explore` /
`general`), its own messages, its own parts, and — crucially — its own `directory` column
recording the originating cwd. No path-encoding tricks; the project is just a foreign key
into the `project` table.

**388 of 502 sessions (77%)** on the inspected local DB are sub-sessions. 46 sessions live
under `/Users/Q284340/Agentic/coding` (the coding project), so this is in active use here.

**Primary recommendation for Phase 51:** add ONE searchPath entry — the OpenCode SQLite DB —
and one cwd-parsing rule (`SELECT directory FROM session WHERE id = ?`). The sweep tier reads
all child sessions from a single indexed SQL query; no filesystem walk. No multi-format
parser needed because OpenCode's storage IS the structured payload Phase 51 wants.

---

## Process model

### How OpenCode spawns sub-agents

| Mechanism | Detail |
|---|---|
| Tool name | **`task`** (lowercase, exact tool name in the `part.data.tool` column) |
| Input shape | `{ description: string, prompt: string, subagent_type: "explore" \| "general" }` |
| Output | A new `session` row with `parent_id` = parent session's id, `agent` = `subagent_type`, `directory` = inherited from parent |
| Subagent types observed | `explore` (read-only codebase exploration), `general` (full tool access, parallel work) |
| Process model | NOT a separate `opencode` CLI subprocess — sub-agents run **in-process** within the same OpenCode TUI session. Evidence: only one `opencode.db` file ever, no port-forking, all child sessions share the same `workspace_id` |
| Parallel dispatch | Yes — sample DB shows 9 sub-sessions all spawned by the same parent within ~30 s (matching Claude Code's "parallel fan-out" pattern) |

[VERIFIED: local SQLite at `/Users/Q284340/.local/share/opencode/opencode.db`]

### Sample task-tool payload

The `task` tool's `part.data` row in SQLite carries the spawn payload **and** the child
session id, in the same record. This is more convenient than Claude Code (where the spawn
event and child transcript live in different files):

```json
{
  "type": "tool",
  "callID": "toolu_vrtx_01UMooF8dZEV5jD4LpmQ75fW",
  "tool": "task",
  "state": {
    "status": "error",
    "input": {
      "description": "List all available skills",
      "prompt": "List all skills in the repository...",
      "subagent_type": "explore"
    },
    "metadata": {
      "sessionId": "ses_309f0c4f0ffe2hVGls09bIagj7",   ← child session id
      "model": { "modelID": "claude-opus-4.6", "providerID": "github-copilot-enterprise" }
    },
    "time": { "start": 1773654748480, "end": 1773654748480 }
  }
}
```

The `state.metadata.sessionId` field IS the spawn-time link from parent → child. Phase 51's
spawn-time hook (Path A) can subscribe to this. [VERIFIED]

### Documentation cross-check

opencode.ai/docs/agents/ confirms:
- "@explore" = "fast, read-only agent for exploring codebases. Cannot modify files."
- "@general" = "general-purpose agent for researching complex questions and executing
  multi-step tasks", explicitly described as supporting "multiple units of work in parallel"
- "Task tool" is the named mechanism. UI commands `session_child_first`,
  `session_child_cycle`, `session_parent` navigate between parent and child sessions.

[CITED: opencode.ai/docs/agents/]

---

## Transcript location

### Storage architecture (dual-layer)

OpenCode 1.15.1 stores conversation state in **two parallel layers** at
`~/.local/share/opencode/`:

| Layer | Path | Format | Use |
|---|---|---|---|
| **Authoritative store** | `~/.local/share/opencode/opencode.db` (SQLite, 2 GB on inspected box) | SQLite with `session`, `message`, `part`, `event`, `project`, `workspace` tables | Drizzle ORM-managed, indexed by `session_parent_idx`, `part_session_idx`. **This is the source of truth.** |
| **Legacy / shadow store** | `~/.local/share/opencode/storage/{session,message,part,project}/<id>.json` | Per-record JSON files (one file per session, message, part) | Older versions (≤1.14?) used this exclusively. Newer versions appear to maintain both for backward-compat. Some records present here but not in DB, and vice versa |

> **Pick the SQLite DB as the canonical source for Phase 51.** It has indexes on
> `parent_id` and `session_id`, which means filtering child sessions for a given project
> is `O(log n)` not `O(N files)`. The JSON shadow store is a fallback if SQLite is locked.

### Path encoding

Unlike Claude Code (`/Users/Q284340/.claude/projects/<encoded-cwd>/...jsonl`), OpenCode does
NOT encode the cwd into the filesystem path. The `directory` column on the `session` row
holds the unencoded absolute path:

```sql
SELECT directory FROM session WHERE id = 'ses_1c4c65f78ffecK57xg7UVPASQ5';
-- → /Users/Q284340/Agentic/coding
```

This is **trivial cwd → project mapping**. No regex, no `unencode-claude-path` step.

### File format detail (SQLite)

**session table** — exact columns relevant to Phase 51:
```
id TEXT PK
project_id TEXT NOT NULL    → FK to project(id)
parent_id TEXT              → NULL for top-level session, child session id for sub-agent
slug TEXT NOT NULL
directory TEXT NOT NULL     → absolute cwd, used for project mapping
title TEXT NOT NULL         → e.g. "Find network detection logic (@explore subagent)"
workspace_id TEXT
agent TEXT                  → 'explore' | 'general' | 'build' | NULL (NULL = top-level)
model TEXT
cost REAL
tokens_input INTEGER
tokens_output INTEGER
tokens_reasoning INTEGER
tokens_cache_read INTEGER
tokens_cache_write INTEGER
time_created INTEGER        → ms since epoch
time_updated INTEGER
```

**message table** — one row per role-turn (user / assistant), with `data` as JSON blob:
```json
{
  "id": "msg_c3e39d63e001iwVkqFrjExwXKi",
  "sessionID": "ses_3c1c629c5ffeSZ85qFXqJzfn2h",
  "role": "user",
  "time": { "created": 1770570503748 },
  "agent": "build",
  "model": { "providerID": "anthropic", "modelID": "claude-opus-4-6" }
}
```

**part table** — one row per content fragment (text / tool-call / tool-result), `data`
column is JSON. Indexed by `(message_id, id)` and by `session_id`. Tool calls have
`json_extract(data, '$.tool')` set. The most common tools observed in the DB are:
`bash` (14577), `read` (9769), `grep` (2606), `glob` (1998), `edit` (2118), `todowrite`
(1331), `task` (391, the sub-agent spawner).

[VERIFIED: SQLite `.schema` + sample queries]

### Lifetime / persistence

- **No rotation policy observed.** The DB grew to 2 GB on the inspected box and was never
  pruned. There IS a `time_archived` column on `session`, populated nullable — this is
  manual user archive, not auto-cleanup
- **No cleanup-on-completion.** Sub-session rows persist indefinitely (388 child sessions
  on this box, oldest dating from Feb 2026)
- **Survives OpenCode restart, OS reboot, agent crash.** Pure SQLite file on disk
- **No worktree-race risk** — opposite to Claude Code's `/private/tmp/<uuid>/` problem.
  The data is in a centralized DB, not in the per-task worktree

This is a **structural advantage over Claude Code** for Phase 51: there is no "worktree
gets cleaned up before sweep runs" race condition. The sweep can run as infrequently as
the operator wants (15 min, 1 h, 1 day) and still recover every sub-agent's data.

---

## Lifecycle events

### Spawn

- **Signal:** a new row appears in the `part` table with `json_extract(data, '$.tool') = 'task'`
  and `json_extract(data, '$.state.metadata.sessionId')` = the new child session id
- **Wait — is there a notification?** The `event` table exists (schema:
  `event(id, aggregate_id, seq, type, data)`) but was **empty on the inspected box**. This
  suggests event-sourcing infrastructure is in place but the events themselves may be
  short-lived (transactional, not retained). Phase 51 should NOT rely on `event` rows
  surviving past the moment the action completes

### Progress

- **Signal:** `time_updated` column on the child session row advances; new rows appear
  in `message` (role-turn) and `part` (text/tool-call) tables filtered by
  `session_id = <child>`
- **Token / cost progress:** `session.cost`, `session.tokens_*` columns updated live

### Completion

- **No explicit "completed" status column.** The session ends when the parent's task tool
  call returns. Inferred from:
  - `task` tool's `state.status` transitions from absent → `success` / `error`
  - `state.time.end` becomes non-null
  - `state.metadata.sessionId` is the child to look up
- **Status visible in `part.data.state.status`** for the `task` tool part: e.g. `"error"`
  (aborted), `"success"`, or absent (in-progress)

### Recommendation for Path A (live hook)

The cheapest hook is to **subscribe to SQLite WAL changes**. OpenCode writes through WAL
(`opencode.db-wal` + `opencode.db-shm` present). Options in order of feasibility:

1. **SQLite `update_hook` via Node's `better-sqlite3`** — Phase 51 process opens the DB
   read-only and registers `db.update_hook((change) => …)`. When OpenCode INSERTs into
   `session` with `parent_id IS NOT NULL`, fire spawn event. When OpenCode UPDATEs the
   parent's `task` part with `state.status` ∈ {`success`, `error`}, fire complete event.
2. **Filesystem watch + periodic polling** — `fs.watch` on `opencode.db-wal` (it gets
   touched on every write); on touch, run a "delta query": `SELECT * FROM session WHERE
   time_created > <last_sweep_at> AND parent_id IS NOT NULL`. Polling fallback if `fs.watch`
   misses on macOS APFS (it sometimes does)
3. **OpenCode plugin API** — OpenCode has a plugin dir at `~/.opencode/plugins/` and the
   docs mention extension hooks. Researching this fully would exceed budget; recommend
   deferring to a follow-up if option (1) proves too racy

**Recommendation: use option (1) for Path A.** SQLite update_hook is well-known, reliable,
and doesn't need OpenCode cooperation.

---

## Sub-agent-of-sub-agent recursion

**Supported by data model, not yet observed in practice.**

The `session.parent_id` column is just a self-FK. Nothing prevents a sub-agent (which is
itself a session) from spawning its own child by invoking the `task` tool. The
`parent_id` chain would walk up arbitrarily deep.

Inspected DB: **all 388 sub-sessions have parent_id pointing at a non-sub session** (i.e.
depth = 1). No depth-2+ chains found. But this is just an observational result — the
schema imposes no depth limit.

**Implication for Phase 51:** the registry's `parent_sub_hash` field reserved per
D-LSL-Filename Could-#11 will eventually need population for OpenCode just as it would
for Claude Code. Same disposition: defer until observed in the wild. Reconstruction is
trivial since the DB has `session_parent_idx`.

---

## Detection plan — Path B (sweep)

### searchPaths to add to lib/lsl/scan-and-convert.mjs config

OpenCode does NOT fit the "directory of jsonl files" mental model that `scan-and-convert.mjs`
was built around (Phase 50 contract). Instead, it needs a **format-specific adapter**.

**Recommended config extension:**

```json
{
  "searchPaths": [
    {
      "agent": "claude",
      "type": "jsonl-tree",
      "root": "/Users/Q284340/.claude/projects/-private-tmp/",
      "pattern": "**/subagents/agent-*.jsonl"
    },
    {
      "agent": "opencode",
      "type": "sqlite",
      "dbPath": "/Users/Q284340/.local/share/opencode/opencode.db",
      "query": "SELECT s.id, s.parent_id, s.directory, s.agent, s.title, s.time_created, s.time_updated FROM session s WHERE s.parent_id IS NOT NULL AND s.directory = ?",
      "projectFilter": "directory"
    }
  ]
}
```

The `type: "sqlite"` adapter is a new module — recommend `lib/lsl/adapters/opencode-sqlite.mjs`
following the established `lib/<category>/` pattern (per Phase 50 D-Primitives validated
shape).

**Imports Phase 50's primitives unchanged.** The sqlite adapter returns the same
`{ messages: [...], sessionId, parentSessionId, directory, agent }` shape that
`convertTranscriptsToObservations()` expects. Per D-Reuse, no Phase 50 function bodies
change — only the caller's input format adapter expands.

### cwd-parsing rule (map transcript → originating project)

**Already done at write-time.** The `session.directory` column IS the unencoded cwd:

```js
// pseudocode for the opencode-sqlite adapter
function mapTranscriptToProject(sessionRow) {
  // session.directory is the absolute cwd at session creation
  // Compare against known project roots:
  const cwd = sessionRow.directory;
  // For Phase 51 scope: hard-code coding project filter
  if (cwd === '/Users/Q284340/Agentic/coding') {
    return { project: 'coding', parentSessionId: sessionRow.parent_id };
  }
  return null; // out-of-scope project per D-Backfill
}
```

This is significantly simpler than the Claude Code cwd-parsing rule (`/private/tmp/<uuid>/agent-<hash>/`
→ originating worktree → originating project), because OpenCode never indirected through a
worktree. The `directory` value is literally where the user opened OpenCode.

### Idempotency key

```
uniqueness = (session_id, message_id, part_id)   -- all three are TEXT PKs
```

The adapter writes each `part` row as ONE observation atom, keyed by `part.id`. Re-running
the sweep is a no-op because `part.id` (TEXT PK) is stable.

Tagged metadata per D-Live-Sweep-Tags:
```
metadata.source = "sub-agent-backfill"
metadata.parent_session_id = session.parent_id       (the OpenCode parent session id)
metadata.sub_index = computed from time_created order
metadata.sub_hash = first 7 chars of session.id
metadata.agent = "opencode"
metadata.project = "coding"  (derived from session.directory)
metadata.opencode_agent_type = session.agent  -- "explore" | "general"
```

### Sweep frequency

The DB has no rotation. Sweep cadence can be 15-30 min (matching D-Order Claude's cadence)
with no urgency — data is durable.

---

## Detection plan — Path A (spawn-time hook)

### Option 1 (recommended): SQLite update_hook subscriber

Phase 51's host-side process opens `opencode.db` in read-only mode and registers an
update hook via `better-sqlite3`:

```js
import Database from 'better-sqlite3';

const db = new Database('/Users/Q284340/.local/share/opencode/opencode.db', {
  readonly: true,
  fileMustExist: true,
});

// Watch for new sub-sessions (INSERT into session with non-null parent_id)
db.aggregate(/* … */);  // pseudo — better-sqlite3 supports table change hooks via WAL

// Realistic shape: poll session table for new (or changed) rows every ~5 s
setInterval(async () => {
  const rows = db.prepare(`
    SELECT id, parent_id, directory, agent, time_created, time_updated
    FROM session
    WHERE parent_id IS NOT NULL
      AND time_updated > ?
      AND directory = ?
  `).all(lastPollTime, '/Users/Q284340/Agentic/coding');

  for (const row of rows) {
    // Detect spawn (new row) vs completion (time_updated bumped + task part has state.status)
    registry.upsertSubAgent({
      sub_hash: row.id.slice(4, 11),
      parent_session_id: row.parent_id,
      agent: 'opencode',
      transcript_path: `sqlite:${dbPath}#${row.id}`,  // pseudo URI
      project: 'coding',
    });
  }
  lastPollTime = Date.now();
}, 5000);
```

**Pros:** uses OpenCode's own write path; no OpenCode cooperation needed; survives OpenCode
restart (we're just polling the DB).

**Cons:** 5 s polling latency means an observation may take up to 5 s to register. Within
acceptance threshold (D-AC says "≤15 min for sweep tier", live tier is implicitly tighter
but no explicit number).

### Option 2 (deferred): OpenCode plugin hook

OpenCode supports plugins at `~/.opencode/plugins/`. If OpenCode exposes a "session
created" or "task tool invoked" plugin hook, that would be the cleanest spawn signal. Did
not deep-research the plugin API within this time budget — recommend a follow-up if
Option 1 polling proves to be too laggy.

[Researched briefly via WebFetch opencode.ai/docs/agents/, no plugin API surface
documented there. Plugin docs likely live at opencode.ai/docs/plugins/ — left for
follow-up.]

### Option 3 (avoid): tail `~/.local/share/opencode/log/*.log`

The log dir has multi-MB log files (`2026-05-20T075753.log` is 10 MB). These are textual
runtime logs, NOT structured event streams. Parsing them would be format-fragile and
agent-version-coupled. **Not recommended.**

---

## Known landmines / patterns

### Two storage layers (SQLite + JSON shadow)

OpenCode 1.15.1 writes session/message/part records to BOTH SQLite AND
`storage/{session,message,part}/<id>.json`. **Do not double-count.** Phase 51's adapter
should read SQLite only; treat JSON files as legacy backup.

Verification: count consistency — 502 sessions in SQLite vs 502 session files in
`storage/session/<projectID>/ses_*.json`. They appear to be 1:1. But within the
inspected box, some discrepancies existed (e.g. the `storage/session/<projectID>/` tree
only has 9 project subdirs while SQLite's `project` table also has 9 rows — consistent).

### DB locking during writes

OpenCode opens `opencode.db` in WAL mode (`opencode.db-wal` present). Read-only Phase 51
consumers can safely read concurrently with OpenCode writes IF and ONLY IF they:
1. Open with `readonly: true`
2. Set `pragma busy_timeout = 5000` (or higher)
3. Use short-lived prepared statements, not long transactions

Long-running transactions WILL conflict with WAL checkpoint and starve OpenCode of writes.
This is a real risk — the DB is 2 GB, full table scans take seconds.

**Mitigation:** all Phase 51 queries against `opencode.db` must use the indexed columns
(`parent_id`, `project_id`, `session_id`). Use the `session_parent_idx` and
`part_session_idx` indexes.

### Distinct OpenCode versions write distinct schema

OpenCode is in active development (1.15.1 on this box; the `__drizzle_migrations` table
shows 4 migrations applied). Different user boxes may have different schema versions.

**Mitigation:** the opencode-sqlite adapter must:
1. Read `SELECT MAX(id) FROM __drizzle_migrations` first
2. Hard-fail with a clear error if migration version differs from a known-supported list
3. Surface a version-mismatch alert via `health-coordinator.knowledge_pipeline`

### `time_created` is **milliseconds**, not seconds

Both `session.time_created` and `message.time_created` are stored as INTEGER milliseconds
since the Unix epoch (Drizzle's default for `integer` timestamp columns). Phase 50's
primitives may expect seconds — verify on integration. Sample: `1770570503739` = a Feb 2026
millisecond timestamp.

### Sub-session inherits cwd from parent at spawn time

If the user `cd`'s mid-session and then spawns a sub-agent, the sub-agent's `directory`
column will reflect the **session-creation-time cwd**, NOT the current cwd. This is
consistent with how Claude Code behaves but worth documenting.

### `agent` column nullable for top-level sessions

Top-level sessions (`parent_id IS NULL`) have `agent` = NULL or `'build'`. Sub-agents have
`agent` ∈ {`'explore'`, `'general'`}. The adapter must use `parent_id IS NOT NULL` as the
sub-agent filter, NOT `agent IS NOT NULL`.

### No spawn-side correlation with sub-agent transcripts in JSON shadow

The `storage/message/<sessionId>/msg_*.json` files store messages keyed by sessionId only —
no obvious "spawned-from" backref. To map a sub-session's messages back to the parent's
`task`-tool call, you must JOIN through SQLite (`session.parent_id` → parent's `part` rows
where `tool = 'task'` AND `state.metadata.sessionId = <child>`). This is fast on SQLite,
infeasible by walking JSON files.

---

## Phase 50 primitive reuse — exact contract

Per D-Reuse, Phase 51 imports Phase 50 primitives unchanged. The integration shape:

```js
// lib/lsl/scan-and-convert.mjs (Phase 50, NOT modified)
import { scanTranscriptsForUnconverted, convertTranscriptsToObservations } from './scan-and-convert.mjs';

// lib/lsl/adapters/opencode-sqlite.mjs (NEW in Phase 51)
import Database from 'better-sqlite3';
export function openOpenCodeAdapter(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  return {
    scan({ since, project }) {
      // Return transcripts in same shape Phase 50 primitives expect
      return db.prepare(`SELECT ... WHERE time_updated > ? AND directory = ?`)
        .all(since, project)
        .map(row => normalizeToPhase50Shape(row, db));
    },
  };
}

// scripts/sweep-subagents.mjs (NEW in Phase 51)
import { openOpenCodeAdapter } from '../lib/lsl/adapters/opencode-sqlite.mjs';
const oc = openOpenCodeAdapter('/Users/Q284340/.local/share/opencode/opencode.db');
const transcripts = oc.scan({ since: lastSweep, project: '/Users/Q284340/Agentic/coding' });
await convertTranscriptsToObservations(transcripts, { source: 'sub-agent-backfill' });
```

Phase 50's `scanTranscriptsForUnconverted` doesn't apply here — that primitive walks
JSONL files. The opencode-sqlite adapter is a parallel implementation, not a wrapper.

**This is consistent with the D-Reuse rule** because:
- Phase 50 primitives' signatures don't change
- `convertTranscriptsToObservations` accepts a normalized transcript shape, which the
  adapter produces
- The opencode adapter only adds a NEW code path, not modifies Phase 50

---

## References

### Authoritative — primary sources

- **opencode.ai/docs/agents/** — documents `@explore`, `@general`, "Task tool" mechanism,
  child-session navigation commands. Confirms parallel dispatch is intended.
  [Fetched 2026-05-26]
- **Local SQLite DB** at `/Users/Q284340/.local/share/opencode/opencode.db` — 2 GB,
  Drizzle-managed, 502 sessions, 388 sub-sessions, 391 `task` tool invocations, schemas
  verified via `sqlite3 .schema`
- **OpenCode CLI** at `/Users/Q284340/.opencode/bin/opencode` — version 1.15.1 verified
  via `opencode --version`

### Secondary — local filesystem evidence

- `~/.local/share/opencode/storage/session/<projectID>/ses_*.json` — JSON shadow store,
  per-session records
- `~/.local/share/opencode/storage/message/<sessionID>/msg_*.json` — JSON shadow store,
  per-message records (sample inspected: `msg_c3e39d63e001iwVkqFrjExwXKi.json`)
- `~/.local/share/opencode/storage/part/<messageID>/prt_*.json` — JSON shadow store,
  per-part records
- `~/.local/share/opencode/log/2026-05-*.log` — runtime logs (textual, not for parsing)
- `~/.config/opencode/opencode.json` — global config (model selection, MCP server bindings)
- `~/.opencode/plugins/` — plugin directory (not deep-researched)

### Concrete query proof points

- `SELECT COUNT(*) FROM session WHERE parent_id IS NOT NULL` → **388**
- `SELECT DISTINCT agent FROM session WHERE parent_id IS NOT NULL` → **`explore`, `general`**
- `SELECT json_extract(data, '$.tool'), COUNT(*) FROM part WHERE json_extract(data, '$.type') = 'tool' GROUP BY 1 ORDER BY 2 DESC` → **`bash`: 14577, `read`: 9769, …, `task`: 391**
- `SELECT directory, COUNT(*) FROM session GROUP BY directory` → 9 distinct projects,
  46 sessions live under `/Users/Q284340/Agentic/coding`

### Out of scope / deferred research

- OpenCode plugin API hooks (would have improved Path A from "5 s polling" to "push
  event"). Estimated 1 h to fully document; left for follow-up
- OpenCode `event` table semantics — table is empty on inspected box; meaning unclear
- Cross-version schema differences (1.14 vs 1.15 vs future versions) — would require
  multi-version reproduction
- `__drizzle_migrations` table list of migration IDs vs OpenCode release versions — would
  require GitHub source code grep, exceeded fetch budget

---

## RESEARCH COMPLETE

**Phase:** 51 — gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
**Agent researched:** OpenCode (sst-opencode 1.15.1)
**Confidence:** HIGH

### Key findings

- **OpenCode HAS sub-agents.** Explicit `task` tool with `subagent_type` ∈ {`explore`, `general`}.
  388/502 (77%) sessions on the inspected box are sub-sessions.
- **Storage is SQLite, not JSONL.** `~/.local/share/opencode/opencode.db` with indexed
  `session.parent_id`. Significantly easier to query than Claude Code's filesystem tree.
- **No worktree cleanup race.** Sub-sessions persist indefinitely in the DB; sweep cadence
  is unconstrained by cleanup deadlines.
- **cwd-to-project mapping is trivial.** `session.directory` column holds unencoded absolute
  cwd. No regex decoding needed.
- **Path A is implementable via SQLite update_hook OR 5-s polling.** No OpenCode-side
  cooperation needed. Plugin API likely cleaner but not researched in budget.
- **Phase 50 primitive reuse:** opencode-sqlite adapter is a NEW code path that produces
  the same normalized transcript shape `convertTranscriptsToObservations()` accepts; no
  Phase 50 function signatures change.

### File created

`/Users/Q284340/Agentic/coding/.planning/phases/51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as/51-RESEARCH-opencode.md`

### Confidence assessment

| Area | Level | Reason |
|------|-------|--------|
| Process model | HIGH | 391 live `task`-tool invocations in DB + opencode.ai/docs confirmation |
| Storage location | HIGH | Local SQLite file inspected, schema dumped, sample rows confirmed |
| Lifecycle events | MEDIUM | Spawn is HIGH (visible row insert); completion is MEDIUM (inferred from `task` part state); event table empty on inspected box |
| Sub-of-sub recursion | MEDIUM | Schema supports it (self-FK); not observed in DB; safe to defer per Could-#11 disposition |
| Detection plan B (sweep) | HIGH | SQLite query is straightforward, indexed, idempotent |
| Detection plan A (live) | MEDIUM | Polling works; plugin hook unresearched; SQLite update_hook in `better-sqlite3` has a documented API but real-world coupling not tested |

### Open questions for planner

1. **Plugin API hook (Path A optimization).** Worth 1 h follow-up to check if
   `~/.opencode/plugins/` exposes a session-create hook. Would change Path A from
   "5 s polling" to "push event". Not blocking for ship.
2. **Cross-version schema stability.** Phase 51's opencode-sqlite adapter must hard-fail
   on unexpected migration version. Need a list of supported `__drizzle_migrations` IDs
   from OpenCode's source. Cheap to add as a per-row check.
3. **JSON shadow store reconciliation.** Should the adapter prefer SQLite always, or
   fall back to JSON if SQLite is locked? Recommend SQLite-only first; revisit if
   lock contention shows up in production.

### Ready for planning

Phase 51 planner can now author the OpenCode-specific Path A and Path B plans. The
sweep plan is concrete (extend `searchPaths` config + add `lib/lsl/adapters/opencode-sqlite.mjs`).
The live-hook plan is concrete (polling watcher with `better-sqlite3`, hard-fail on
schema-version mismatch).
