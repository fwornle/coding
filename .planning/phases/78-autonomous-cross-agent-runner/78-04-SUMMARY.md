---
phase: 78-autonomous-cross-agent-runner
plan: 04
subsystem: testing
tags: [experiments, cli, matrix-runner, sc4, idempotency, node-test]

# Dependency graph
requires:
  - phase: 78-03
    provides: runMatrix engine (sequential idempotent variant×repeat loop) + runCell/launchCell
  - phase: 74-02
    provides: readRuns resume ledger
  - phase: 71
    provides: openExperimentStore repo-global single-owner store + writeRun materialization
  - phase: 77-03
    provides: scripts/experiment-restore.mjs CLI skeleton sibling
provides:
  - "scripts/experiment-run.mjs — thin operator CLI over runMatrix (--spec/--variant/--repeats/--timeout)"
  - "SC#4 automated proof: exactly one Run per variant×repeat cell, idempotent on re-run, terminal states recorded"
affects: [phase-79-comparison, experiment-operator-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Operator CLI over an engine: resolve+narrow the spec, inject resolveSpec into runMatrix"
    - "Integration proof drives the REAL store/writeRun/readRuns while stubbing only outer-world seams (restore/agent/measurement)"
    - "EXPERIMENT_RUN_FAKE fail-soft env seam mirrors EXPERIMENT_RESTORE_FAKE — CLI drivable without live agent/snapshot/store"

key-files:
  created:
    - scripts/experiment-run.mjs
    - tests/experiments/experiment-runner.integration.test.mjs
  modified: []

key-decisions:
  - "CLI narrows the run by injecting a pre-resolved+validated envelope via opts.resolveSpec (runMatrix's default would re-read the whole matrix)"
  - "--timeout is seconds on the CLI, converted to ms for runMatrix (D-06 override of the 20-min default)"
  - "Required-agent (claude/opencode) non-completion exits 1; a copilot skip-Run is NOT a failure"
  - "Integration test uses an in-process runMeasurement that calls the real writeRun so readRuns asserts against shipped persistence, not a mock"

patterns-established:
  - "Pattern 1: resolve+whole-run-validate the spec in the CLI (fail-fast) before driving the engine"
  - "Pattern 2: prove SC#4 by counting real Runs via readRuns against an isolated repoRoot with the real ontology copied in"

requirements-completed: [RUN-02, RUN-03, RUN-04]

# Metrics
duration: 18min
completed: 2026-07-03
---

# Phase 78 Plan 04: Autonomous Cross-Agent Runner — Operator CLI + SC#4 Proof Summary

**One-command matrix runner `scripts/experiment-run.mjs` over the 78-03 runMatrix engine, plus an automated SC#4 integration proof that a stub-agent matrix lands exactly one Run per variant×repeat cell, idempotent on re-run, with abort states recorded and retried.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-03
- **Completed:** 2026-07-03
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments
- `scripts/experiment-run.mjs`: thin operator CLI copying the `scripts/experiment-restore.mjs` skeleton and swapping the body to `runMatrix`. Parses `--spec` (required, exit 2 if absent), `--variant` (narrow to one cell), `--repeats` (override), `--timeout` (seconds → ms, D-06 override of the 20-min default). Resolves `repoRoot`/`dataDir` from `CODING_REPO`/`LLM_PROXY_DATA_DIR`. Exits 2 on usage errors, 1 on any required-agent (claude/opencode) non-completion, 1 on any thrown failure. `EXPERIMENT_RUN_FAKE` fail-soft seam makes it drivable end-to-end without a live agent, snapshot, or the real store. stderr-only diagnostics.
- `tests/experiments/experiment-runner.integration.test.mjs`: SC#4 end-to-end proof driving the REAL runMatrix + writeRun + readRuns against an isolated tmp store (real ontology copied in). Three behaviors: (1) a 2×2 stub-agent matrix lands exactly 4 Runs with distinct composite task_ids, all `terminal_state==='complete'`; (2) a re-run adds NO new Runs and launches no agent (D-10 idempotent resume); (3) an abort cell is recorded `terminal_state==='abort'` (not dropped) and retried on resume (D-04/Q3).

## Task Commits

1. **Task 1: Operator CLI scripts/experiment-run.mjs** - `bbb6d2fb0` (feat)
2. **Task 2: SC#4 integration test** - `895176b37` (test)

## Files Created/Modified
- `scripts/experiment-run.mjs` - operator CLI over runMatrix; flag parsing, spec resolve+narrow, exit-code contract, EXPERIMENT_RUN_FAKE seam
- `tests/experiments/experiment-runner.integration.test.mjs` - SC#4 + D-10 idempotency + D-04/Q3 abort-recorded-and-retried proof

## Decisions Made
- **Narrowing via injected resolveSpec.** runMatrix's default `resolveSpec` re-reads the whole unnarrowed matrix. The CLI resolves+validates the spec itself (Phase-77 `resolveExperimentSpec`, fail-fast), applies `--variant`/`--repeats` narrowing, and injects `opts.resolveSpec = () => narrowedEnvelope`. The raw spec object is still passed as `runMatrix`'s first arg so `experiment_id`/`snapshot_id` are read off it.
- **`--timeout` unit.** Seconds on the CLI (operator-friendly), converted to ms for `runMatrix.timeoutMs` (D-06).
- **Exit-code contract.** Required agents = claude/opencode; their non-completion (`terminal_state` abort/timeout) exits 1. A copilot recorded skip-Run is expected behavior, not a failure. Agent derived from the first `-`-segment of the variant name (KNOWN_AGENTS carry no dash).
- **Integration test measurement seam.** Instead of shelling `measurement-{start,stop}.mjs`, the test injects an in-process `runMeasurement` that captures cell fields on `start` and calls the shipped `writeRun` on `stop`. This keeps the persistence + readRuns path REAL (the SC#4 invariant is proven against shipped km-core writes) while avoiding a live agent/snapshot.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `node --test tests/experiments/` (directory positional) resolves the path as a module on this Node version and errors. Used the glob form `node --test "tests/experiments/*.test.mjs"` for the module-suite verification — 257 tests, 255 pass, 0 fail, 2 skipped (EXPERIMENTS_LIVE-gated). This is an invocation quirk, not a code issue.

## TDD Gate Compliance
Task 2 is marked `tdd="true"` but its `<files>` lists only the test file — the behavior under test (runMatrix → one Run per cell) was already shipped by Plan 78-03. It is therefore a **test-only SC#4 proof over existing code**, not a behavior-adding task (no non-test source file), so the MVP+TDD RED-must-fail gate is exempt. The GREEN implementation (`runMatrix`) lives in the 78-03 `feat` commit; this plan contributes the `test(...)` proof commit. The plan frontmatter `type: execute` (not `type: tdd`), so plan-level gate enforcement does not apply.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Operators can now run/narrow a whole matrix from one command; SC#4 is automatically gated in CI (`node --test tests/experiments/experiment-runner.integration.test.mjs`).
- Ready for Phase 79 comparison work — the per-cell Runs (variant/repeat/terminal_state tags) are the comparison input.

## Self-Check: PASSED

- FOUND: scripts/experiment-run.mjs
- FOUND: tests/experiments/experiment-runner.integration.test.mjs
- FOUND: .planning/phases/78-autonomous-cross-agent-runner/78-04-SUMMARY.md
- FOUND commits: bbb6d2fb0 (feat), 895176b37 (test), dce9fe885 (docs)

---
*Phase: 78-autonomous-cross-agent-runner*
*Completed: 2026-07-03*
