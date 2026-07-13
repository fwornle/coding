---
status: partial
phase: 87-interactive-spans-and-branch-avenues
source: [87-VERIFICATION.md]
started: 2026-07-13T00:00:00Z
updated: 2026-07-13T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Outcome-score column renders a real numeric score on a non-trivial scored fork
expected: Fork a NON-trivial completed span (one whose judge/rubric assigns a real numeric score, not `not_scored='trivial'`). In the Avenues panel, the Outcome column shows a formatted numeric score (`v.toFixed(2)`) instead of the em-dash for at least one avenue row, and best-first ranking visibly reorders rows by that score (the highest-score row is ordered first / carries the left success-accent border per `avenue-panel.tsx` `isBest` logic), in both light and dark themes.
result: [pending]
why_human: The only live fork exercised (87-08) forked a trivial fizzbuzz task; both avenue Runs scored `not_scored='trivial'`, so `avenueOutcomeScore()` returned null and `fmtScore()` rendered the em-dash by design (honest null-handling, confirmed by source read — `fmtScore` returns `v.toFixed(2)` for a real number). This is a data-availability gap in the one live test, not a wiring defect; the numeric-score render path has not been visually exercised with a non-null value.

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
