# lib/lsl/adapters/ — agent-agnostic sub-agent adapter contract

Phase 51 Plan 01 (Task 1) locks the per-agent adapter interface that downstream
plans 51-02 through 51-05 each implement as a single new file in this directory.

## File naming

```
lib/lsl/adapters/<agentId>-<storageType>.mjs
```

- `<agentId>` — one of `claude`, `opencode`, `copilot`, `mastra` (see
  `AGENTS` export in `./index.mjs` — frozen 4-tuple, canonical order).
- `<storageType>` — short tag for the underlying storage shape, e.g.
  `jsonl` (claude), `sqlite` (opencode), `events` (copilot), `ndjson` (mastra).
  Used only for filename disambiguation; not parsed by the loader.

The dispatcher (`scripts/sweep-sub-agents.mjs`) resolves the per-agent file via
prefix match (`<agentId>-*.mjs`) — so each plan can pick whatever storage tag
fits its underlying transcript layout.

## Locked module shape

Each adapter MUST export an `adapter` named export with this exact shape:

```javascript
export const adapter = {
  agentId: 'claude' | 'opencode' | 'copilot' | 'mastra',
  storageType: 'jsonl-tree' | 'sqlite' | 'events-jsonl' | 'ndjson',

  /**
   * Discover sub-agent transcripts/sessions for this agent.
   *
   * @param {object} opts
   * @param {Array<string> | Array<{type:'sqlite', dbPath:string}>} opts.searchPaths
   *        Per-agent config from getAgentSearchPaths(agentId).
   * @param {string} [opts.project]   Project filter ('coding' is the only Phase 51 scope).
   * @param {string} [opts.since]     ISO timestamp filter; skip rows older than this.
   * @returns {Promise<Array<RegistryRow>>}
   *        Rows shaped for registry.upsert():
   *          { agent, sub_hash, parent_session_id, transcript_path,
   *            project, agent_metadata, sub_index?, parent_sub_hash? }
   */
  async discover({ searchPaths, project, since }) { /* per-agent logic */ },

  /**
   * Convert discovered rows to observations via Phase 50 primitive
   * (lib/lsl/scan-and-convert.mjs convertTranscriptsToObservations).
   *
   * Plan 51-06 builds the LSL writer; the observation tier is what this
   * method targets in Wave 2.
   *
   * @param {Array<RegistryRow>} rows
   * @param {object} opts
   * @param {boolean} [opts.dryRun=false]
   * @param {string}  [opts.tag='sub-agent-backfill']  metadata.source tag
   * @returns {Promise<Array<{ sub_hash, observations_written, skipped, error }>>}
   *        One result per row. The dispatcher maps these into
   *        registry.markCompleted(agent, sub_hash, {...}).
   */
  async convertToObservations(rows, { dryRun, tag }) { /* per-agent logic */ },
};
```

## Error semantics

- `discover()` MUST NOT throw on per-file errors — log to `process.stderr.write`
  and continue. Throwing aborts the whole sweep for this agent (the dispatcher
  catches it and continues to the next agent, but that adapter's rows are lost
  for the run).
- `convertToObservations()` MAY throw on per-row errors; the dispatcher
  wraps each adapter call in try/catch and stamps `markCompleted(..., {error})`
  per row.

## Filesystem safety (T-51-FI mitigation)

When `discover()` reads transcripts from disk, each plan applies the uid-check
gate before opening the file:

```javascript
const st = fs.statSync(file);
if (st.uid !== process.getuid()) {
  process.stderr.write(`[<agent>-adapter] skip non-owner file: ${file}\n`);
  continue;
}
```

The registry (and the adapter loader index) themselves do NOT touch disk for
transcript content — they only resolve directories.

## Test override

Set `LSL_ADAPTERS_DIR` to point at a fixture directory containing
`<agentId>-*.mjs` test files. `loadAdapter()` then resolves from that override
instead of the production directory. See
`tests/live-logging/sub-agent-registry.test.js` Test 10 for the canonical
fixture pattern.

## Per-agent searchPaths env overrides

| Agent      | Env var                       | Default                                   |
|------------|-------------------------------|-------------------------------------------|
| `claude`   | `LSL_CLAUDE_PROJECTS_DIR`     | `~/.claude/projects/`                     |
| `opencode` | `LSL_OPENCODE_DB`             | `~/.local/share/opencode/opencode.db`     |
| `copilot`  | `LSL_COPILOT_SESSIONS_DIR`    | `~/.copilot/session-state/`               |
| `mastra`   | `LSL_MASTRA_TRANSCRIPTS_DIR`  | `.observations/transcripts/` (project-local) |

## Plans that build against this contract

- Plan 51-02 — `claude-jsonl.mjs` (Path B sweep adapter)
- Plan 51-03 — `opencode-sqlite.mjs` (Path B sweep adapter)
- Plan 51-04 — `copilot-events.mjs` (Path B sweep adapter)
- Plan 51-05 — `mastra-ndjson.mjs` (Path B sweep adapter)
- Plans 51-07 / 51-08 / 51-09 — live-tier hooks for claude/opencode/copilot
  (mastra excluded — Path A not viable per RESEARCH-mastra.md). These reuse
  the same `adapter` export shape and add a third method
  `subscribeLive(callback)` returning an unsubscribe function. The locked
  schema above remains unchanged; the live methods are an additive extension.
