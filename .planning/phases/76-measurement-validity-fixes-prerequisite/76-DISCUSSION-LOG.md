# Phase 76: Measurement Validity Fixes [PREREQUISITE] - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-03
**Phase:** 76-measurement-validity-fixes-prerequisite
**Areas discussed:** VALID-01 scope, VALID-02 idle handling, VALID-03 evidence source, VALID-02 idle threshold, VALID-03 test-command source

---

## VALID-01 — Model attribution scope

| Option | Description | Selected |
|--------|-------------|----------|
| Verify + close residual read-paths | Treat Phase-75 stop-path canonical logic as done; verify live + fix only remaining dominant-fallback read-paths | ✓ |
| Re-derive canonical from scratch | Fresh session-model stamp independent of the token-group heuristic | |
| Let me explain what I saw | User has evidence model still wrong on current code | |

**User's choice:** Verify + close residual read-paths
**Notes:** Code scout revealed the canonical fg/bg-split already shipped in `measurement-stop.mjs:335-345` (Phase 75) AND the dashboard already reads `canonical_model`. Only residual is `experiments-recompute-route.mjs:111` (`dominant.model` fallback). Acceptance = live Opus session verification.

---

## VALID-02 — Route time math (idle handling)

| Option | Description | Selected |
|--------|-------------|----------|
| Sum active inter-event gaps, cap outliers | Exclude idle gaps above a threshold; sum active ÷ steps | ✓ |
| Per-event active-duration only | Count only each event's own start→end, ignore all gaps | |
| Wall-clock but flag, don't fix math | Keep raw metric, mark implausible runs for filtering | |

**User's choice:** Sum active inter-event gaps, cap outliers
**Notes:** Directly kills the ~28k s/step artifact while staying deterministic (no LLM).

---

## VALID-03 — Non-GSD rubric evidence source

| Option | Description | Selected |
|--------|-------------|----------|
| Derive from diff + run task test cmd | Run task test command (coverage/regressions) + diff-derived quality signal when GSD artifacts absent | ✓ |
| Diff-only heuristics, no test execution | Stay read-only; score from diff + on-disk lint only | |
| LLM-judge fills gaps from diff | Feed raw diff to the judge to score all 5 dims | |

**User's choice:** Derive from diff + run task test cmd
**Notes:** Reuses the runner's success-gate need (CMP-01). Fits the harness's existing fixed-argv `spawnSync` fail-soft exec idiom.

---

## VALID-02 — Idle threshold

| Option | Description | Selected |
|--------|-------------|----------|
| 5 min gap = idle; no separate cap | Gaps >5 min excluded; no extra outlier cap | |
| 10 min gap = idle | More conservative; keeps longer waits as active | |
| Configurable, default 5 min | Named constant/env knob, default 5 min | ✓ |

**User's choice:** Configurable, default 5 min
**Notes:** Tunable without a code change; 5 min matches AskUserQuestion/steering and existing ETM/health idle heuristics.

---

## VALID-03 — Test-command source

| Option | Description | Selected |
|--------|-------------|----------|
| Run-metadata field, fallback pkg.json test | Optional `test_command` on the run; else repo `package.json` "test" | ✓ |
| package.json test script only | Read only the repo test script; no per-run field | |
| Explicit field only, null if absent | Only run when explicitly provided; no fallback | |

**User's choice:** Run-metadata field, fallback pkg.json test
**Notes:** Forward-compatible with Phase 77's experiment SPEC; works today via pkg.json fallback.

---

## Claude's Discretion
- Exact diff-derived `code_quality` heuristic (features/thresholds), kept deterministic.
- Home of the idle constant (route-heuristics.mjs vs shared config), single named source + env override.
- Test-output parsing specifics — start with the repo's own runners (`node --test`/jest), fail-soft on unrecognized formats.

## Deferred Ideas
- Auto-routing/policy engine consuming the corrected comparisons → v7.6 (`seeds/v74-policy-engine.md`).
- Experiment spec / runner / aggregation / dashboard variant columns → Phases 77–80.
- Formal `/gsd-complete-milestone` close of v7.4 (+ stale-traceability cleanup) → separate housekeeping.
