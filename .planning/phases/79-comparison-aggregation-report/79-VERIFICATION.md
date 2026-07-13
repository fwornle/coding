---
phase: 79-comparison-aggregation-report
verified: 2026-07-13T20:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 79: Comparison, Aggregation & Report Verification Report

**Phase Goal:** The runner turns raw per-cell Runs into an honest side-by-side comparison — gating on an objective success signal, aggregating repeats with variance, and ranking variants — so only genuinely successful runs are cost-compared.
**Verified:** 2026-07-13T20:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (CMP-01) | An objective success gate is evaluated per run; cost/route/score metrics are compared only across gate-passing runs; failed runs reported separately | VERIFIED | `gate_passed` is computed once via `gateFromEvidence(evidence)` (lib/experiments/evidence-harness.mjs:377-381) from the already-computed `evidence.testRun` (no second test execution — confirmed by reading `scripts/measurement-stop.mjs:869`, which stamps `judgment.gate_passed` between `overlayNonGsdRubric` (line 862) and `writeScore` (line 870)). Persisted at `score-write.mjs:152` as `gate_passed: j.gate_passed ?? null` in the JUDGED metadata block (not `corrected_*`). `compare.mjs isRankable(row)` (line 132-142) requires `terminal_state==='complete' && gate_passed===true && rubricScore>0`. Null-not-zero confirmed: `gateFromEvidence({testRun:null})===null`, never coerced to false; test `gate-persist.test.mjs` Test C explicitly asserts omitted gate persists as `null` not `false`. |
| 2 (CMP-02) | N repeats aggregate into per-variant central tendency AND variance for tokens, wallclock, route metrics, rubric scores | VERIFIED | `summaryStats(values)` (compare.mjs:83-108) returns `{mean,stddev,median,min,max,n}`, filtering non-numeric/null values BEFORE computing (`n` = non-null count). `AGG_METRICS` (compare.mjs:184-195) covers `totalTokens`, `wallclock`, all 6 route heuristics (`loop_count, edit_revert_count, redundant_read_count, abandoned_tool_count, total_step_count, wallclock_per_step` — matched 1:1 against `run-write.mjs:141-146`), `rubric_score`, and the 5 locked rubric dims. Test `aggregateByVariant — token totals [100,200,300] → {mean:200,stddev≈81.6,...}` passes; null-exclusion test confirms `n` reflects non-null count only. |
| 3 (CMP-03) | Ranked side-by-side report (CLI table + machine-readable export) keyed by task_hash, showing variance + each variant's gate outcome | VERIFIED | `scripts/experiments-compare.mjs` renders `renderTable(report)` to stdout (RANKED section + distinct FAILED/UNGATED/UNSCORED sections) and writes `.data/experiments/reports/<task_hash>.json` via `writeReportJson`. Live-ran against a real task_hash (`d4164dca...`) from the actual store — produced a correctly-shaped JSON (`task_hash, rank_by, generated_at, ranked, failed, ungated, unscored`) with `gate_outcome` stamped per variant and full `{mean,stddev,median,min,max,n}` metrics blocks. `--rank-by` verified via test + `rankVariants()` switch (composite/tokens/wallclock ascending, score descending). `--csv` verified — `writeReportCsv` writes one row per variant. `sanitizeTaskHash('../../etc/passwd')` throws before the store is even opened (verified live: `FATAL: Error: sanitizeTaskHash: task_hash contains a path separator`, exit 1, no file written); `resolveReportPath` additionally asserts resolved-path containment (defense-in-depth). |
| 4 (honesty spine) | A variant whose runs ALL fail the gate is shown as "no successful runs", never surfaced as a cheap winner | VERIFIED | Structural: `isRankable` gate excludes non-passers; `buildComparison` classifies a variant into `ranked` ONLY if `successRows.length > 0` (compare.mjs:309), else routes by weakest signal to `unscored`/`ungated`/`failed`. Explicit test `'gate separation — success ranked, failed(gate) and timeout land in failed, never cost-averaged'` (compare.test.mjs) constructs variant B (2 runs, both `gate_passed=false`) and variant C (1 timeout run) and asserts both land in `report.failed`, `ranked=['A']` only, and A's cost mean (150) is computed ONLY over A's own successful runs — B/C never dilute or masquerade as cheap. Confirmed live on real data: task_hash `d4164dca...` — ALL 4 variants have zero `gate_passed=true+complete` runs (predates gate persistence, D-04b) → `ranked=[]`, 3 variants in `failed`, 1 in `ungated`. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `lib/experiments/evidence-harness.mjs` | exports `gateFromEvidence` | VERIFIED | Exported at line 377; 3-state derivation (null/true/false) confirmed by unit test + inline node -e check |
| `scripts/measurement-stop.mjs` | threads `gate_passed` before `writeScore`, no re-execution | VERIFIED | `judgment.gate_passed = gateFromEvidence(evidence)` at line 869, between `overlayNonGsdRubric` (862) and `writeScore` (870); no new test invocation added |
| `lib/experiments/score-write.mjs` | persists `gate_passed` null-not-zero on Score.metadata | VERIFIED | Line 152: `gate_passed: j.gate_passed ?? null`, placed in judged block; JSDoc typedef updated |
| `tests/experiments/gate-persist.test.mjs` | unit coverage of 3 gate states + null-not-zero | VERIFIED | 4 tests, all passing; explicit `assert.notEqual(..., false)` for the ungated case |
| `lib/experiments/compare.mjs` | `buildComparison`, `aggregateByVariant`, `isRankable` exports; pure (no store, no console.*); min 120 lines | VERIFIED | 377 lines; all 3 named exports present as functions; `grep -c "GraphKMStore\|openExperimentStore"` == 0; `console.*` count == 0 |
| `tests/experiments/compare.test.mjs` | synthetic-fixture coverage of gate groups/variance/ranking/null-exclusion | VERIFIED | 14 tests, all passing |
| `scripts/experiments-compare.mjs` | CLI: `renderTable`, `writeReportJson`, `writeReportCsv`, `sanitizeTaskHash` named exports; store open/close in main | VERIFIED | All 4 exports present and functional; `openExperimentStore()` in main with `try/finally store.close()`; `new GraphKMStore` count == 0 in this file |
| `tests/experiments/experiments-compare.test.mjs` | integration coverage of table/JSON/CSV/sanitization | VERIFIED | 11 tests, all passing, including a store-backed integration test with synthetic Run+Score+Outcome fixtures |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `measurement-stop.mjs` | `evidence-harness.mjs gateFromEvidence` | import + call after overlayNonGsdRubric, before writeScore | WIRED | Confirmed by direct code read (lines 74, 862, 869-870) |
| `score-write.mjs` | `Score.metadata.gate_passed` | `j.gate_passed ?? null` in metadata block | WIRED | Confirmed line 152, judged block (not corrected_*) |
| `compare.mjs` | `row.score.gate_passed + row.terminal_state` | `isRankable(row)` gate predicate | WIRED | Confirmed lines 132-142 |
| `compare.mjs buildComparison` | `readRuns` row shape | pure in-memory group-by | WIRED | Confirmed against `query.mjs` and `run-write.mjs` field names; live-ran against real store rows successfully |
| `experiments-compare.mjs main` | `compare.mjs buildComparison` | `readRuns(store) → buildComparison(rows, {taskHash, rankBy})` | WIRED | Confirmed lines 320-321; live-ran end-to-end |
| `experiments-compare.mjs writeReportJson` | `.data/experiments/reports/<task_hash>.json` | `fs.mkdirSync` + `writeFileSync` of sanitized path | WIRED | Live-ran; produced correctly-shaped JSON file, then cleaned up (runtime artifact, not committed per plan) |
| `experiments-compare.mjs` | `openExperimentStore()` | store open in main, try/finally close | WIRED | Confirmed lines 318, 330; `store.mjs` sets `ontologyDir` per CLAUDE.md km-core rule |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Test suite passes | `node --test tests/experiments/compare.test.mjs tests/experiments/gate-persist.test.mjs tests/experiments/experiments-compare.test.mjs` | `tests 29 / pass 29 / fail 0` | PASS |
| No regression to existing scoring | `node --test tests/experiments/score-write.test.mjs` | `tests 5 / pass 5 / fail 0` | PASS |
| CLI missing-arg error path | `node scripts/experiments-compare.mjs` | `error: --task-hash <h> is required`, exit 2 | PASS |
| CLI path-traversal rejection | `node scripts/experiments-compare.mjs --task-hash '../../etc/passwd'` | `FATAL: ... contains a path separator`, exit 1, no file written | PASS |
| Live end-to-end run against real store data | `node scripts/experiments-compare.mjs --task-hash d4164dca...` | Correctly rendered table + wrote schema-correct JSON; `ranked=[]` (36 pre-existing runs predate gate persistence per D-04b), 3 variants in FAILED, 1 in UNGATED — no false "cheap winner" | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CMP-01 | 79-01, 79-02 | Objective success gate evaluated per run; only gate-passers cost-compared | SATISFIED | gate_passed persisted + isRankable gate + failed-section routing, all verified above |
| CMP-02 | 79-02 | N-repeat aggregation with central tendency + variance | SATISFIED | summaryStats + AGG_METRICS covering tokens/wallclock/6 heuristics/rubric |
| CMP-03 | 79-02, 79-03 | Ranked side-by-side report (CLI table + JSON/CSV), keyed by task_hash | SATISFIED | renderTable + writeReportJson/Csv, live-verified end-to-end |

No orphaned requirements found for this phase (CMP-01/02/03 all claimed and satisfied).

### Anti-Patterns Found

None. Scanned all 8 phase-modified/created files (`lib/experiments/compare.mjs`, `lib/experiments/evidence-harness.mjs`, `scripts/measurement-stop.mjs`, `lib/experiments/score-write.mjs`, `scripts/experiments-compare.mjs`, `tests/experiments/compare.test.mjs`, `tests/experiments/gate-persist.test.mjs`, `tests/experiments/experiments-compare.test.mjs`) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER|not yet implemented|coming soon` — zero matches. No `console.*` calls found outside doc-comment mentions of the prohibition itself.

### Minor Observation (non-blocking)

`gateFromEvidence` derives `false` for ANY non-zero-or-null `testRun.status`, including the theoretical case `testRun.status === null` with no `counts` (an "indeterminate" test run per the sibling function `regressionsFromRun`'s explicit null branch at evidence-harness.mjs:352). `gateFromEvidence`'s own line 380 (`return testRun.status === 0`) would return `false` in that case rather than `null`. This is an extremely narrow edge case (a `testRun` object present but with a `status` that is neither `0` nor a number) not covered by an explicit test, and not required by any of the plan's stated acceptance criteria (which only test `status:0`, `status:1`, `status:2`, and `testRun:null`). Does not affect any of the 4 verified truths or block the phase goal — noted for awareness only, not a gap.

### Deferred Items (correctly out of scope for Phase 79)

| Item | Belongs To | Evidence |
|------|-----------|----------|
| CMP-04 (dashboard Performance-tab variant columns) | Phase 80 | No `gate_outcome`/variant-column wiring found in `integrations/system-health-dashboard/src/`; ROADMAP Phase 80 goal explicitly covers "viewable in the Performance dashboard tab" |
| ORCH-01 (installed cross-agent `experiment run` skill) | Phase 80 | No `experiment run` skill found under `.claude/`; ROADMAP Phase 80 requirements list `ORCH-01` |

### Human Verification Required

None. All truths verified programmatically via code reading, test execution, and a live end-to-end CLI run against real store data.

### Gaps Summary

No gaps found. All 4 ROADMAP success criteria (CMP-01, CMP-02, CMP-03, and the honesty-spine criterion) are structurally enforced in the codebase, covered by passing automated tests (29/29 phase tests + 5/5 regression tests), and independently confirmed via a live CLI run against real production store data that correctly demonstrated the "no successful runs" honesty behavior (all pre-existing runs predate gate persistence, so nothing false-positively ranks as a cheap winner). The km-core `ontologyDir` rule, no-console-log discipline, and "gate is not re-executed" constraint from CLAUDE.md are all satisfied. Deferred items (CMP-04, ORCH-01) are correctly absent from this phase's deliverables.

---

*Verified: 2026-07-13T20:00:00Z*
*Verifier: Claude (gsd-verifier)*
