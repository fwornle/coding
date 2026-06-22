---
phase: 69-claude-copilot-token-adapters
plan: 05
subsystem: lsl-token-adapters
tags: [claude, token-usage, live-tail, sweep, task-id, dedup, telemetry]
requires:
  - "69-02: openTokenDb / insertTokenRow / ADAPTER_USER_HASH_CLAUDE / resolveLiveTaskIdSafe"
  - "69-03: buildClaudeTokenRows (per-turn + per-reasoning-step extraction)"
  - "68-03: backfill-task-id-by-timestamp.mjs runSweep + loadArchivedSpans (locked timestamp-join)"
provides:
  - "Live-tail Claude token-row emission stamped with the live task_id (additive onTokenRow hook)"
  - "Completed-session Claude token-row emission + reused timestamp-join backfill"
  - "Live/sweep dedup on (user_hash, tool_call_id) (Pitfall 4)"
affects:
  - "lib/lsl/live/claude-fs-watch.mjs"
  - "scripts/sub-agent-live-claude.mjs"
  - "scripts/sweep-sub-agents.mjs"
  - "scripts/backfill-task-id-by-timestamp.mjs"
tech-stack:
  added: []
  patterns:
    - "Additive, fully-isolated onTokenRow hook (failure never reaches onError / error budget)"
    - "Guarded dynamic-import of token modules (--help works without SQLite)"
    - "Reuse the locked timestamp-join via module export (no re-implementation)"
    - "import.meta entry-point guard so a reusable CLI module has no import side-effects"
key-files:
  created:
    - "tests/token-adapters/claude-taskid.test.js"
    - "tests/token-adapters/dedup.test.js"
  modified:
    - "lib/lsl/live/claude-fs-watch.mjs"
    - "scripts/sub-agent-live-claude.mjs"
    - "scripts/sweep-sub-agents.mjs"
    - "scripts/backfill-task-id-by-timestamp.mjs"
decisions:
  - "Live onTokenRow receives { fullPath, exchange }; the supervisor builds rows from fullPath (buildClaudeTokenRows reads the file) rather than from the paired exchange — the exchange is text-flattened and lacks the raw usage block."
  - "runSweep + loadArchivedSpans exported from backfill-task-id-by-timestamp.mjs and gated behind an import.meta entry-point guard so reuse (D-03) does not run the CLI main() on import."
  - "Sweep token emission is gated to agentId==='claude' inside the existing per-agent convert loop; sub-agent-sweep-job.sh needs no edit (additive in the .mjs, per PATTERNS)."
metrics:
  tasks: 2
  files_created: 2
  files_modified: 4
  tests_added: 7
  completed: 2026-06-22
---

# Phase 69 Plan 05: Wire Claude Token-Row Layer (live-tail + sweep) Summary

Wired the Wave-1/2 Claude token-row layer into the running Phase-51 infrastructure: an additive, fully-isolated `onTokenRow` hook on the live watcher emits per-turn + per-reasoning-step rows stamped with the live `task_id`; the sub-agent sweep emits completed-session rows (dedup'd live-vs-sweep on `requestId`) then reuses the locked timestamp-join to backfill their `task_id`. All token writes are best-effort so an emission failure can never crash the LSL observation path (D-08).

## What Was Built

### Task 1 — Additive `onTokenRow` hook in the live watcher + supervisor wiring (commit 45c86a9e2)

- **`lib/lsl/live/claude-fs-watch.mjs`**: added an OPTIONAL `opts.onTokenRow({ fullPath, exchange })` invoked alongside the existing `observationWriter.processMessages(...)` in the tail's `onMessage` callback. It is wrapped in ITS OWN `try/catch` that writes a `[claude-fs-watch] onTokenRow threw (non-fatal)` stderr line and continues — it DELIBERATELY does NOT call `opts.onError`, keeping token failures isolated from the observation path and the daemon's error budget (D-08). Threaded `onTokenRow` through the `startClaudeWatcher({...})` param list and `eOpts`.
- **`scripts/sub-agent-live-claude.mjs`**: guarded dynamic-import of `claude-token-rows.mjs`, `token-db.mjs`, and `task-id.mjs` (same pattern as `ObservationWriter` so `--help` works without SQLite), constructs a second-writer token-db handle against `LLM_PROXY_DATA_DIR ?? <cwd>/.data` + `/llm-proxy/token-usage.db`, and defines `onTokenRow(record)` that builds rows, stamps `task_id = await resolveLiveTaskIdSafe()`, sets `user_hash = ADAPTER_USER_HASH_CLAUDE`, and `insertTokenRow` each — all inside `try/catch`. Closes the handle on shutdown. If the import/open fails the daemon logs and runs WITHOUT token emission (observation path unaffected).
- **`tests/token-adapters/claude-taskid.test.js`** (3 tests): live `task_id` stamp (`'task-live-1'` via stub dist), `task_id===''` on no-span, and an `insertTokenRow` throw swallowed by the emission path.

### Task 2 — Completed-session sweep emission + reused backfill + live/sweep dedup (commit 3791a8760)

- **`scripts/sweep-sub-agents.mjs`**: `emitClaudeCompletedSessionTokenRows(discovered)` builds rows from each completed Claude transcript (`row.transcript_path`), sets `user_hash=cladpt` + `task_id=''`, dedups against live capture (`SELECT 1 FROM token_usage WHERE user_hash = ? AND tool_call_id = ? LIMIT 1`, parameterized — Pitfall 4), inserts each survivor, then REUSES the locked timestamp-join (`runSweep` + `loadArchivedSpans` imported from `backfill-task-id-by-timestamp.mjs`, D-03) to stamp the just-written `task_id=''` rows from archived spans. Emission + backfill wrapped best-effort so a sweep token failure never aborts the sub-agent sweep. Gated to `agentId==='claude'` inside the existing convert loop (no shell-script edit needed).
- **`scripts/backfill-task-id-by-timestamp.mjs`**: exported `runSweep` + `loadArchivedSpans` and added an `import.meta.url === pathToFileURL(process.argv[1]).href` entry-point guard so importing the module for reuse does not execute `main()` as a side effect (the CLI + `--self-test` paths are unchanged).
- **`tests/token-adapters/dedup.test.js`** (4 tests): OQ-3 non-empty `tool_call_id` precondition (per-turn rows == `req_TEST0001/2/3`), no-double-insert on re-sweep (each `tool_call_id` exactly once), new-session pass-through, and reused `runSweep` stamping in-window `task_id` while leaving an out-of-window row at `''`.

## Verification

- `npx jest tests/token-adapters/claude-taskid.test.js` — 3/3 PASS.
- `npx jest tests/token-adapters/dedup.test.js` — 4/4 PASS.
- Full `tests/token-adapters/` suite — 9 suites / 33 tests PASS (no regression; baseline was 8/29).
- `node scripts/backfill-task-id-by-timestamp.mjs --self-test` — still PASS (reuse contract intact); importing the module exposes only `loadArchivedSpans, runSweep` with no `main()` side-effect.
- Acceptance greps: `grep -c onTokenRow` → claude-fs-watch=8, supervisor=4; `grep -c resolveLiveTaskIdSafe` supervisor=3; the onTokenRow invocation catch does NOT call `onError` (verified — only the JSDoc mentions onError); `grep -Ec 'runSweep|loadArchivedSpans'` sweep=4; `grep -c 'tool_call_id = ?'` sweep=1; `git status` shows no `.plist` change.

## Reload Step (D-08 — no plist change)

The live daemon and sweep are extended additively with no launchd plist modification. After deploying this change, reload the live daemon with:

```
launchctl kickstart -k gui/$(id -u)/com.coding.sub-agent-live-claude
```

The sweep (`com.coding.sub-agent-sweep`) picks up the new emission on its next scheduled run; no plist edit required.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Exported `runSweep` + `loadArchivedSpans` and added an entry-point guard in `backfill-task-id-by-timestamp.mjs`**
- **Found during:** Task 2
- **Issue:** The plan mandates reusing `runSweep` + `loadArchivedSpans` (D-03, do NOT re-implement the join), but both were module-private (un-exported), and the module's bottom-level `main()`/`--self-test` dispatch ran unconditionally on load — so a plain `import` would both fail to find the symbols AND execute the CLI sweep as a side effect.
- **Fix:** Added `export` to both functions and wrapped the CLI dispatch in an `import.meta.url === pathToFileURL(process.argv[1]).href` entry-point guard (added the `pathToFileURL` import). The CLI and `--self-test` behavior are byte-for-byte unchanged when invoked directly.
- **Files modified:** `scripts/backfill-task-id-by-timestamp.mjs`
- **Commit:** 3791a8760

## Threat Flags

None — no new network endpoints, auth paths, or schema changes. The only DB write is the existing Phase-68 `token_usage` INSERT via the locked parameterized helper; the dedup probe and the reused backfill UPDATE are both parameterized.

## Known Stubs

None.

## Self-Check: PASSED

- Created files exist: `tests/token-adapters/claude-taskid.test.js`, `tests/token-adapters/dedup.test.js`, `69-05-SUMMARY.md`.
- Commits exist: 45c86a9e2 (Task 1), 3791a8760 (Task 2).
