# Phase 19: Migration & Cleanup - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Legacy state management code is fully removed after validated parallel operation proves the new state machine is correct. This phase runs old and new paths side-by-side, validates equivalence, then removes all legacy code — leaving the codebase with exactly one state management path (the typed state machine from Phases 15-18).

</domain>

<decisions>
## Implementation Decisions

### Parallel validation strategy
- Snapshot comparison: old writeProgressFile writes to `workflow-progress-legacy.json`, new state machine subscriber writes to `workflow-progress.json` — compared post-run
- Dashboard consumes the new path (state machine/SSE events) during parallel operation — Phase 18 work is exercised immediately
- 3 successful workflow runs with no divergence required before cutover (covering debug mode, production, and cancel scenarios)
- On divergence detected: log to comparison file AND show a warning banner on the dashboard so it's visible immediately (non-blocking)

### Progress file format migration
- Migration window only — Zod preprocess transforms for old format are active during parallel validation, then removed after cutover
- After cutover, if a stale old-format progress file is found: delete it and start with idle state (no backup, no error)
- Legacy comparison file (`workflow-progress-legacy.json`) kept until manually deleted by user — no auto-cleanup
- Rollback strategy: git revert to pre-migration commit. No runtime toggle or environment variable — the 3-run validation window is the safety net

### Legacy code removal scope
- Staged removal in ordered commits:
  1. Coordinator: remove all ~30 `writeProgressFile` calls and the method itself
  2. Dashboard: remove 6+ LEGACY-tagged fields in ukbSlice, backward-compat sync in `setWorkflowState`, all dead selectors/actions/reducers/props
  3. Constants: delete @deprecated hardcoded step/substep fallback mappings (lines 367, 444) — YAML is sole source, no fallback
  4. Zod schemas: remove old-format `preprocess()`/`transform()` migration code
- Delete ALL dead code — unused selectors, actions, reducers, and component props that only existed for legacy fields
- YAML-only for step/substep definitions — if YAML isn't loaded, graph doesn't render (no hardcoded fallback)
- Add `schemaVersion: 2` field to progress file format after migration complete

### Claude's Discretion
- Exact comparison script implementation for snapshot diffing
- Dashboard warning banner styling and placement
- Order of writeProgressFile call site removal within coordinator
- How to verify each staged removal doesn't break the build

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `shared/workflow-types/` (Phase 15): WorkflowState union, Zod schemas with preprocess transforms — the migration transforms to remove are here
- `workflow-state-machine.ts` (Phase 16): State machine singleton with subscribe() — the "new path" that replaces writeProgressFile
- `SSEBroadcaster` (Phase 17): Subscriber that forwards state to dashboard — already wired
- `setWorkflowState` action (Phase 18): Redux action with backward-compat sync block — the sync block is removal target

### Established Patterns
- coordinator.ts has ~30 `writeProgressFile()` call sites spread across wave execution methods (lines 1847-3020)
- ukbSlice.ts has LEGACY-tagged fields: execution state (line 514), single-step mode (line 520), mock LLM (line 607), plus backward-compat sync at line 898
- constants.ts has @deprecated hardcoded mappings at lines 367 and 444 as YAML fallbacks

### Integration Points
- Progress file: `.data/workflow-progress.json` — currently written by both coordinator and state machine subscriber
- Dashboard WebSocket: receives STATE_SNAPSHOT from backend — already the primary data path
- Health API (tools.ts): queries `getState()` from singleton — already migrated in Phase 16

</code_context>

<specifics>
## Specific Ideas

- The 3 validation runs should cover different scenarios: one production run, one debug/mock run, one with mid-run cancel — this exercises all state transitions
- schemaVersion field enables future format changes without repeating the dual-format problem
- Coordinator writeProgressFile removal is the largest change (~30 call sites) — should be first because it's the most mechanical and easiest to verify

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-migration-cleanup*
*Context gathered: 2026-03-11*
