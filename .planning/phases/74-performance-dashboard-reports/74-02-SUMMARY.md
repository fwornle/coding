---
phase: 74-performance-dashboard-reports
plan: 02
subsystem: experiments-read-services
tags: [dashboard, experiments, read-service, two-store-boundary, null-not-zero]
requires:
  - lib/experiments/store.mjs (openExperimentStore — store passed in already open)
  - lib/experiments/score-write.mjs (iterate-by-entityType + run_task_id join idiom)
  - lib/experiments/token-aggregate.mjs (readonly open + bound param + graceful-missing-file)
  - tests/experiments/_fixtures/seed-experiment-store.mjs (seedIsolatedStore, seedTokenDb — Plan 74-01)
  - tests/experiments/run-read.test.mjs (DASH-01 RED — Plan 74-01)
  - tests/experiments/timeline-read.test.mjs (DASH-02 RED — Plan 74-01)
provides:
  - lib/experiments/query.mjs (readRuns, effectiveDimension)
  - lib/experiments/timeline-read.mjs (readTimeline)
affects:
  - Plan 74-04/05 (Performance page + endpoints call readRuns + readTimeline)
tech-stack:
  added: []
  patterns:
    - "readRuns receives an ALREADY-OPEN store; never opens/constructs one (writeScore contract)"
    - "three single iterate({ entityType }) passes (Score, Outcome, Run) joined on metadata.run_task_id"
    - "null-not-zero — no null-to-zero default on any judged/heuristic field"
    - "token-usage.db opened { readonly: true, fileMustExist: true }; task_id bound as ?"
    - "two-pass parent/child grouping by tool_call_id `:reason:` split; orphan reasoning rows promoted"
    - "graceful empty [] on missing token-usage.db (no throw)"
key-files:
  created:
    - lib/experiments/query.mjs
    - lib/experiments/timeline-read.mjs
  modified: []
decisions:
  - "Child detection keys on the `:reason:` separator in tool_call_id (not the granularity_tier string) so it works for both the test fixture tiers ('turn'/'reasoning-step') and the production tiers ('per-turn'/'per-reasoning-step')"
  - "effectiveDimension(score, dim) exported alongside readRuns as the single corrected-wins (D-03) definition for downstream endpoints/aggregates"
  - "Doc comments reworded to avoid the literal tokens `?? 0` and `new GraphKMStore` so the plan's exact-text grep gates pass against the whole file (not just code lines)"
metrics:
  duration: 6m
  completed: 2026-06-28
  tasks: 2
  files: 2
---

# Phase 74 Plan 02: Performance Read Services (readRuns + readTimeline) Summary

Built the two net-new read services the Performance tab consumes — `readRuns` (joins each km-core Run to its Score + Outcome from the experiment LevelDB) and `readTimeline` (reads the per-turn / per-reasoning-step token rows read-only from the proxy-owned `token-usage.db` and nests reasoning sub-bands under their parent turn) — turning the Plan 01 `run-read.test.mjs` and `timeline-read.test.mjs` RED tests GREEN while honouring the two-store boundary and the null-not-zero rule.

## What Was Built

- **`lib/experiments/query.mjs`** — `readRuns(store, { includePending = false })` runs three single `iterate({ entityType })` passes: Score and Outcome each build a `Map(run_task_id → metadata)`, then the Run pass joins on `metadata.task_id` and pushes `{ ...run.metadata, score, outcome }`. Pending Runs are excluded by default and included only with `includePending: true` (D-06). No judged/heuristic value is ever null-to-zero-defaulted (null = "no evidence", RESEARCH Pitfall 4 / D-01). Also exports `effectiveDimension(score, dim)` — the shared corrected-wins rule (D-03: `corrected_<dim>` if non-null, else judged `<dim>`, else null). The store is received already open; the module never opens or constructs a store.
- **`lib/experiments/timeline-read.mjs`** — `readTimeline(taskId, dbPathOverride)` mirrors `token-aggregate.mjs`: resolves the DB path (override accepted for tests), returns `[]` on a missing file (graceful empty, not a throw), opens `{ readonly: true, fileMustExist: true }`, and `close()`s in `finally`. A single prepared `SELECT … WHERE task_id = ?` (bound `?`, never interpolated — T-74-02-01) feeds a two-pass parent/child grouping: a row whose `tool_call_id` contains `:reason:` is a sub-band attached to the parent whose `tool_call_id` equals the base; orphan reasoning rows are promoted to their own parent so nothing is dropped. Each parent is `{ ...row, tier, estimated: tokens_estimated === 1, children: [...] }`.

## Verification

- `node --test tests/experiments/run-read.test.mjs tests/experiments/timeline-read.test.mjs` → 5 tests, 5 pass, 0 fail (both target files GREEN).
- Task 1 grep gates: `iterate({ entityType` count = 3; no `?? 0`; `new GraphKMStore` count = 0; `console.` (comment-filtered) = 0.
- Task 2 grep gates: `readonly: true` ≥ 1; `WHERE task_id = ?` matches; no `task_id = '` interpolation; `:reason:` present; `console.` (comment-filtered) = 0.
- Full experiment suite (`node --test "tests/experiments/**/*.test.mjs"`): 137 tests, 132 pass, 4 fail — the 4 failures are pre-existing Plan-01 RED tests for modules owned by LATER plans (`report-write.mjs` → Plan 05; the runs-endpoint `handleRunsQuery` handler), all `ERR_MODULE_NOT_FOUND`, none caused by this plan's changes. No previously-passing test regressed.

## Deviations from Plan

None functional — plan executed as written. One cosmetic adjustment (Rule 3, blocking the acceptance gate): the plan's grep gates match the *whole file* (`grep -n "?? 0"`, `grep -c "new GraphKMStore"`), so explanatory doc comments that quoted those literals would have failed the gate. The comments were reworded to convey the same rule without the literal tokens ("null-to-zero default" instead of `?? 0`; "directly constructs a km-core store" instead of `new GraphKMStore`). No behavioral change.

## Out-of-Scope Note

The plan body's prose mentions `handleRunsQuery` turning `runs-endpoint.test.mjs` GREEN, but this plan's `files_modified` frontmatter and success criteria scope only `query.mjs` + `timeline-read.mjs` (the two reader modules). The runs-endpoint handler and the report-write modules remain RED, owned by later plans (per Plan 01's affects-map). Left untouched.

## Known Stubs

None.

## Threat Flags

None. `readRuns` reads only Run/Score/Outcome metadata from a caller-opened experiment LevelDB (no writes; T-74-02-03 — no internal/provenance fields surfaced beyond metadata). `readTimeline` opens the proxy-owned `token-usage.db` strictly `{ readonly: true }` (T-74-02-02) with `task_id` bound as `?` (T-74-02-01). No new packages (`better-sqlite3` + km-core pre-existing; T-74-02-SC).

## Commits

- 914e29b63 — feat(74-02): readRuns join service (query.mjs)
- cba2abbee — feat(74-02): readTimeline read-only service (timeline-read.mjs)

## Self-Check: PASSED

Both created files present on disk; both task commits present in git history.
