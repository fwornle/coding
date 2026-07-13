---
phase: 79-comparison-aggregation-report
plan: 01
subsystem: experiments
tags: [experiments, gate-persistence, score-write, evidence-harness, kb, node-test]

# Dependency graph
requires:
  - phase: 73-semantic-route-judge-success-scoring
    provides: writeScore Score entity + evidence-harness gatherEvidence (evidence.testRun)
  - phase: 78-autonomous-cross-agent-runner
    provides: Run rows + Run--scored-->Score edge the gate is attached to
provides:
  - "gateFromEvidence(evidence) pure helper (true|false|null) in evidence-harness.mjs"
  - "gate_passed discrete field persisted on Score.metadata (null-not-zero)"
  - "measurement-stop threads the objective test-gate onto the judgment before writeScore"
  - "readRuns rows now expose row.score.gate_passed (consumed by Plan 02 aggregator)"
affects: [79-02-aggregation-report, 80-dashboard-variant-columns, compare.mjs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Objective gate DISTINCT from subjective rubric — same evidence.testRun, two consumers"
    - "null-not-zero for the gate: ungated (no test_command) persists null, NEVER false"
    - "Compute-once, mutate-in-place on the judgment, single writeScore (mirrors overlayNonGsdRubric)"

key-files:
  created:
    - tests/experiments/gate-persist.test.mjs
  modified:
    - lib/experiments/evidence-harness.mjs
    - scripts/measurement-stop.mjs
    - lib/experiments/score-write.mjs

key-decisions:
  - "gate_passed lives on Score.metadata (where the harness result already lands), NOT on Run"
  - "gate_passed is a JUDGED field (overwritten on re-judge like rubric dims), placed with the judged block, NOT the corrected_* block"
  - "Derived from the ALREADY-computed evidence.testRun — no second test execution (D-04: sandbox worktree destroyed after the run)"

patterns-established:
  - "gateFromEvidence: null testRun -> null; status===0 -> true; non-zero -> false; never throws"
  - "gate_passed: j.gate_passed ?? null (never ?? false) — the null-not-zero invariant asserted by Test C"

requirements-completed: [CMP-01]

# Metrics
duration: ~20min
completed: 2026-07-13
---

# Phase 79 Plan 01: Objective Test-Gate Persistence Summary

**Persists the objective per-cell test-gate outcome (`gate_passed: true|false|null`) as a discrete queryable field on the Score entity at score time, reusing the already-computed `evidence.testRun` (no second test run) so Plan 02's aggregator can separate gate-passers from failed/ungated runs.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-13T17:39:45Z
- **Tasks:** 3
- **Files modified:** 3 (+1 created)

## Accomplishments
- `gateFromEvidence(evidence)` pure helper added to `evidence-harness.mjs` — derives `true|false|null` strictly from the in-hand `evidence.testRun`, mirroring `regressionsFromRun`'s null/exit-status shape; never runs the test a second time (D-04), never throws.
- `measurement-stop.mjs` now imports `gateFromEvidence` and stamps `judgment.gate_passed` immediately after `overlayNonGsdRubric(...)` and before `writeScore(...)` — compute-once, mutate-in-place, single writeScore. The existing rubric-derivation path is untouched (API-preserving, CLAUDE.md).
- `score-write.mjs` persists `gate_passed: j.gate_passed ?? null` in the JUDGED block of `Score.metadata` (never `?? false`), with the JSDoc `args.judgment` typedef extended to `gate_passed?: boolean|null`.
- Unit test `gate-persist.test.mjs` covers the three gate states + the null-not-zero omitted case, plus store-backed writeScore read-back for true/false/null.

## Task Commits

Each task was committed atomically (Tasks 1 & 3 are TDD — test authored RED, then implementation GREEN):

1. **Task 1/3 RED: failing gate-persist test** - `02f85aa16` (test)
2. **Task 1 GREEN: gateFromEvidence helper** - `463d64866` (feat)
3. **Task 2: thread + persist gate_passed** - `c5481f3a2` (feat)

_Task 3 (unit test) was satisfied by the RED-phase test file, which is now green after Tasks 1 & 2 — its four required behaviors (three gateFromEvidence states + writeScore read-back true/null/false) are all covered and asserted; no additional test-only commit was needed._

**Plan metadata:** committed with this SUMMARY.

## Files Created/Modified
- `lib/experiments/evidence-harness.mjs` - Added exported `gateFromEvidence(evidence)` returning `true|false|null` from `evidence?.testRun` (null-not-zero, never throws), with a CMP-01 / D-04a JSDoc block noting it is distinct from the rubric and does NOT re-run the test.
- `scripts/measurement-stop.mjs` - Import `gateFromEvidence`; stamp `judgment.gate_passed = gateFromEvidence(evidence)` between `overlayNonGsdRubric` and `writeScore`.
- `lib/experiments/score-write.mjs` - Persist `gate_passed: j.gate_passed ?? null` in the judged metadata block; JSDoc typedef adds `gate_passed?: boolean|null`.
- `tests/experiments/gate-persist.test.mjs` - 4 tests: gateFromEvidence three states + null-safety (unit); writeScore read-back for gate_passed true / null (omitted) / false (store-backed, isolated tmp store with the real ontology).

## Export schema note (for Plan 02 / Phase 80)
`readRuns(store)` rows now surface the gate off the joined Score: **`row.score.gate_passed`**, where:
- `true`  = objective test exited 0 → eligible for the ranked cost comparison **only when also `terminal_state === 'complete'`** (D-01).
- `false` = objective test failed (non-zero exit) → failed section (D-03), never averaged as a cheap winner.
- `null`  = no `test_command` (ungated, D-02) → shown-not-ranked.
No `query.mjs` code change was required — the existing `...meta` / `scoreMap.get(taskId)` join already surfaces the new field.

## Decisions Made
- **gate_passed on Score.metadata, not Run** — the evidence-harness result already lands on the Score at score time (D-04a); attaching there avoids a second join and keeps the gate co-located with the rubric it is distinct from.
- **Judged, not corrected** — `gate_passed` is overwritten on re-judge like the rubric dims, so it sits in the judged block, not the preserved `corrected_*` block.
- **No second test execution** — the gate is derived purely from the in-hand `evidence.testRun` (D-04: the agent's edits lived in an ephemeral sandbox worktree destroyed after the run; re-running at compare time would test a checkout without the edits).

## Deviations from Plan

### Recovery (pre-task, not a deviation rule)
The worktree was spawned from base commit `ee6e0af29`, which predated the Phase 79 planning commits (plan/context/patterns files were committed to `main` afterward). Per the `feedback_worktree_base_drift.md` guidance, recovered by merging `main` into the worktree branch with `git merge --no-ff` (clean merge, no conflicts) to bring in both the Phase 79 planning docs and the completed prior-wave (Phase 77/78/etc.) code the plan builds on. Only `.claude/settings.local.json` was locally modified pre-merge (unrelated).

**Plan tasks themselves:** None — the three tasks executed exactly as written.

## Issues Encountered
None. All tests green on first GREEN implementation; no auto-fixes required.

## Threat Model Compliance
- **T-79-01-01 (Tampering — gate derivation):** mitigated — `gateFromEvidence` is pure and reads only the already-computed `evidence.testRun`; no second test execution.
- **T-79-01-02 (Information Disclosure — null-vs-false):** mitigated — null-not-zero enforced (`?? null`, never `?? false`); asserted by Test C.
- **T-79-01-SC (installs):** accept — no package installs; pure in-repo edits + node:test.

No new threat surface introduced (no new endpoints, auth paths, or file-access patterns beyond the planned evidence→Score.metadata boundary).

## Known Stubs
None.

## Next Phase Readiness
- `gate_passed` is a discrete, queryable field on `Score.metadata`; `readRuns` rows expose `row.score.gate_passed`. Plan 02's `compare.mjs` aggregator can now apply D-01..D-13 against a real gate field.
- The 36 pre-existing Run rows predate the gate field → they persist `gate_passed=null` (ungated) and remain valid fixtures for the ungated/failed/unscored groupings; the ranked-successful path needs ≥1 fresh gate-persisted run (coordinated with the Phase 78-05 smoke, D-04b).

## Self-Check: PASSED
- All 4 modified/created source+test files exist on disk.
- All 3 task commits present in git log (`02f85aa16`, `463d64866`, `c5481f3a2`).

---
*Phase: 79-comparison-aggregation-report*
*Completed: 2026-07-13*
