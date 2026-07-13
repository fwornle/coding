---
phase: 79-comparison-aggregation-report
plan: 02
subsystem: experiments-comparison
tags: [aggregation, ranking, variance, success-gate, pure-module]
requires:
  - "lib/experiments/query.mjs readRuns row shape (task_hash, variant, terminal_state, score.gate_passed, score.goal_aligned_ratio, outcome.totalTokens)"
  - "lib/experiments/query.mjs effectiveDimension (corrected-wins rubric read)"
provides:
  - "lib/experiments/compare.mjs — buildComparison(rows, opts) pure aggregator"
  - "compare.mjs exports: buildComparison, aggregateByVariant, isRankable, summaryStats, rubricScore"
  - "the report object schema (ranked/failed/ungated/unscored + per-metric {mean,stddev,median,min,max,n} block) that Plan 79-03 serializes to JSON"
affects:
  - "Plan 79-03 (CLI + JSON/CSV export) consumes buildComparison + the report schema"
  - "Phase 80 (CMP-04 dashboard variant columns) renders the JSON export shape"
tech-stack:
  added: []
  patterns:
    - "caller-owns-store: compare.mjs receives pre-read rows, never opens/constructs a km-core store"
    - "null-not-zero: summaryStats filters nulls; n = non-null count; composite never divides by null/0"
    - "exported gate predicate + empty-shape helper + early-return degradation (token-aggregate.mjs idiom)"
key-files:
  created:
    - "lib/experiments/compare.mjs (376 lines) — the pure variant aggregator"
    - "tests/experiments/compare.test.mjs (274 lines) — 14 synthetic-fixture tests"
  modified: []
decisions:
  - "D-08 RESOLVED: composite rubric_score denominator = score.goal_aligned_ratio ALONE (single normalized 0-1 quality signal), NOT an aggregate of the 5 locked rubric dims. The 5 dims are still surfaced per-metric in the variance block via effectiveDimension; only the composite denominator is goal_aligned_ratio."
  - "wallclock metric derived from Run.metadata started_at/ended_at (ISO) → total ms; null if either timestamp missing (no dedicated total-wallclock field exists on Outcome; wallclock_per_step remains covered as one of the 6 heuristics)."
  - "A variant lands in exactly ONE group by its STRONGEST classification across runs: ≥1 successful-gated+scored run → ranked (aggregated over those runs only, so a variant's failed runs never dilute its cost); else unscored → ungated → failed."
metrics:
  duration: "~15 min"
  completed: 2026-07-13
  tasks: 2
  files: 2
---

# Phase 79 Plan 02: Comparison Aggregator Core Summary

The pure `lib/experiments/compare.mjs` variant aggregator — applies the D-01 success gate, computes `{mean,stddev,median,min,max,n}` per metric with nulls excluded (D-09), and ranks successful-gated variants by the composite `total_tokens / goal_aligned_ratio` ascending (D-05/D-08), with failed/ungated/unscored variants structurally excluded from the ranking (CMP-01 honesty invariant). Delivers CMP-01, CMP-02, and the aggregation core of CMP-03.

## What Was Built

**Task 1 — `lib/experiments/compare.mjs` (pure aggregator)**
- `buildComparison(rows, { taskHash, rankBy })` — filters to one task_hash, partitions variants into `ranked` / `failed` / `ungated` / `unscored`, ranks the ranked group.
- `aggregateByVariant(rows)` — group-by-variant with a per-metric variance block.
- `isRankable(row)` — the D-01 gate: `terminal_state==='complete' && gate_passed===true && rubricScore>0`.
- `summaryStats(values)` — `{mean,stddev,median,min,max,n}` over NON-NULL values (population stddev ÷ n); empty → all-null shape.
- `rubricScore(row)` — the D-08 denominator: `score.goal_aligned_ratio` or `null` (never 0).
- Pure: no store construction, no `console.*`; imports only `effectiveDimension` from query.mjs.

**Task 2 — `tests/experiments/compare.test.mjs` (14 tests, all synthetic — D-04b)**
- Gate separation, variance math, null-exclusion, composite ranking, `--rank-by` override, unscored/ungated routing, `n` surfaced, task_hash filter, empty-input degradation.

## Report Object Schema (Plan 79-03 serializes this; Phase 80 consumes it)

`buildComparison` returns:

```
{
  taskHash: string,
  rankBy:   'composite'|'tokens'|'wallclock'|'score',
  ranked:   VariantEntry[],   // successful-gated+scored, sorted by rankBy; each has .rank (1-based) + .composite
  failed:   VariantEntry[],   // gate_passed===false OR terminal_state timeout/abort ("no successful runs")
  ungated:  VariantEntry[],   // gate_passed===null (no test_command) — shown, not ranked
  unscored: VariantEntry[],   // successful+gated but null/zero rubric — shown, not ranked
}
```

`VariantEntry`:
```
{
  variant:   string,
  n:         number,          // repeat count (of the runs this entry aggregates — D-10)
  rank?:     number,          // 1-based, ranked group only
  composite?: number,         // ranked group only: totalTokens.mean / rubric_score.mean (finite)
  reason?:   string,          // failed/ungated/unscored group only
  metrics:   {                // per-metric {mean,stddev,median,min,max,n}, nulls excluded
    totalTokens, wallclock,
    loop_count, edit_revert_count, redundant_read_count,
    abandoned_tool_count, total_step_count, wallclock_per_step,
    rubric_score,
    goal_achieved, code_quality, test_coverage, regressions, spec_drift
  }
}
```

Field names are stable — Phase 80's dashboard variant columns consume them.

**Ranking semantics:** `composite`/`tokens`/`wallclock` ascending (lowest wins); `score` descending (higher quality first). `ranked` aggregates over a variant's SUCCESSFUL runs only, so a variant's failed/ungated runs never dilute its cost.

## Verification

- `node --test tests/experiments/compare.test.mjs` → `# tests 14 / # pass 14 / # fail 0`.
- Exports present: `buildComparison`, `aggregateByVariant`, `isRankable` (all functions).
- Purity: `grep -c "GraphKMStore\|openExperimentStore" lib/experiments/compare.mjs` == 0; `console.*` on non-comment lines == 0.
- `goal_aligned_ratio` documented in the module header (D-08 choice) — 6 occurrences.
- A `gate_passed=false` variant renders in `failed`, never `ranked` (asserted).

## Deviations from Plan

None — plan executed as written. Two Claude's-discretion resolutions the plan explicitly delegated:
1. **D-08** resolved to `goal_aligned_ratio` alone (the plan's recommended interpretation; documented in header + this SUMMARY).
2. **wallclock** total derived from `started_at`/`ended_at` — there is no dedicated total-wallclock field on the Outcome entity (only `wallclock_per_step` exists, which stays covered as one of the 6 heuristics). Null-preserved when either timestamp is absent.

## Threat Mitigations Applied

- **T-79-02-01** (Tampering — fabricated cheap winner): `isRankable` structurally excludes failed/ungated/unscored runs from the ranking; a variant's failed runs never enter its cost mean. Asserted by the gate-separation test.
- **T-79-02-02** (DoS — divide-by-null composite): null/zero rubric routes to `unscored` before any division; `compositeOf` returns null defensively. Asserted (no NaN/Infinity) by the unscored test.
- **T-79-02-03** (Info disclosure — null-as-zero stat corruption): `summaryStats` filters nulls first; `n` counts non-null contributors. Asserted by the null-exclusion tests.

## Known Stubs

None. `compare.mjs` is fully wired to the real readRuns row shape; the 36 pre-existing ungated runs (D-04b) exercise the ungated/failed groupings, and synthetic fixtures cover the ranked-successful path (which needs live gate-persisted runs from Plan 79-01 + a fresh gated run to demonstrate end-to-end).

## Notes for Downstream (Plan 79-03)

- `compare.mjs` takes pre-read `rows` — the CLI (`scripts/experiments-compare.mjs`) owns `openExperimentStore()` + `readRuns(store)` + `close()`, and passes rows into `buildComparison`.
- `writeReportJson` should serialize the report object above verbatim to `.data/experiments/reports/<task_hash>.json` (create dir with `fs.mkdirSync(..., { recursive: true })`).
- The gate field (`row.score.gate_passed`) is read here off the joined Score; Plan 79-01 persists it at score time.

## Self-Check: PASSED

- FOUND: lib/experiments/compare.mjs
- FOUND: tests/experiments/compare.test.mjs
- FOUND commit 0807eda8f (test RED gate)
- FOUND commit 1f6009a81 (feat GREEN gate)
