---
phase: 72-syntactic-route-quality
plan: 02
subsystem: experiments / route-quality
tags: [route-01, goal-sentence, zero-llm, tdd]
requires:
  - "SpanRecord.goal_sentence field (Phase 71)"
  - "PLAN.md / ROADMAP.md '**Goal**:' line convention"
provides:
  - "lib/experiments/goal-sentence.mjs :: deriveGoalSentence({ phase, planPath?, roadmapPath? })"
affects:
  - "Plan 05 wires deriveGoalSentence into scripts/measurement-stop.mjs (--goal/--phase seam)"
tech-stack:
  added: []
  patterns:
    - "Pure zero-LLM fs.readFileSync + anchored /m regex extraction"
    - "Fail-soft: try/catch returns '' on any read failure (D-05 no-hard-block)"
key-files:
  created:
    - "lib/experiments/goal-sentence.mjs"
    - "tests/experiments/goal-sentence.test.mjs"
    - "tests/fixtures/route/sample-PLAN.md"
    - "tests/fixtures/route/sample-ROADMAP.md"
  modified: []
decisions:
  - "PLAN.md is primary source; ROADMAP '### Phase {n}:' block is fallback (D-03)"
  - "Missing/empty source yields '' and NEVER throws — caller quarantines headless (D-05)"
  - "ROADMAP block bounded at the next '### ' heading (index-slice, no \\Z anchor) so adjacent phase goals are not mismatched"
  - "phase arg normalized to leading numeric token — accepts number, numeric string, or '72-name' slug"
metrics:
  duration: ~12m
  completed: 2026-06-24
  tasks: 1
  files: 4
---

# Phase 72 Plan 02: deriveGoalSentence zero-LLM goal extractor Summary

Zero-LLM `goal_sentence` extractor for /gsd runs (ROUTE-01, D-03): `deriveGoalSentence` reads the active phase PLAN.md `**Goal**:` line as the primary source, falls back to the matching `### Phase {n}:` block's `**Goal**:` line in ROADMAP.md, and returns `''` (never throws) when no source exists so the close orchestrator can quarantine a headless run per D-05.

## What Was Built

- **`lib/experiments/goal-sentence.mjs`** — exports `deriveGoalSentence({ phase, planPath?, roadmapPath? })`. Pure `fs.readFileSync` + an anchored `/^\s*\*\*Goal\*\*:\s*(.+?)\s*$/m` regex. Three-step resolution: (1) PLAN.md primary, (2) ROADMAP phase-block fallback, (3) `''`. All reads wrapped in try/catch returning `''`. Diagnostics gated behind `GOAL_SENTENCE_DEBUG` and written to `process.stderr` (no `console.*`).
- **`tests/experiments/goal-sentence.test.mjs`** — 10 node:test cases: PLAN primary, PLAN-wins-over-ROADMAP precedence, ROADMAP fallback, correct-phase-block selection (not adjacent phases), string/slug phase arg, both-missing → `''`, no-args → `''`, PLAN-without-marker → ROADMAP fallback, whitespace/trailing-period trim, and a sync-return (zero-async) assertion.
- **Fixtures** — `tests/fixtures/route/sample-PLAN.md` (one `**Goal**:` line) and `tests/fixtures/route/sample-ROADMAP.md` (Phase 71/72/73 blocks to prove block-precise selection).

## TDD Gate Compliance

- **RED** — `test(72-02): add failing tests…` (`599d7170e`) — suite failed with `ERR_MODULE_NOT_FOUND` (module absent), the correct RED reason.
- **GREEN** — `feat(72-02): implement deriveGoalSentence…` (`23c17d494`) — all 10 tests pass, exit 0.
- **REFACTOR** — not needed (implementation was clean; only an inline dead-`blockRe` comment was removed before the GREEN commit and a header comment reworded to satisfy the `grep -c "console\." == 0` acceptance gate).

## Verification

- `node --test tests/experiments/goal-sentence.test.mjs` → 10 pass / 0 fail, exit 0.
- `grep -n "deriveGoalSentence" lib/experiments/goal-sentence.mjs` → export present (line 97).
- `grep -n "Goal" lib/experiments/goal-sentence.mjs` → `**Goal**:` regex marker present.
- `grep -c "console\." lib/experiments/goal-sentence.mjs` → `0`.
- `grep -rn "fetch|http|llm|complete" lib/experiments/goal-sentence.mjs` → none (zero-LLM, no network).
- Empty-source case asserted to return `''` without throwing (two dedicated tests).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `grep -c "console\." == 0` acceptance gate vs. explanatory comment**
- **Found during:** Task 1 acceptance verification.
- **Issue:** The module's header comment originally contained the literal `console.*` (explaining the no-console-log rule), which made `grep -c "console\."` return `1` and would fail the acceptance gate.
- **Fix:** Reworded the comment to "the no-console-log rule (CLAUDE.md) forbids the stdout/err logging family here." — no behavior change; `grep -c "console\."` now returns `0`. Folded into the GREEN commit.
- **Files modified:** `lib/experiments/goal-sentence.mjs`
- **Commit:** `23c17d494`

## Known Stubs

None. The extractor is fully functional. The wiring into `scripts/measurement-stop.mjs` is intentionally deferred to Plan 05 (single-file ownership of `measurement-stop.mjs`), as specified in the plan objective — this is not a stub but a planned separation.

## Self-Check: PASSED

- FOUND: lib/experiments/goal-sentence.mjs
- FOUND: tests/experiments/goal-sentence.test.mjs
- FOUND: tests/fixtures/route/sample-PLAN.md
- FOUND: tests/fixtures/route/sample-ROADMAP.md
- FOUND commit: 599d7170e (RED)
- FOUND commit: 23c17d494 (GREEN)
