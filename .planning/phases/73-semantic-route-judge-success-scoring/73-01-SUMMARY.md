---
phase: 73-semantic-route-judge-success-scoring
plan: 01
subsystem: experiments
tags: [route-judge, consequential-events, goal-aligned-ratio, esm, node-test, zero-llm]

# Dependency graph
requires:
  - phase: 72-route-heuristics
    provides: RouteEvent schema (lib/lsl/route/route-event.mjs) + route-heuristics.mjs frozen-set/null-not-zero patterns
provides:
  - isConsequentialTool / CONSEQUENTIAL_TOOLS classifier (acting vs navigation/read)
  - filterConsequential(trace) shared projection (seq-order preserving)
  - isTrivialRun(trace) + TRIVIAL_THRESHOLD zero-LLM trivial-run guard (D-04)
  - computeGoalAlignedRatio(labels) toward/(toward+away), neutral-excluded, null-not-zero (D-02)
affects: [73-04-judge, 73-close-orchestrator, route-success-scoring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Frozen-set classifier (Object.freeze) mirroring route-heuristics.mjs HEURISTIC_KEYS"
    - "null-not-zero degradation contract: empty/all-neutral => null, never coerced to 0"
    - "Pure ESM zero-dependency route primitive (only node:process for logging discipline)"

key-files:
  created:
    - lib/experiments/consequential-events.mjs
    - tests/experiments/consequential-events.test.mjs
    - tests/fixtures/route/consequential-mixed.json
  modified: []

key-decisions:
  - "CONSEQUENTIAL_TOOLS = Edit/Write/MultiEdit/NotebookEdit/Bash/Task (union of agent-native acting tools)"
  - "Unknown/non-string tool names default to non-consequential (navigation), keeping the set a strict allow-list"
  - "Unknown labels excluded from ratio counts (treated like neutral), so only explicit toward/away move the ratio"

patterns-established:
  - "Pattern: zero-LLM trivial-run detection via filterConsequential length threshold"
  - "Pattern: deterministic ratio math in code, never trusting LLM arithmetic (ROUTE-03 reproducibility)"

requirements-completed: [ROUTE-03]

# Metrics
duration: 8min
completed: 2026-06-28
---

# Phase 73 Plan 01: Consequential-Event Classifier & Goal-Aligned Ratio Summary

**Pure zero-LLM route primitives: a frozen acting-tool classifier, a shared consequential-event filter, a trivial-run guard, and the toward/(toward+away) neutral-excluded ratio with null-not-zero degradation.**

## Performance

- **Duration:** ~8 min
- **Completed:** 2026-06-28
- **Tasks:** 2
- **Files modified:** 3 (all created)

## Accomplishments
- `isConsequentialTool` / `CONSEQUENTIAL_TOOLS` separate acting tool calls (Edit/Write/MultiEdit/NotebookEdit/Bash/Task) from navigation/reads — frozen, immutable contract
- `filterConsequential(trace)` shared seq-order-preserving projection used by both the trivial-run guard and the judge input
- `isTrivialRun(trace)` + `TRIVIAL_THRESHOLD` detect a ≈zero-consequential run with NO LLM call (D-04)
- `computeGoalAlignedRatio(labels)` computes `toward/(toward+away)` deterministically, excludes neutral from the denominator, and returns `null` (not `0`) when the denominator is zero (threat T-73-01-COERCE mitigated)
- 19-case cross-agent fixture suite (claude/copilot/opencode) — all green

## Task Commits

1. **Task 1: consequential-events.mjs classifier + filter + ratio math** - `adc5d6244` (feat)
2. **Task 2: fixture test suite for classifier + ratio math** - `3e0fded11` (test)

_Note: Task 1 is `tdd="true"`; module and its fixture suite (Task 2) committed as feat then test per plan task order._

## Files Created/Modified
- `lib/experiments/consequential-events.mjs` - The 4 pure primitives (classifier, filter, trivial guard, ratio); 136 lines, no console.*, no km-core/node:fs imports
- `tests/experiments/consequential-events.test.mjs` - 19 node:test cases incl. neutral-excluded 2/3 and all-neutral->null true-negatives
- `tests/fixtures/route/consequential-mixed.json` - 7-event cross-agent RouteEvent[] (3 acting, 4 navigation) exercising the classifier

## Decisions Made
- Treated unknown/non-string tool names and unknown labels as non-consequential / excluded respectively — keeps both the tool set and the ratio numerator/denominator strict allow-lists.

## Deviations from Plan

**1. [Rule 3 - Blocking] Reworded module doc comment to satisfy literal acceptance grep**
- **Found during:** Task 1 (acceptance verification)
- **Issue:** The plan acceptance criterion `! grep -E "km-core|node:fs"` is a literal text match. The module's doc comment originally described its purity using the words "km-core" and "node:fs", causing the grep to match the comment even though there is no such import.
- **Fix:** Reworded the comment to "the knowledge-graph core or the filesystem stdlib" so the literal grep passes while the meaning is preserved.
- **Files modified:** lib/experiments/consequential-events.mjs
- **Verification:** `! grep -E "km-core|node:fs"` now returns clean; `node --check` still passes.
- **Committed in:** adc5d6244 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking, doc-comment wording vs literal acceptance grep)
**Impact on plan:** No behavioral change; comment wording only. No scope creep.

## Issues Encountered
None - both tasks executed as specified.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `filterConsequential` and `computeGoalAlignedRatio` are ready for consumption by the judge (73-04) and the close orchestrator.
- No blockers.

---
*Phase: 73-semantic-route-judge-success-scoring*
*Completed: 2026-06-28*
