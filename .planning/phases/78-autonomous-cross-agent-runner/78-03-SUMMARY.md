---
phase: 78-autonomous-cross-agent-runner
plan: 03
subsystem: testing
tags: [experiments, cross-agent, orchestration, sandbox, terminal-state-machine, idempotent-resume, node-test]

# Dependency graph
requires:
  - phase: 78-01
    provides: measurement-start/stop --variant/--repeat/--terminal-state/--skip-reason; run-write null-preserved terminal_state/skip_reason tags
  - phase: 78-02
    provides: argvForAgent / resolveAgentBinary / probeCopilotHeadless headless adapter
  - phase: 77-03
    provides: restoreForCell isolated-sandbox restore (inPlace:false)
  - phase: 74-02
    provides: readRuns resume ledger (rows carry task_id + terminal_state)
  - phase: 71
    provides: openExperimentStore single-owner repo-global Run store
provides:
  - "runMatrix(spec, opts): sequential idempotent resumable variant×repeat matrix loop"
  - "runCell: restore → measured span → agent launch → inline score in a finally"
  - "launchCell: async-spawn terminal-state machine (complete|timeout|abort) under a 20-min SIGTERM→SIGKILL timer"
  - "stub-agent fixture (exit0/exitN/hang) for terminal-state unit coverage"
affects: [experiment-cli, cross-agent-report, dashboard-performance-tab]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injected-seam orchestration (restore/spawnAgent/runMeasurement/readDone/probeCopilot/openStore/resolveSpec) — unit-testable without git worktree/agent/span"
    - "Terminal-state machine: async spawn + wall-clock timer → SIGTERM, nested grace timer → SIGKILL, exit maps to a closed enum"
    - "Score-in-a-finally: measurement-stop runs on EVERY terminal state so no cell is silently dropped"
    - "Idempotent resume via composite-task_id done-set filtered on terminal_state==='complete'"

key-files:
  created:
    - lib/experiments/experiment-runner.mjs
    - tests/experiments/experiment-runner.test.mjs
    - tests/experiments/_fixtures/stub-agent.mjs
  modified: []

key-decisions:
  - "D-04 terminal enum is exactly complete|timeout|abort; a spawn ENOENT reject is recorded best-effort as abort (never a distinct enum)"
  - "Q1: copilot probe runs standalone ONCE and is cached; copilot variants stay env:default (validateCells unchanged) — the probe alone gates run-vs-skip-Run"
  - "Q3: resume skips ONLY terminal_state==='complete' cells; timeout/abort/unscored cells are retried"
  - "D-05: test_command threads to the span but scores only at measurement-stop time — never the completion gate (exit code / timer is the sole signal)"
  - "Single-owner store opened ONCE for the done-set then closed before launching any cell; measurement-stop reopens it per cell"

patterns-established:
  - "Composite cell key <expId>--<variant>--r<rep> (task_hash is constant across the matrix — Pitfall 1)"
  - "Default-arg injectable seams: passing seam:undefined from runMatrix falls through to runCell's real default"

requirements-completed: [RUN-02, RUN-03, RUN-04]

# Metrics
duration: ~35min
completed: 2026-07-03
---

# Phase 78 Plan 03: Autonomous Cross-Agent Runner Engine Summary

**`runMatrix` — the sequential, idempotent, resumable variant×repeat matrix loop that restores an isolated sandbox per cell, launches each headless agent under a 20-min SIGTERM→SIGKILL terminal-state machine, and lands exactly one inline-scored Run per attempted cell (probe-gating copilot and recording best-effort failures).**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-03
- **Tasks:** 3 (all TDD: RED → GREEN)
- **Files modified:** 3 created

## Accomplishments
- `launchCell` terminal-state machine: async `spawn` into the sandbox (cwd=worktree, env.LLM_PROXY_DATA_DIR=sandbox .data), a 20-min overridable wall-clock timer escalating SIGTERM→SIGKILL, mapping exit/timeout to the closed `complete|timeout|abort` enum.
- `runCell` per-cell wiring: `restoreForCell` → `measurement-start` (composite task_id + variant/repeat/agent/model/framework/goal, sandbox env) → agent launch → `measurement-stop --headless --terminal-state <state>` in a `finally` so a Run + inline score land on EVERY terminal state.
- `runMatrix` sequential idempotent loop: single-owner store opened once to build the resume done-set (complete-only, Q3), copilot probe cached once (Q1), strictly-sequential `await`-per-cell execution, recorded copilot skip-Runs (D-08), and best-effort try/catch so an agent/spawn failure never stalls the matrix (D-12).
- `stub-agent.mjs` fixture (exit0/exitN/hang) driving the terminal-state mapping without a real agent.

## Task Commits

1. **Task 1: Terminal-state machine (launchCell)** — `ef659ade2` (test RED) → `75533a5bb` (feat GREEN)
2. **Task 2: Per-cell wiring (runCell)** — `1c2332064` (test RED) → `de42207a6` (feat GREEN)
3. **Task 3: Sequential idempotent matrix loop + copilot probe gate (runMatrix)** — `a23821368` (test RED) → `d376d1d5e` (feat GREEN)

_TDD tasks: each has a `test(...)` RED commit followed by a `feat(...)` GREEN commit._

## Files Created/Modified
- `lib/experiments/experiment-runner.mjs` (427 lines) — `launchCell` / `runCell` / `runMatrix` + `runMeasurementCli` / `cellName` / `composeTaskId` helpers, all with injectable seams.
- `tests/experiments/experiment-runner.test.mjs` (330 lines) — 16 node:test cases across the terminal-state machine, per-cell wiring, and matrix loop.
- `tests/experiments/_fixtures/stub-agent.mjs` (33 lines) — controllable exit0/exitN/hang stub agent.

## Decisions Made
See `key-decisions` frontmatter. Notable: a spawn-error (ENOENT) reject is folded into the best-effort `abort` recording rather than introducing a 4th terminal state, keeping the D-04 enum closed; the resume done-set is keyed on the composite `<expId>--<variant>--r<rep>` because the underlying task_hash is constant across the matrix (Pitfall 1).

## Deviations from Plan

None - plan executed exactly as written.

Note (not a deviation): the plan's illustrative `runMatrix` signature was extended with `expId`, `snapshotId`, `taskClass`, `agentsDir`, and an injectable `resolveSpec` seam. These are additive parameters needed to compose the task_id, locate the baseline snapshot, and unit-test cells (including a `mastracode` agent that the real `validateCells` would reject). All plan-listed seams (restore/spawnAgent/runMeasurement/readDone/probeCopilot/openStore) are present and defaulted exactly as specified.

## Issues Encountered
- The initial async-spawn non-blocking test left a 60s wall-clock timer alive (test ran ~65s). Fixed by shortening the injected `timeoutMs`/`graceMs` so no timer dangles past the assertion — the test still proves the launch promise stays pending while the sentinel wins. Full suite now runs in <1s.

## Threat Flags
None — no new network endpoints, auth paths, or trust-boundary surface beyond the plan's threat model (fixed-argv spawn, sandbox cwd/env, wall-clock timer, score-in-finally, recorded skip-Run all implemented as the register's mitigations).

## Verification
- `node --test tests/experiments/experiment-runner.test.mjs` → 16/16 pass.
- `node --test 'tests/experiments/**/*.test.mjs'` → 252 pass / 0 fail / 2 pre-existing skips (no regression).
- Source assertions: async `spawn` (no `spawnSync`/`shell:true` in code — only in explanatory comments), terminal enum `complete|timeout|abort`, spawn opts set cwd + `LLM_PROXY_DATA_DIR`, measurement-stop inside a `finally`, done-set filter `terminal_state === 'complete'`, copilot skip passes `--skip-reason copilot-headless-unsupported` without a launch, no `Promise.all` in the cell loop.

## Next Phase Readiness
- `runMatrix` is the drive engine ready to be wired behind a CLI / experiment entrypoint (Wave 3/4).
- No blockers. The engine assumes a declare-time baseline snapshot id (`snapshotId`) and a resolved/validated spec are supplied by the caller.

---
*Phase: 78-autonomous-cross-agent-runner*
*Completed: 2026-07-03*
