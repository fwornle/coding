---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
plan: 01
subsystem: infra
tags: [phase-51, sub-agent, registry, sweep, infrastructure, lsl, adapter-loader, dispatcher]

# Dependency graph
requires:
  - phase: 50-lsl-grounded-async-observation-resolver-backfill-ambiguous-r
    provides: lib/lsl/window.mjs (getLSLWindow) + lib/lsl/scan-and-convert.mjs (scanTranscriptsForUnconverted, convertTranscriptsToObservations) — imported unchanged per D-Reuse
provides:
  - Agent-agnostic sub-agent registry (Map-backed in-process; SQLite persistence reserved as v2 follow-up)
  - Adapter loader contract for plans 51-02..51-09 (one file per agent in lib/lsl/adapters/)
  - Agent-agnostic sweep dispatcher CLI driving all four supported agents (claude/opencode/copilot/mastra)
  - Locked AGENTS 4-tuple (canonical order) + per-agent searchPaths config registry with env-var test hooks
  - D-LSL-Filename row schema (sub_hash, parent_sub_hash reserved for Could-#11 recursion)
affects: [51-02-claude-jsonl, 51-03-opencode-sqlite, 51-04-copilot-events, 51-05-mastra-ndjson, 51-06-lsl-writer, 51-07-claude-live, 51-08-opencode-live, 51-09-copilot-live, 51-10-statusline, 51-11-launchd-closure]

# Tech tracking
tech-stack:
  added: []  # T-51-01-SC: zero new package installs
  patterns:
    - "In-process Map-backed registry with secondary indexes (byAgent, byProject) for O(siblings) lookup"
    - "Dynamic ESM adapter loader via prefix-match (<agentId>-*.mjs) with stderr-on-missing (no throw)"
    - "Per-agent searchPaths shape divergence: Array<string> for filesystem agents, Array<{type:'sqlite', dbPath}> for opencode"
    - "Sweep dispatcher composes registry + adapter without reaching into Phase 50 primitives"
    - "TDD per-task RED → GREEN with separate atomic commits (4 commits across 2 tasks)"

key-files:
  created:
    - lib/lsl/registry.mjs (215 lines, 2 exports — createRegistry + Registry)
    - lib/lsl/adapters/index.mjs (149 lines, 3 exports — AGENTS, loadAdapter, getAgentSearchPaths)
    - lib/lsl/adapters/README.md (118 lines, contract reference for 51-02..51-09)
    - scripts/sweep-sub-agents.mjs (222 lines, CLI driving all four agents)
    - tests/live-logging/sub-agent-registry.test.js (241 lines, 12 tests)
    - tests/live-logging/sweep-sub-agents-dispatcher.test.js (263 lines, 7 tests)
  modified: []  # D-Reuse: Phase 50 primitives untouched (git diff --stat clean)

key-decisions:
  - "In-process Map-backed registry per Claude's Discretion bullet 1 — SQLite reserved for v2 follow-up since sweep runs are short-lived and re-discover from disk on every invocation (does not affect correctness)"
  - "Dispatcher does NOT directly call Phase 50's convertTranscriptsToObservations — each adapter is the boundary that composes its own discover() + Phase 50 internally. Keeps the dispatcher Phase-50-agnostic AND lets opencode plug in without forcing a shape change on the primitive"
  - "Per-agent searchPaths shape divergence locked here (Array<string> vs Array<{type:'sqlite',dbPath}>). Plan 51-03's opencode adapter consumes the sqlite-shaped entry; the other three plans walk filesystem trees"
  - "loadAdapter returns null + stderr notice on missing adapter file (NOT throw) — one missing adapter must not abort the whole sweep"
  - "Exit-code matrix: 0 if any adapter succeeded (or completed --dry-run cleanly); 2 if all four were missing OR all four threw"
  - "discovered_at is immutable post-insert — upsert mutates fields but never overwrites the original discovery timestamp"
  - "AGENTS array is Object.freeze()'d — downstream callers cannot quietly mutate the canonical 4-tuple"

patterns-established:
  - "lib/lsl/<category>/ plain ESM modules per Phase 50 D-Primitives convention (extended here from scan-and-convert / window to registry / adapters/)"
  - "Adapter contract pattern — single named `adapter` export with { agentId, storageType, discover(), convertToObservations() }; downstream plans 51-02..51-05 each ship one new file matching this shape"
  - "LSL_<AGENT>_<RESOURCE>_DIR env-var override pattern for per-agent paths in tests + ops (LSL_CLAUDE_PROJECTS_DIR, LSL_OPENCODE_DB, LSL_COPILOT_SESSIONS_DIR, LSL_MASTRA_TRANSCRIPTS_DIR, plus LSL_ADAPTERS_DIR for the loader itself)"
  - "Sweep dispatcher tested via child_process.spawn + sidecar-JSON-recording fixture adapters (extends Plan 50-03's spawn-based integration test pattern to the CLI surface)"

requirements-completed: []  # Phase 51 is an out-of-milestone bug-fix; no roadmap requirement IDs registered (matches plan frontmatter)

# Metrics
duration: ~22min
completed: 2026-05-26
---

# Phase 51 Plan 01: Sub-Agent Registry + Adapter Loader + Sweep Dispatcher Summary

**Agent-agnostic in-process Map-backed sub-agent registry + adapter-loader contract + sweep dispatcher CLI — locks the interface every Phase 51 Wave 2-6 plan builds against, with Phase 50 primitives imported unchanged (D-Reuse cumulative gate green).**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-05-26T16:04:33Z (approx — first commit `455de723e` at 16:13Z worktree clock; agent spawn was earlier)
- **Completed:** 2026-05-26T16:26:40Z
- **Tasks:** 2 (both TDD: RED + GREEN per task)
- **Files created:** 6 (3 production + 1 README + 2 test suites)
- **Files modified:** 0 (Phase 50 primitives untouched per D-Reuse)

## Accomplishments

- **Registry shape locked** for every Phase 51 downstream plan: `{ agent, sub_hash, parent_session_id, sub_index, transcript_path, project, status, detected_via, discovered_at, completed_at, observations_written, parent_sub_hash, error, agent_metadata }`. Map-backed with two secondary indexes (byAgent, byProject) for O(siblings) lookup. 7 public methods: upsert / get / listByAgent / listByProject / markCompleted / size / clear.
- **Adapter contract locked** as a single `adapter` named export with `{ agentId, storageType, discover(opts), convertToObservations(rows, opts) }`. Plans 51-02 (claude-jsonl) / 51-03 (opencode-sqlite) / 51-04 (copilot-events) / 51-05 (mastra-ndjson) each ship one new file under `lib/lsl/adapters/`.
- **Dispatcher CLI** drives all four agents in canonical AGENTS order with --agent / --since / --dry-run / --project / --limit flags. Missing adapter → stderr notice + continue (no abort). Per-agent errors caught + stderr-logged + sweep continues. Exit 0 if any agent succeeded; exit 2 if all four missing or all four threw.
- **19 new tests** across 2 suites: 12 registry/loader unit tests + 7 dispatcher integration tests (via child_process.spawn against fixture adapters in tmpdir-overridden LSL_ADAPTERS_DIR). All pass under `NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest`.
- **Phase 50 47-test regression suite stays green** post-implementation. D-Reuse cumulative gate enforced: `git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` returns 0 modified files.
- **Zero new package installs** (T-51-01-SC mitigation satisfied; `git diff package.json` clean).

## Task Commits

Each task was committed atomically as a RED → GREEN pair:

1. **Task 1 RED: failing registry + adapter tests** — `455de723e` (test)
2. **Task 1 GREEN: implement registry + adapter loader + README** — `3cb4fc64e` (feat)
3. **Task 2 RED: failing dispatcher tests** — `57604a5af` (test)
4. **Task 2 GREEN: implement sweep dispatcher CLI** — `e3dfa0a23` (feat)

**Plan metadata:** committed via this SUMMARY (worktree mode — STATE.md / ROADMAP.md owned by orchestrator after merge).

## Files Created/Modified

### Production code

- `lib/lsl/registry.mjs` (215 lines) — In-process Map-backed Registry class + createRegistry factory. Composite key `${agent}:${sub_hash}`; immutable discovered_at; status defaults to 'discovered' on first insert; subsequent upserts preserve existing status unless caller explicitly sets one; markCompleted sets terminal status (completed or failed-with-error).
- `lib/lsl/adapters/index.mjs` (149 lines) — `AGENTS = Object.freeze(['claude','opencode','copilot','mastra'])`, `loadAdapter(agentId)` dynamic-import resolver with stderr-on-missing, `getAgentSearchPaths(agentId)` per-agent config with env-var test hooks. LSL_ADAPTERS_DIR overrides the lookup directory for tests; per-agent LSL_*_DIR / LSL_*_DB env vars override the per-agent paths.
- `lib/lsl/adapters/README.md` (118 lines) — Adapter contract reference. Documents file naming (`<agentId>-<storageType>.mjs`), locked module shape, error semantics, T-51-FI uid-check gate that downstream plans implement, env-var override matrix, and forward references to the seven plans that build against this contract.
- `scripts/sweep-sub-agents.mjs` (222 lines) — Agent-agnostic Path-B sweep dispatcher CLI. Composes registry + adapter loader; per-agent discover() then optional convertToObservations(); --limit slices oldest-first when cap hit (T-51-01-DR mitigation); --dry-run + --agent + --project + --since + --limit flag set. Default project is 'coding'; default limit is 100. Inline `tag: 'sub-agent-backfill'` literal (D-Live-Sweep-Tags; grep gate matches exactly once).

### Tests

- `tests/live-logging/sub-agent-registry.test.js` (241 lines, 12 tests) — Covers all 7 methods + idempotency + listByAgent/Project filters + markCompleted-completed/failed semantics. Adapter loader tests cover the AGENTS frozen 4-tuple, loadAdapter null-when-missing + stderr-notice, loadAdapter with fixture present, getAgentSearchPaths(claude) string-shape + LSL_CLAUDE_PROJECTS_DIR override, getAgentSearchPaths(opencode) sqlite-object-shape divergence.
- `tests/live-logging/sweep-sub-agents-dispatcher.test.js` (263 lines, 7 tests) — child_process.spawn-based integration tests against fixture adapters that record calls into sidecar JSONs. Covers --help flag set, four-agent AGENTS-order dispatch, --agent single-agent filter, --dry-run discover-only behavior, missing-adapter exit-code matrix (any-succeed=0, all-missing=2), idempotency (no per-run call duplication), and --project flag forwarding to adapter.discover().

## Locked Interfaces (for downstream plans)

### Registry row schema (Plan 51-02..51-09 build against)

```javascript
{
  agent: 'claude'|'opencode'|'copilot'|'mastra',
  sub_hash: string,            // 7-char prefix per D-LSL-Filename
  parent_session_id: string,
  sub_index: number|null,      // 1-based; may be null until siblings observed
  transcript_path: string,     // file path OR 'sqlite:<dbPath>#<sessionId>' opaque URI
  project: string,             // e.g. 'coding'
  status: 'discovered'|'running'|'completed'|'failed',
  detected_via: 'sweep'|'fs-watch'|'sqlite-poll'|'event-tail',
  discovered_at: ISO string,   // immutable post-insert
  completed_at: ISO string|null,
  observations_written: number,
  parent_sub_hash: string|null,  // reserved per D-LSL-Filename Could-#11; defer population
  error: string|null,
  agent_metadata: object       // per-agent free-form
}
```

### Adapter contract (Plan 51-02..51-05 each ship one new file)

```javascript
export const adapter = {
  agentId: 'claude'|'opencode'|'copilot'|'mastra',
  storageType: 'jsonl-tree'|'sqlite'|'events-jsonl'|'ndjson',
  async discover({ searchPaths, project, since }) { /* per-agent logic */ },
  async convertToObservations(rows, { dryRun, tag }) { /* per-agent logic */ },
};
```

Plans 51-07/08/09 (live tier) add a third method `subscribeLive(callback)` as an additive extension — the schema above remains unchanged.

## Decisions Made

- **Registry storage** — chose in-process Map per CONTEXT.md "Claude's Discretion" bullet 1. Rationale: sweep runs are short-lived (≤ 5 min); each run re-discovers from disk; persistence to SQLite is reserved for v2 once we observe an operational need (e.g. cross-run live-tier state). Documented in module header comment.
- **Dispatcher does not call Phase 50 directly** — adapter is the composition boundary. Each adapter internally calls `convertTranscriptsToObservations` (claude/copilot/mastra) or a different conversion path (opencode SQLite). The dispatcher imports the Phase 50 primitive only to keep the dependency edge visible per the plan's `key_links` contract, but does not invoke it. This keeps the dispatcher Phase-50-agnostic and lets opencode plug in without a primitive shape change.
- **Adapter file naming** — `<agentId>-<storageType>.mjs` with the loader doing a prefix-match for `<agentId>-*.mjs`. This lets each downstream plan pick a tag that fits its underlying storage without forcing the loader to parse it.
- **getAgentSearchPaths shape divergence** — opencode returns `Array<{type:'sqlite', dbPath}>` while the other three return `Array<string>`. Documented as intentional in the adapter README; Plan 51-03 consumes the object form.
- **Exit-code semantics** — 0 when any agent succeeded (so a partial 2-of-4 install still passes CI/launchd); 2 only when all four are missing OR all four threw. Per-agent failures stderr-logged but never escalate.
- **--limit slicing** — when a per-agent discover() returns more than --limit rows, we slice from the FRONT (oldest first). Adapters are expected to sort oldest-first; this is documented in the adapter README under "Filesystem safety".

## Phase 50 D-Reuse Status (cumulative gate)

```
$ git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs
(empty output — D-Reuse honored)
```

Phase 50's 47-test regression suite (5 suites — lsl-window, scan-and-convert, resolve-observations-from-lsl, ObservationWriter.prior-context-lsl, ObservationWriter.needs-lsl-resolution) still passes verbatim after Plan 51-01.

## Test Count + Pass Status

| Suite | Tests | Status |
|---|---|---|
| tests/live-logging/sub-agent-registry.test.js | 12 | passed |
| tests/live-logging/sweep-sub-agents-dispatcher.test.js | 7 | passed |
| **Phase 51 Plan 01 total** | **19** | **passed** |
| Phase 50 regression (lsl-window + scan-and-convert + resolve-observations-from-lsl + ObservationWriter.prior-context-lsl + ObservationWriter.needs-lsl-resolution) | 47 | passed |

Run command:
```bash
NODE_OPTIONS='--experimental-vm-modules --no-warnings' npx jest \
  tests/live-logging/sub-agent-registry.test.js \
  tests/live-logging/sweep-sub-agents-dispatcher.test.js \
  --no-coverage
# Test Suites: 2 passed, 2 total
# Tests:       19 passed, 19 total
```

## Deviations from Plan

None — plan executed exactly as written. All 12 + 7 = 19 tests pass; all acceptance grep gates satisfied:

- `grep -c "export " lib/lsl/registry.mjs` = 2 (>= 2 ✓)
- `grep -E "^export " lib/lsl/adapters/index.mjs` = 3 exported symbols (AGENTS, loadAdapter, getAgentSearchPaths — `>= 3` per plan, satisfied)
- Strict-regex `grep -E "^(import|export) .*(window\.mjs|scan-and-convert\.mjs)" lib/lsl/registry.mjs lib/lsl/adapters/index.mjs` returns 0 lines (matches in initial loose-regex grep were JSDoc comment text only; no real imports/exports of Phase 50 primitives in either module)
- `git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` returns 0 files changed (D-Reuse honored)
- `grep -c "console\." lib/lsl/registry.mjs lib/lsl/adapters/index.mjs scripts/sweep-sub-agents.mjs` = 0 (CLAUDE.md no-console-log)
- `grep -F "tag: 'sub-agent-backfill'" scripts/sweep-sub-agents.mjs` returns 1 line (D-Live-Sweep-Tags inlined; initial implementation used SOURCE_TAG constant which would have returned 0, replaced with inline literal during verification — this is a self-correction during the same task, not a Rule-1 deviation since the constant version was never committed standalone)
- Two RED+GREEN commit pairs visible: `test(51-01):` + `feat(51-01):` for each task → 4 commits total for the plan (matches plan acceptance criteria 4-commit topology)

## Issues Encountered

None — plan was well-scoped; tests passed on first GREEN attempt for both tasks. The only minor self-correction was inlining the `'sub-agent-backfill'` tag literal (replacing a `SOURCE_TAG` constant) so the plan's `grep -F "tag: 'sub-agent-backfill'"` gate returned exactly 1 line as specified. Made during the same task, not a separate fix-up commit.

## User Setup Required

None — no external service configuration required. The dispatcher runs with no env vars set (uses defaults for all four agents); launchd wiring is Plan 51-11's scope.

## Next Phase Readiness

**Wave 2 plans (51-02 through 51-05) can begin in parallel.** The locked surface is:

- Registry shape — `lib/lsl/registry.mjs` exports `createRegistry()` returning a Registry with the 7 methods above
- Adapter loader — `lib/lsl/adapters/index.mjs` exports `AGENTS`, `loadAdapter(agentId)`, `getAgentSearchPaths(agentId)`
- Adapter contract — documented in `lib/lsl/adapters/README.md`; each Wave 2 plan ships exactly one new file under `lib/lsl/adapters/` matching the locked module shape

**Wave 1 cumulative gates green:**

- D-Reuse: Phase 50 primitives untouched, 47-test regression suite still green
- T-51-01-SC: zero new package installs
- T-51-01-DR: --limit caps per-agent rows at 100 default (slice from front of list)
- T-51-01-FI: registry/loader never read transcript content from disk — they only resolve paths; downstream adapters implement the `fs.statSync().uid === process.getuid()` gate
- T-51-01-RL: dispatcher passes `tag: 'sub-agent-backfill'` to every convert() call; adapters fill per-row metadata (parent_session_id / sub_index / sub_hash / agent / project)

**No blockers, no concerns** — Plan 51-02 (claude-jsonl), 51-03 (opencode-sqlite), 51-04 (copilot-events), 51-05 (mastra-ndjson) can dispatch immediately under `/gsd-execute-phase 51` Wave 2.

## Self-Check: PASSED

Created files exist (verified):
- `lib/lsl/registry.mjs` ✓
- `lib/lsl/adapters/index.mjs` ✓
- `lib/lsl/adapters/README.md` ✓
- `scripts/sweep-sub-agents.mjs` ✓
- `tests/live-logging/sub-agent-registry.test.js` ✓
- `tests/live-logging/sweep-sub-agents-dispatcher.test.js` ✓

Commits exist (verified via `git log --oneline 8fe34c380..HEAD`):
- `455de723e` ✓ (Task 1 RED)
- `3cb4fc64e` ✓ (Task 1 GREEN)
- `57604a5af` ✓ (Task 2 RED)
- `e3dfa0a23` ✓ (Task 2 GREEN)

Test runs (verified):
- Phase 51 Plan 01: 19/19 passed ✓
- Phase 50 regression: 47/47 passed ✓

D-Reuse cumulative gate (verified):
- `git diff --stat lib/lsl/window.mjs lib/lsl/scan-and-convert.mjs` returns 0 lines ✓

---

*Phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as*
*Completed: 2026-05-26*
