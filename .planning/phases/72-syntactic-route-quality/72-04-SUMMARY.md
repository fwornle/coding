---
phase: 72-syntactic-route-quality
plan: 04
subsystem: experiments
tags: [route-quality, route-event, route-reader, opencode, sqlite, dispatcher, tdd, zero-llm]
requires:
  - "lib/lsl/route/route-event.mjs (RouteEvent typedef + OUTCOMES + inputsDigest) — Plan 72-01"
  - "lib/lsl/route/claude-route-trace.mjs (buildClaudeRouteTrace) — Plan 72-03"
  - "lib/lsl/route/copilot-route-trace.mjs (buildCopilotRouteTrace) — Plan 72-03"
  - "lib/lsl/adapters/opencode-sqlite.mjs (isOwnedByMe/openReadonlyDb/checkSchemaVersion) — Phase 51"
provides:
  - "lib/lsl/route/opencode-route-trace.mjs — buildOpenCodeRouteTrace(dbPath, window) → RouteEvent[] (OpenCode part type:'tool' slice, read-only SQLite)"
  - "lib/lsl/route/build-trace.mjs — buildNormalizedTrace(span, { dominantAgent }) → RouteEvent[]|null (dominant-agent dispatch + span time-window + null-when-no-trace)"
  - "tests/experiments/route-build-trace.test.mjs — node:test OpenCode reader + dispatcher suite (8 tests)"
  - "tests/fixtures/route/opencode-part-sample.json — part.data fixture (2 completed, 1 error, 1 abandoned, 1 non-tool)"
  - "lib/lsl/adapters/opencode-sqlite.mjs now exports isOwnedByMe + openReadonlyDb (additive)"
affects:
  - "Plan 72-05 (measurement-stop / close orchestrator) calls buildNormalizedTrace(span, { dominantAgent }) to obtain RouteEvent[] before computeHeuristics"
tech-stack:
  added: []
  patterns:
    - "Reuse-not-reimplement: OpenCode reader reuses isOwnedByMe / openReadonlyDb / checkSchemaVersion VERBATIM from the Phase-51 opencode-sqlite adapter (exported the two private helpers; no logic copied)"
    - "Parse-all-then-filter to type:'tool' in JS — constant SQL string, no user-controlled interpolation (T-72-04-SQLI / V5)"
    - "epoch-ms → ISO via Number.isFinite(ms) ? new Date(ms).toISOString() : null (Pitfall 6 — mirrors opencode-sqlite.mjs:385-387)"
    - "Dispatcher null (no trace file) vs [] (file found, empty window) is the load-bearing D-02/Pitfall-4 distinction"
    - "Inclusive lexical ISO-8601 time-window predicate confirmed against scripts/backfill-task-id-by-timestamp.mjs:131-147 (Pitfall 7)"
    - "node:test + node:assert/strict (tests/experiments/ convention, NOT jest); throwaway own-uid sqlite seed + __seam injection for hermetic dispatcher tests"
key-files:
  created:
    - lib/lsl/route/opencode-route-trace.mjs
    - lib/lsl/route/build-trace.mjs
    - tests/experiments/route-build-trace.test.mjs
    - tests/fixtures/route/opencode-part-sample.json
  modified:
    - lib/lsl/adapters/opencode-sqlite.mjs
decisions:
  - "OpenCode outcome: status 'completed'→success, 'error'→error, 'pending'|'running' (no terminal)→abandoned; unrecognized status with a finite end time→error, without→abandoned"
  - "target_path: OpenCode state.input.file_path ?? null (Bash/non-file tools → null), matching the Claude/Copilot readers"
  - "Events sorted by started_at (nulls last), 0-based seq assigned post-sort; ORDER BY p.id ASC preserves encounter order for ties"
  - "Reused the Phase-51 helpers by EXPORTING isOwnedByMe/openReadonlyDb (additive export keywords) rather than duplicating the readonly+busy_timeout / uid-stat logic — single source of truth for the WAL-contention + access-control gates"
  - "Dispatcher locates only the OpenCode single-file db by default (env LSL_OPENCODE_DB → ~/.local/share/opencode/opencode.db); Claude/Copilot per-run session-file resolution is deferred to Plan 05, which passes the resolved path via the __seam hook — the dispatcher never guesses a session filename from task_id (threat model: no task_id-derived filenames)"
  - "Time-window is INCLUSIVE on both bounds (t >= span.started_at && t <= span.ended_at), lexical ISO-8601 — byte-for-byte the backfill sweep predicate (Pitfall 7 confirmed)"
metrics:
  duration: ~5 min
  completed: 2026-06-24
  tasks: 2
---

# Phase 72 Plan 04: OpenCode Route Reader + buildNormalizedTrace Dispatcher Summary

Read-only OpenCode SQLite `part`-table route reader plus the `buildNormalizedTrace` dominant-agent dispatcher that unifies all three Wave-2/3 readers behind one entry point, time-window-scopes the events (Pitfall 7), and honestly returns `null` (not `[]`) when no trace file is located (D-02/Pitfall 4).

## What Was Built

### Task 1 — `lib/lsl/route/opencode-route-trace.mjs` (commit `50d43b950`)
`buildOpenCodeRouteTrace(dbPath, window)` opens `opencode.db` read-only, runs a CONSTANT `SELECT ... FROM part ORDER BY p.id ASC`, parses each row's `data` JSON, and filters to `data.type === 'tool'` IN JS (no SQL interpolation — T-72-04-SQLI). Each tool part becomes a `RouteEvent`:
- `tool_call_id = data.callID`, `tool_name = data.tool`, `inputs_digest = inputsDigest(state.input)`, `target_path = state.input.file_path ?? null`, `agent = 'opencode'`
- `started_at`/`ended_at` = epoch-ms `state.time.{start,end}` → ISO-8601 via `Number.isFinite(ms) ? new Date(ms).toISOString() : null` (Pitfall 6)
- `outcome`: `completed`→success, `error`→error, `pending`/`running` (no terminal)→abandoned (ended_at=null)
- Reuses `isOwnedByMe` (non-owned → []), `openReadonlyDb` (`readonly:true` + `busy_timeout=5000`), `checkSchemaVersion` (column-presence guard) from the Phase-51 adapter; db closed in `finally` (WAL contention landmine #2).

Fixture `tests/fixtures/route/opencode-part-sample.json` carries 2 completed + 1 error + 1 abandoned tool parts and 1 non-tool (`type:'text'`) part to prove the JS filter.

### Task 2 — `lib/lsl/route/build-trace.mjs` (commit `44b1183c8`)
`async buildNormalizedTrace(span, { dominantAgent })`:
- Dispatches on `dominantAgent` → `buildClaudeRouteTrace` | `buildCopilotRouteTrace` | `buildOpenCodeRouteTrace`; unknown/missing agent → `null`.
- Locates the run's trace FILE (env-override → home-default contract reused from the Phase-51 adapters); **no file → `null`** (D-02/Pitfall 4).
- Applies the span time-window: keeps events with `started_at >= span.started_at && started_at <= span.ended_at`, INCLUSIVE, lexical ISO-8601 — confirmed against `scripts/backfill-task-id-by-timestamp.mjs:131-147`.
- File located but zero in-window events → `[]` (genuinely measured-empty, distinct from the no-file `null`).
- Test/orchestrator `__seam` injection hook keeps the dispatcher tests hermetic (no real `~/.claude`/`~/.copilot`/`~/.local/share/opencode` touched).

## Tests

`node --test tests/experiments/route-build-trace.test.mjs` → **8/8 green** (3 OpenCode reader + 5 dispatcher). OpenCode reader test seeds a throwaway own-uid sqlite db from the JSON fixture (minimal session/message/part schema matching `REQUIRED_SCHEMA_COLUMNS`). Plan-03 `tests/experiments/route-readers.test.mjs` re-run after the adapter export change → **6/6 green** (no regression).

## Pitfall 7 Confirmation (the in-task confirm)

`scripts/backfill-task-id-by-timestamp.mjs:131-147` uses `timestamp >= ? AND timestamp <= ?` (inclusive) with the comment "Lexical comparison on ISO-8601 UTC text is chronologically correct." `build-trace.mjs` replicates this exactly: `t >= lo && t <= hi`, both bounds inclusive, lexical ISO. The single biggest correctness risk is handled per the established join.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `isOwnedByMe` + `openReadonlyDb` from opencode-sqlite.mjs**
- **Found during:** Task 1
- **Issue:** The plan directs reuse of `isOwnedByMe` / `openReadonlyDb` from `lib/lsl/adapters/opencode-sqlite.mjs`, but both were module-private (not exported) — only `checkSchemaVersion` was. Duplicating the readonly+busy_timeout / uid-stat logic would violate the reuse-not-reimplement directive and create two sources of truth for the WAL-contention + access-control gates.
- **Fix:** Added the `export` keyword to both functions (additive only — no logic change), with a doc note pointing at the Plan 72-04 reuse. `adapter` and all prior exports verified intact via a direct `import()` probe.
- **Files modified:** `lib/lsl/adapters/opencode-sqlite.mjs`
- **Commit:** `50d43b950`

## Deferred Issues (out of scope)

- `tests/live-logging/adapter-opencode.test.js` fails to load under `node --test` with `SyntaxError: Named export 'jest' not found` — it is a jest suite (`import { jest } from '@jest/globals'`) and must be run via the jest runner, not `node --test`. This is a pre-existing harness mismatch unrelated to the additive export change (confirmed: the module imports cleanly and exposes the `adapter` object + all prior exports). Not fixed (out of scope — pre-existing, different test harness).

## Self-Check: PASSED

- FOUND: lib/lsl/route/opencode-route-trace.mjs
- FOUND: lib/lsl/route/build-trace.mjs
- FOUND: tests/experiments/route-build-trace.test.mjs
- FOUND: tests/fixtures/route/opencode-part-sample.json
- FOUND commit: 50d43b950 (Task 1)
- FOUND commit: 44b1183c8 (Task 2)
- 8/8 dispatcher+reader tests green; 6/6 Plan-03 reader tests green (no regression)
