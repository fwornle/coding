---
phase: 69-claude-copilot-token-adapters
plan: 06
subsystem: lsl-token-adapters
tags: [copilot, token-usage, live-tail, sweep, best-effort, task-id, D-08, D-03]
requires:
  - "lib/lsl/token/copilot-token-rows.mjs (Plan 69-04 — buildCopilotTokenRows, checkCopilotVocabulary, warnOnVersionDrift)"
  - "lib/lsl/token/token-db.mjs (Plan 69-02 — openTokenDb, insertTokenRow, ADAPTER_USER_HASH_COPILOT)"
  - "lib/lsl/token/task-id.mjs (Plan 69-02 — resolveLiveTaskIdSafe)"
  - "scripts/backfill-task-id-by-timestamp.mjs (runSweep, loadArchivedSpans — reused, D-03)"
  - "scripts/sweep-sub-agents.mjs Claude branch (Plan 69-05)"
provides:
  - "Copilot live session.shutdown per-session-aggregate token-row emission (stamped live task_id)"
  - "Copilot completed-session sweep emission + reused timestamp-join task_id backfill"
  - "Cross-adapter D-08 best-effort failure-isolation gate (best-effort.test.js)"
affects:
  - "lib/lsl/live/copilot-events-tail.mjs"
  - "scripts/sub-agent-live-copilot.mjs"
  - "scripts/sweep-sub-agents.mjs"
tech-stack:
  added: []
  patterns:
    - "Isolated session.shutdown branch in the per-line tail listener; token failures route to a dedicated stderr line, never the subagent onError path (D-08)"
    - "Guarded dynamic-import of token modules in the supervisor (so --help works without SQLite)"
    - "Reused runSweep + loadArchivedSpans single timestamp-join covers both adapters via WHERE task_id='' (D-03)"
    - "Parameterized (user_hash, tool_call_id) dedup probe; Copilot natural key = session-uuid + model"
key-files:
  created:
    - "tests/token-adapters/copilot-wiring.test.js"
    - "tests/token-adapters/best-effort.test.js"
  modified:
    - "lib/lsl/live/copilot-events-tail.mjs"
    - "scripts/sub-agent-live-copilot.mjs"
    - "scripts/sweep-sub-agents.mjs"
decisions:
  - "session.shutdown is detected via a raw JSON.parse discriminator (parseCopilot returns null for lifecycle events) — mirrors copilot-token-rows.mjs"
  - "onTokenRow receives {eventsPath, event}; the supervisor builds rows from eventsPath via buildCopilotTokenRows (mirrors the Claude onTokenRow({fullPath}) analog)"
  - "Copilot sweep backfill re-runs the same idempotent runSweep join; safe because WHERE task_id='' never clobbers a live-stamped value"
metrics:
  duration_min: 4
  completed: 2026-06-22
  tasks: 2
  files: 5
---

# Phase 69 Plan 06: Copilot Token-Row Wiring (Live + Sweep) Summary

Wired the Copilot per-session-aggregate token-row layer (Plans 02, 04) into the running Phase-51 live/sweep infrastructure: a live `session.shutdown` emission point in the events tail stamped with the live task_id, and a completed-session sweep emission that reuses the locked timestamp-join backfill — both fully best-effort, certified by a single cross-adapter no-throw gate.

## What Was Built

### Task 1 — live `session.shutdown` branch + supervisor wiring (commit c5853b412)
- **`lib/lsl/live/copilot-events-tail.mjs`**: added an OPTIONAL `cfg.onTokenRow({ eventsPath, event })` hook to `tailEventsFile`, fired on a `session.shutdown` line. `parseCopilot` returns null for lifecycle events, so the discriminator is a raw `JSON.parse` of the line (mirrors `copilot-token-rows.mjs`). The hook is wrapped in the same `Promise.resolve(...).catch(...)` isolation pattern as the subagent dispatch, BUT token-write failures route to a dedicated `[copilot-events-tail] onTokenRow threw (non-fatal): <msg>` stderr line — **NOT** the subagent `onError` path (D-08 failure isolation). `startCopilotWatcher` now accepts and threads `onTokenRow` into the per-session `tailEventsFile` call.
- **`scripts/sub-agent-live-copilot.mjs`**: mirrored the Plan 69-05 Claude supervisor wiring — guarded dynamic-import of `copilot-token-rows.mjs` + `token-db.mjs` + `task-id.mjs` (so `--help` still works without better-sqlite3), opened a second-writer token-db handle against `.data/llm-proxy/token-usage.db`, defined `onTokenRow({ eventsPath })` that builds per-session-aggregate rows via `buildCopilotTokenRows`, stamps each `task_id = await resolveLiveTaskIdSafe()` + `user_hash = ADAPTER_USER_HASH_COPILOT`, and inserts each inside try/catch. A one-time `warnOnVersionDrift` (keyed on `COPILOT_CLI_VERSION` env) runs at startup; `checkCopilotVocabulary` is imported and available for an opt-in startup probe (D-04/D-09). The token-db handle is closed best-effort on shutdown.
- **`tests/token-adapters/copilot-wiring.test.js`**: with a stub dist exporting `resolveLiveTaskId: () => 'task-cop-1'`, the Wave-0 fixture's `session.shutdown` (two models) yields two `per-session-aggregate` rows carrying `task_id==='task-cop-1'`, `user_hash==='copadt'`, `granularity_tier==='per-session-aggregate'`; with the stub returning `''`, both rows carry `task_id===''`.

### Task 2 — Copilot sweep emission + reused backfill + best-effort gate (commit dddc8e04f)
- **`scripts/sweep-sub-agents.mjs`**: added `emitCopilotCompletedSessionTokenRows(discovered)` alongside the Claude branch. For each completed Copilot `events.jsonl` (discovered row `transcript_path`) it builds aggregate rows, sets `user_hash=ADAPTER_USER_HASH_COPILOT` + `task_id=''`, dedups against live-captured rows on `(user_hash, tool_call_id)` via a parameterized `SELECT 1 ... LIMIT 1` (Copilot natural key = session-uuid + model, carried as `tool_call_id=model`), and inserts each. It then REUSES the SAME `runSweep` + `loadArchivedSpans` import already wired by Plan 05 (D-03) — the single `WHERE task_id=''` join stamps both adapters' completed-session rows. The whole helper is best-effort try/catch and is invoked in the sweep loop for `agentId==='copilot'`.
- **`tests/token-adapters/best-effort.test.js`**: the cross-adapter D-08 failure-isolation gate (ROADMAP/VALIDATION final task). Four no-throw assertions: (a) `buildClaudeTokenRows` over a malformed JSONL line skips it and returns good rows; (b) `buildCopilotTokenRows` over a malformed events line does the same (two aggregate rows survive); (c) `insertTokenRow` against a closed db returns `false` without throwing; (d) `resolveLiveTaskIdSafe` against a broken dist path returns `''` without throwing.

## Verification

| Check | Result |
|-------|--------|
| `npx jest tests/token-adapters/copilot-wiring.test.js` | PASS (2/2) |
| `npx jest tests/token-adapters/best-effort.test.js` | PASS (4/4) |
| `npx jest tests/token-adapters/` (whole suite) | PASS (11 suites / 39 tests) |
| `grep -c "session.shutdown" lib/lsl/live/copilot-events-tail.mjs` | 5 (≥1) |
| `grep -c "onTokenRow" scripts/sub-agent-live-copilot.mjs` | 4 (≥1) |
| `grep -c "resolveLiveTaskIdSafe" scripts/sub-agent-live-copilot.mjs` | 3 (≥1) |
| onTokenRow catch routes to dedicated stderr, NOT subagent onError | confirmed |
| `grep -E "runSweep\|loadArchivedSpans" scripts/sweep-sub-agents.mjs` | matches (reused) |
| `grep -c "ADAPTER_USER_HASH_COPILOT" scripts/sweep-sub-agents.mjs` | 3 (≥1) |
| No `.plist` modified | confirmed (git status clean of plist) |
| `node --check` on both scripts + events-tail | OK |
| `--help` works without SQLite (guarded import) | OK |

## Reload Step (no plist change — D-08 additive hooks)

The live supervisor edits are additive; no launchd plist changed. Reload the running daemon with:

```bash
launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-copilot
```

The sweep edit rides inside `sweep-sub-agents.mjs` (additive), so `sub-agent-sweep-job.sh` needs no change.

## Deviations from Plan

None — plan executed exactly as written. The `onTokenRow({ eventsPath, event })` signature (the supervisor builds rows from `eventsPath` rather than re-deriving from the in-line `event`) matches the locked Claude analog `onTokenRow({ fullPath })` from Plan 69-05 and is the path the plan's `copilot-wiring.test.js` exercises.

## Known Stubs

None. Both code paths are wired end-to-end to live contracts; no placeholder/empty-data flows.

## Self-Check: PASSED

- FOUND: lib/lsl/live/copilot-events-tail.mjs
- FOUND: scripts/sub-agent-live-copilot.mjs
- FOUND: scripts/sweep-sub-agents.mjs
- FOUND: tests/token-adapters/copilot-wiring.test.js
- FOUND: tests/token-adapters/best-effort.test.js
- FOUND commit: c5853b412 (Task 1)
- FOUND commit: dddc8e04f (Task 2)
