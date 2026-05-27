---
phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
plan: 14
subsystem: live-logging
tags: [phase-51, gap-closure, claude, cr-03, registry, observations-written, atomic-upsert]

# Dependency graph
requires:
  - phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as
    provides: "Plan 51-01 registry (createRegistry, upsert, get, markCompleted) + Plan 51-07 startClaudeWatcher pipeline (pushExchangeIfReady → processMessages → upsert → markCompleted)"
provides:
  - "Fixed observations_written increment in lib/lsl/live/claude-fs-watch.mjs — single atomic upsert replaces the broken get()+upsert({})+mutate-cur pattern"
  - "Mid-tail observability of observations_written restored — heartbeat / registry-reader / future health-coordinator now read accurate counts during a sub-agent's lifetime"
  - "tests/integration/claude-fs-watch-observations-written.test.js — 5-test regression spec locking the CR-03 fix"
affects: [phase-51-11, phase-51-close-gates, future-health-coordinator-queries]

# Tech tracking
tech-stack:
  added: []  # NONE — zero new packages (T-51-14-SC mitigation)
  patterns:
    - "Atomic-upsert pattern for counter increments on Plan 51-01 registry — never call get() then mutate-by-reference (the upsert internally creates a new merged object and replaces the Map slot, orphaning the prior reference)"

key-files:
  created:
    - tests/integration/claude-fs-watch-observations-written.test.js
    - .planning/phases/51-…/51-14-SUMMARY.md
  modified:
    - lib/lsl/live/claude-fs-watch.mjs

key-decisions:
  - "Chose Option A (single atomic upsert) over Option B (new registry.incrementObservationsWritten() helper) — minimal surface, no API extension, fix lives entirely in the caller file. Comment block referencing the fabricated 'overrideable list' mechanism removed."

patterns-established:
  - "Atomic-upsert counter pattern on Plan 51-01 registry: always pass the incremented value through the upsert payload; never `const cur = registry.get(...)` then mutate `cur.field` after a subsequent `registry.upsert()` call — the upsert replaces the Map slot, orphaning `cur`."

requirements-completed: []  # Plan has no requirements: field (gap-closure plan)

# Metrics
duration: ~15min
completed: 2026-05-27
---

# Phase 51 Plan 14: CR-03 — observations_written atomic upsert (Plan 51-14) Summary

**Single-atomic-upsert fix for `lib/lsl/live/claude-fs-watch.mjs` — replaces the stale-Map-reference mutation that left `observations_written` permanently at 0 for any mid-tail reader; 5-test regression spec locks the contract.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-27T11:09Z (approx — orchestrator-spawned)
- **Completed:** 2026-05-27T11:24Z
- **Tasks:** 1 (single-task gap-closure plan)
- **Files modified:** 1 (claude-fs-watch.mjs)
- **Files created:** 1 (tests/integration/claude-fs-watch-observations-written.test.js)

## Accomplishments

- **CR-03 closed.** The broken `get(); upsert({}); cur.observations_written = …` block in `lib/lsl/live/claude-fs-watch.mjs:514-527` is now a single atomic upsert that inlines `observations_written: (cur.observations_written || 0) + 1`. The Map slot is replaced with a row that has the new counter — visible to all downstream readers (heartbeat, registry-reader, future health-coordinator queries).
- **Misleading "overrideable list" comment removed.** The prior comment block (lines 520-522) claimed `observations_written` is "preserved by upsert (it's not in the overrideable list)" — no such allowlist mechanism exists in `lib/lsl/registry.mjs`; the upsert spread `{...existing, ...row}` preserves any field whose key isn't in `row`. The comment fabricated a registry mechanism that doesn't exist and is now gone.
- **5-test regression suite added** at `tests/integration/claude-fs-watch-observations-written.test.js` — covers (1) direct atomic-upsert increment to 10, (2) markCompleted reads the real count not the exchangesEmitted fallback, (3) end-to-end via real `startClaudeWatcher` + synthetic JSONL fixture, (4) removed-comment grep, (5) no-regression grep on the atomic-upsert pattern. All 5 pass.
- **Phase 51 D-Reuse cumulative gate clean** — zero new npm packages (T-51-14-SC mitigation).
- **All 10 prior Plan 51-07 `tests/live-logging/live-claude-fs-watch.test.js` tests still pass.** All 12 Plan 51-01 `tests/live-logging/sub-agent-registry.test.js` tests still pass.

## Task Commits

1. **Task 1: Fix observations_written stale-reference mutation + regression test** — `bfbe11f3b` (`fix(51-14): atomic upsert for observations_written increment (closes CR-03)`)

Only one commit landed because the fix is a single-file diff and the test file is created in the same logical change-set. Plan acceptance criteria allow "1 or 2 commits depending on Option chosen" — Option A produced 1.

## Files Created/Modified

- **modified** `lib/lsl/live/claude-fs-watch.mjs` — replaced the 14-line broken increment block (lines 514-527) with an 8-line atomic upsert + a multi-line comment explaining the prior bug and the fix. The atomic upsert inlines `observations_written: (cur.observations_written || 0) + 1` into the upsert payload, eliminating the orphaned-reference mutation.
- **created** `tests/integration/claude-fs-watch-observations-written.test.js` — 5 tests, ~270 lines. Uses the same jest+ESM + `@jest/globals` + stderr-spy harness as `tests/live-logging/live-claude-fs-watch.test.js` (Plan 51-07). Includes a real-watcher end-to-end test that drives a synthetic JSONL fixture through `startClaudeWatcher` → tail → onMessage → ObservationWriter and asserts `row.observations_written > 0` BEFORE `markCompleted` fires.

## Decisions Made

- **Option A (single atomic upsert) chosen over Option B (new registry helper).** Rationale: Option A keeps the diff localized to the broken file, requires no API extension to `lib/lsl/registry.mjs`, and matches the recommended approach in the plan. Option B's `incrementObservationsWritten()` would be a cleaner encapsulation but is unnecessary for a single caller — YAGNI applies until a second caller needs the same operation.

## Deviations from Plan

None — plan executed exactly as written. Option A was the recommended path; no Rule 1/2/3 fixes were needed; no Rule 4 architectural decisions arose.

A pre-existing test failure in `tests/integration/agent-adapters.test.js` (it imports `vitest` in a jest-only project — `Cannot find module 'vitest'`) was discovered during the AC5 sweep. Per SCOPE BOUNDARY rule this is out of scope (not caused by this task's changes) and is logged here as a deferred item. The plan's acceptance specifically cites `tests/integration/agent-adapters.test.js` for Plan 51-07's regression suite; that test was already broken before Plan 51-14 touched any file. **Deferred — would need a vitest-to-jest port or a vitest devDependency add in a separate plan.**

## Behavior Change (documented per plan instructions)

The markCompleted truthy check at `lib/lsl/live/claude-fs-watch.mjs:543-545`:

```js
opts.registry.markCompleted('claude', subHash, {
  observations_written: row && row.observations_written ? row.observations_written : exchangesEmitted,
  ...
});
```

Pre-fix: `row.observations_written` was always `0` (the stale-ref mutation never reached the Map), so the truthy check failed and the fallback `exchangesEmitted` was passed — final value was right by accident.

Post-fix: `row.observations_written` is the running counter (e.g. 7), the truthy check succeeds, and the REAL count is passed.

These two values are usually equal but can diverge if some exchange writes errored mid-pipeline — the writer try/catch at lines 528-533 only increments the counter on success, while `exchangesEmitted` is incremented inside `pushExchangeIfReady()` regardless of writer outcome. The post-fix value is more accurate (reflects what was actually written) and matches intent. **Per the plan's threat model this is `T-51-14-BC` with disposition `accept` — documented behavior change.**

## Issues Encountered

- **Test 3 initial failure: `expect(writer.calls.length).toBeGreaterThanOrEqual(1)` got 0.** Root cause: my first draft used `0bs0bs012345abcde` as the agentId, but `SUBAGENT_PATH_RE` in `lib/lsl/adapters/claude-jsonl-tree.mjs` requires `[a-f0-9]+` — the letters `b` and `s` (in `0bs0bs0`) are not all valid hex. The watcher silently rejected the path. Fix: switched to `0b50b5012345abcde` (valid hex), Test 3 then passed. The test now passes reliably (2113ms — within the 5s tail-poll window).

## Phase 51 D-Reuse Cumulative Gate

Per CONTEXT.md D-Reuse the cumulative new-dependency budget for Phase 51 is **zero**. Plan 51-14 adds:

- **0 new npm packages**
- **0 new external services**
- **0 new MCP servers**

The new test file uses only `@jest/globals`, `node:fs`, `node:os`, `node:path`, `node:process` — all already in `package.json` (or built-in). The fix in `claude-fs-watch.mjs` uses only the existing `opts.registry.upsert` surface.

**D-Reuse gate: CLEAN.**

## Threat Model Closure

| Threat ID | Disposition | Closure evidence |
|-----------|-------------|------------------|
| T-51-14-OB (mid-tail observability of observations_written) | mitigate | Atomic upsert + Test 3 (end-to-end) + Test 1 (10-cycle direct upsert) |
| T-51-14-DOC (misleading "overrideable list" comment) | mitigate | Comment removed; Test 4 (grep) locks the removal |
| T-51-14-BC (markCompleted accurate vs. accidentally-right) | accept | Documented above under "Behavior Change" |
| T-51-14-SC (npm dependencies) | accept | Zero new packages; D-Reuse gate clean |

## Next Phase Readiness

- **CR-03 closed.** Phase 51 close gates (REVIEW.md / VERIFICATION.md) can advance.
- **Mid-tail `observations_written` observability is now correct** — Plan 51-11's heartbeat surface, the registry-reader extensions from Plan 51-10, and any future health-coordinator queries will see real-time counts instead of permanent 0.
- **No new blockers introduced.**
- **Deferred item (out of scope for 51-14):** `tests/integration/agent-adapters.test.js` references the missing `vitest` module — pre-existing test infrastructure mismatch, needs a separate plan to either port the file to `@jest/globals` or add `vitest` as a devDependency.

## Self-Check

- File `lib/lsl/live/claude-fs-watch.mjs` exists: FOUND
- File `tests/integration/claude-fs-watch-observations-written.test.js` exists: FOUND
- Commit `bfbe11f3b`: FOUND in `git log --all`
- AC1 (`grep -E '(incrementObservationsWritten|observations_written:\s*\(cur\.observations_written)' lib/lsl/live/claude-fs-watch.mjs`): 1 match (>= 1 PASS)
- AC2 (`grep -c 'overrideable list' lib/lsl/live/claude-fs-watch.mjs`): 0 (PASS)
- AC3 (test file with `toBeGreaterThan(0)` assertion): 2 assertions found (PASS)
- AC4 (all tests pass): 5/5 pass (PASS)
- AC5 (Plan 51-07 regression tests still green): 10/10 pass (PASS); Plan 51-01 registry tests 12/12 pass (PASS)
- AC6 (console.* count not increased): 0 in both files (baseline 0, PASS)

## Self-Check: PASSED

---
*Phase: 51-gsd-wave-execution-sub-agent-transcripts-are-not-captured-as*
*Plan: 14*
*Completed: 2026-05-27*
