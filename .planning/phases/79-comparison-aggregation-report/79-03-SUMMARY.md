---
phase: 79-comparison-aggregation-report
plan: 03
subsystem: experiments-comparison
tags: [cli, report-export, json-schema, csv, path-sanitization, ranking]
requires:
  - "lib/experiments/compare.mjs buildComparison(rows, {taskHash, rankBy}) — the pure aggregator (79-02)"
  - "lib/experiments/query.mjs readRuns(store, {includePending}) — the Run/Score/Outcome join seam"
  - "lib/experiments/store.mjs openExperimentStore() — caller-owns-store, ontologyDir set inside"
provides:
  - "scripts/experiments-compare.mjs — the CMP-03 operator CLI (ranked table + JSON/CSV export)"
  - "the STABLE JSON export schema at .data/experiments/reports/<task_hash>.json (Phase 80 seam)"
  - "exports: sanitizeTaskHash, writeReportJson, writeReportCsv, renderTable (+ re-export buildComparison)"
affects:
  - "Phase 80 (CMP-04 dashboard variant columns) renders the .data/experiments/reports/<task_hash>.json export"
tech-stack:
  added: []
  patterns:
    - "caller-owns-store: main() opens/closes the store; compare.mjs never touches one"
    - "path-traversal sanitization: [A-Za-z0-9._-] allowlist + resolved-path containment assertion"
    - "entry-point guard + named exports so tests import pure helpers without running main"
key-files:
  created:
    - "scripts/experiments-compare.mjs (~320 lines) — the operator CLI + writers + sanitizer"
    - "tests/experiments/experiments-compare.test.mjs (~290 lines) — 11 tests (pure + store-backed integration)"
  modified: []
decisions:
  - "JSON export schema field names FROZEN (Phase 80 contract): task_hash, rank_by, generated_at, and the four group arrays ranked/failed/ungated/unscored; each VariantEntry carries variant, n, gate_outcome (passed|failed|ungated|unscored), optional rank/composite/reason, and the metrics block with {mean,stddev,median,min,max,n} per metric."
  - "gate_outcome is derived from the group a variant lands in (ranked→passed, failed→failed, ungated→ungated, unscored→unscored) rather than a per-run re-read — the aggregator already partitioned by the persisted gate_passed."
  - "sanitizeTaskHash allowlist = ^[A-Za-z0-9._-]+$; rejects empty/non-string, '/', '\\', '..', and null byte. resolveReportPath additionally asserts the resolved path stays strictly under .data/experiments/reports/ (defense-in-depth)."
  - "writers accept an optional { repoRoot } override so tests write to a throwaway tmp dir and never touch the real .data/experiments/reports/."
metrics:
  duration: "~20 min"
  completed: 2026-07-13
  tasks: 2
  files: 2
---

# Phase 79 Plan 03: Comparison Report CLI Summary

The `scripts/experiments-compare.mjs` operator CLI — the CMP-03 surface and the 79→80 seam. It opens the experiment store, drives `readRuns → buildComparison` (Plan 02), renders a ranked human-readable table to stdout, and writes the canonical machine-readable JSON export to `.data/experiments/reports/<task_hash>.json` (the stable contract Phase 80's dashboard variant columns consume without re-running the experiment). `--csv` opt-in additionally writes CSV; `--rank-by tokens|wallclock|score|composite` overrides the default composite. `task_hash` is sanitized (allowlist + resolved-path containment) before it becomes a filename.

## What Was Built

**Task 1 — sanitizer + JSON/CSV writers (TDD)**
- `sanitizeTaskHash(h)` — `^[A-Za-z0-9._-]+$` allowlist; throws on empty/non-string, `/`, `\`, `..`, null byte.
- `resolveReportPath(hash, ext, repoRoot)` — sanitizes then asserts the resolved path stays strictly under `.data/experiments/reports/` (defense-in-depth over the allowlist).
- `writeReportJson(report, taskHash, {repoRoot?})` — `mkdirSync` recursive, serializes the frozen schema (per-variant `gate_outcome` + full `{mean,stddev,median,min,max,n}` block + `rank` + the four groupings), returns the written path.
- `writeReportCsv(report, taskHash, {repoRoot?})` — opt-in, one CSV row per variant (variant, rank, n, gate_outcome, composite, tokens mean/stddev, wallclock mean, rubric mean), CSV-escaped.

**Task 2 — main() + ranked table + integration test**
- `renderTable(report)` — ranked winners section + a DISTINCT "FAILED / no successful runs" (plus UNGATED / UNSCORED) section so an all-fail variant is visibly not a winner.
- `main()` — mirrors experiments-query.mjs: `--task-hash` (required → error to stderr + exit 2), `--rank-by` (default `composite`), boolean `--csv`; caller-owns-store `openExperimentStore()` → `readRuns` → `buildComparison` → `renderTable` (stdout) → `writeReportJson` (+ conditional `writeReportCsv`); `finally await store.close()`. Entry-point guard + named exports.
- Store-backed integration test: seeds synthetic Run+Score+Outcome entities (2 complete+gate_passed variants, 1 gate_passed=false, 1 timeout) sharing a task_hash, runs the real pipeline, and asserts the JSON export path, the failed/timeout variants land in the non-ranked section (JSON + table), `--rank-by tokens` reorders, `--csv` writes the CSV, and a traversal hash is rejected.

## STABLE JSON Export Schema (Phase 80 contract — DO NOT rename fields)

```
{
  "task_hash":    string,                       // report key (D-13)
  "rank_by":      "composite"|"tokens"|"wallclock"|"score",
  "generated_at": string,                       // ISO-8601 UTC write time
  "ranked":   VariantEntry[],   // successful-gated+scored, sorted by rank_by; each has .rank + .composite
  "failed":   VariantEntry[],   // gate_passed===false OR terminal timeout/abort ("no successful runs")
  "ungated":  VariantEntry[],   // gate_passed===null (no test_command) — shown, not ranked
  "unscored": VariantEntry[]    // successful+gated but null/zero rubric — shown, not ranked
}

VariantEntry = {
  "variant":      string,
  "n":            number,                        // repeat count of the aggregated runs (D-10)
  "gate_outcome": "passed"|"failed"|"ungated"|"unscored",   // per-variant success-gate outcome (D-13)
  "rank"?:        number,                         // 1-based; ranked group only
  "composite"?:   number,                         // ranked only: totalTokens.mean / rubric_score.mean
  "reason"?:      string,                          // failed/ungated/unscored group only
  "metrics": {                                    // per-metric {mean,stddev,median,min,max,n}, nulls excluded
    "totalTokens", "wallclock",
    "loop_count", "edit_revert_count", "redundant_read_count",
    "abandoned_tool_count", "total_step_count", "wallclock_per_step",
    "rubric_score",
    "goal_achieved", "code_quality", "test_coverage", "regressions", "spec_drift"
  }
}
```

The composite denominator is `score.goal_aligned_ratio` alone (D-08, resolved in 79-02); the 5 locked rubric dims are still surfaced in the variance block. `gate_outcome` is added by the CLI (the aggregator returns the four group arrays; the CLI stamps the enum on each entry).

## sanitizeTaskHash Allowlist

`^[A-Za-z0-9._-]+$`. Rejected: empty/non-string, any `/` or `\`, any `..` substring, any null byte. Additionally, `resolveReportPath` asserts `path.resolve(<file>)` equals the reports-dir-joined path AND starts with `<reportsDir>/` — so even a value the regex somehow admitted cannot escape the reports directory.

## Verification

- `node --test tests/experiments/experiments-compare.test.mjs` → `# tests 11 / # pass 11 / # fail 0`.
- Exports present: `sanitizeTaskHash`, `writeReportJson`, `writeReportCsv`, `renderTable`.
- Ran end-to-end against a real store task_hash (`d4164dca…`): rendered the table, grouped 3 variants under FAILED + 1 under UNGATED, and wrote the JSON export (demo artifact removed — `.data/experiments/reports/` is runtime output, not committed).
- `--task-hash '../../etc/passwd'` → FATAL, exit 1, no write. Missing `--task-hash` → error to stderr, exit 2.
- No `console.*` calls (the only `console`/`GraphKMStore` textual hits are the JSDoc "no console.* / NEVER new GraphKMStore" prohibition notes). Opens the store only via `openExperimentStore()`, closes in `finally`; never `new GraphKMStore`.

## Deviations from Plan

None — plan executed as written. Claude's-discretion resolutions the plan delegated:
1. **Table columns** — rank/variant/n/composite/tokens(mean±sd)/rubric(mean) for the ranked group; variant/n/tokens(mean)/reason for the non-ranked groups.
2. **gate_outcome enum** added by the CLI (not on the aggregator's VariantEntry) so the JSON explicitly carries each variant's success-gate outcome (D-13) without changing the 79-02 report object.
3. **`{ repoRoot }` writer override** — lets the integration test write to a throwaway tmp dir; production calls omit it and default to the real repo root.

## Threat Mitigations Applied

- **T-79-03-01** (Tampering — task_hash → report path): `sanitizeTaskHash` allowlist + `resolveReportPath` containment assertion; asserted by the traversal-rejection tests (`writeReportJson` refuses `'../../etc/passwd'`, and nothing is written outside the reports dir).
- **T-79-03-02** (EoP — shell exec): none introduced; the CLI does read + pure aggregate + file write only, and reuses the persisted `gate_passed` (the gate is NOT re-run).
- **T-79-03-03** (Repudiation — 79→80 schema drift): schema documented in the CLI header + this SUMMARY; the integration test asserts `gate_outcome`, the variance block, `rank`, and the group keys — a rename breaks the test.

## Known Stubs

None. The CLI is fully wired to the real `readRuns`/`buildComparison` path; the store-backed integration test exercises the ranked + failed/timeout groupings against synthetic gate-persisted fixtures, and a manual run against a live task_hash produced a real JSON export.

## Notes for Downstream (Phase 80)

- Consume `.data/experiments/reports/<task_hash>.json` — do NOT re-run the experiment. The field names above are frozen.
- `gate_outcome` (`passed|failed|ungated|unscored`) is the per-variant column to surface; `ranked` is already sorted by `rank_by` with `rank` (1-based) + `composite`.
- Regenerate a report with `node scripts/experiments-compare.mjs --task-hash <h> [--rank-by tokens|wallclock|score] [--csv]`.

## Self-Check: PASSED

- FOUND: scripts/experiments-compare.mjs
- FOUND: tests/experiments/experiments-compare.test.mjs
- FOUND commit a8f0d408c (test RED gate)
- FOUND commit c9490370d (feat GREEN gate)
