# Phase 79: Comparison, Aggregation & Report - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-13
**Phase:** 79-comparison-aggregation-report
**Areas discussed:** Success-gate definition, Default ranking metric, Variance measure, Report surface & export

---

## Success-gate definition (CMP-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Complete + test pass | success = terminal_state=='complete' AND test_exit==0; no test_command → ungated (shown, not ranked); timeout/abort → failed (separate) | ✓ |
| Test pass only | Gate purely on test_command exit 0, ignore terminal_state | |
| Complete only | terminal_state=complete IS the success signal; no test_command required | |

**User's choice:** Complete + test pass
**Notes:** Consistent with the "never a false cheap winner" principle — a run must both finish cleanly and pass its task test to be cost-compared. Follow-up: the gate signal is distinct from the judge rubric; planner must confirm where the test outcome is persisted (D-04).

---

## Default ranking metric (CMP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Total tokens, ascending | Cheapest successful variant wins; tiebreak wallclock | |
| Rubric score, descending | Highest-quality variant wins; cost secondary | |
| Composite (cost-per-quality) | total_tokens / rubric_score ASC | ✓ |

**User's choice:** Composite (cost-per-quality)
**Notes:** Balances cost and quality in one default number. Metric is flag-overridable. Raised edge case (null/zero rubric on a successful trivial run) → resolved to a separate "unscored" group, not a divide-by-zero rank (D-07).

---

## Variance measure (CMP-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Median + range + n | Robust at small N; add mean+stddev when n≥5 | |
| Mean + stddev | Classic; noise-dominated at n=2–3 | |
| Both | {mean, stddev, median, min, max, n} for every metric | ✓ |

**User's choice:** Both
**Notes:** Widest export schema — lets the reader/dashboard choose the appropriate statistic. `n` always surfaced.

---

## Report surface & export (CMP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| CLI table + JSON | Ranked CLI table + JSON at .data/experiments/reports/<task_hash>.json; --csv flag | ✓ |
| JSON + CSV both | Always emit both JSON and CSV | |
| JSON only | Machine-readable only, no CLI table | |

**User's choice:** CLI table + JSON
**Notes:** JSON is the canonical artifact Phase 80's dashboard variant-columns consume — schema stability across the 79→80 seam is a hard requirement. CSV opt-in via flag.

## Claude's Discretion

- Exact CLI table column layout/formatting.
- JSON schema field names (must be stable, documented in SUMMARY).
- Module placement (expected `lib/experiments/compare.mjs` + `scripts/experiments-compare.mjs`).

## Deferred Ideas

- Dashboard variant columns (CMP-04) → Phase 80.
- Installed `experiment run` cross-agent skill (ORCH-01) → Phase 80.
- Two low-relevance todos reviewed but not folded (generic keyword matches only).
