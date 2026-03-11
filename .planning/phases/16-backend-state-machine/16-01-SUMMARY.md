---
phase: 16-backend-state-machine
plan: 01
subsystem: workflow
tags: [state-machine, singleton, subscriber, progress-file, tdd]

requires:
  - phase: 15-type-definitions
    provides: WorkflowState discriminated union, transition function, InvalidTransitionError, RunConfig/RunProgress schemas
provides:
  - State machine singleton (getState, dispatch, subscribe, reset)
  - Progress file subscriber factory (createProgressFileSubscriber)
  - tools.ts integration (getState for status, dispatch for cancel/start)
  - workflow-runner.ts integration (subscriber registration, dispatch for complete/fail)
affects: [16-02-wave-controller, 17-sse-events, 18-dashboard-consumer, 19-migration]

tech-stack:
  added: []
  patterns: [singleton-state-machine, subscriber-pattern, cross-process-progress-file]

key-files:
  created:
    - integrations/mcp-server-semantic-analysis/src/workflow-state-machine.ts
    - integrations/mcp-server-semantic-analysis/src/workflow-state-machine.test.ts
    - integrations/mcp-server-semantic-analysis/src/shared/workflow-types/ (local copy)
  modified:
    - integrations/mcp-server-semantic-analysis/src/tools.ts
    - integrations/mcp-server-semantic-analysis/src/workflow-runner.ts
    - shared/workflow-types/state.ts
    - shared/workflow-types/transitions.ts
    - shared/workflow-types/derived.ts

key-decisions:
  - "Cross-process state: MCP server and workflow-runner have separate singleton instances; progress file is cross-process bridge"
  - "Legacy writeProgress/writeProgressPreservingDetails kept as @deprecated for dashboard backward compat until phase-19"
  - "Heartbeat intervals removed -- subscriber writes on every transition serve as natural heartbeats"

patterns-established:
  - "Subscriber pattern for state persistence: createProgressFileSubscriber writes on every transition"
  - "State machine import path: local copy via copy-shared-types.sh, not relative path to repo root"
  - "Dispatch with InvalidTransitionError catch for resilient state transitions"

requirements-completed: [BE-02, BE-03, BE-04]

duration: 9min
completed: 2026-03-11
---

# Phase 16 Plan 01: State Machine Singleton Summary

**Singleton state machine with getState/dispatch/subscribe/reset, progress file subscriber, and integration into tools.ts health API and workflow-runner.ts**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-11T05:40:16Z
- **Completed:** 2026-03-11T05:49:45Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments
- Created state machine singleton with getState/dispatch/subscribe/reset/createProgressFileSubscriber exports
- tools.ts now queries getState() for in-process workflow status and uses dispatch() for cancel and workflow start
- workflow-runner.ts registers progress file subscriber and uses dispatch() for complete/fail transitions
- Heartbeat intervals removed (transitions serve as natural heartbeats)
- writeProgress/writeProgressPreservingDetails marked @deprecated for Plan 02 cleanup
- All 8 TDD tests passing, TypeScript compiles clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Create state machine singleton with progress file subscriber** (TDD)
   - `0eecdc8` (test) - Failing tests for singleton
   - `959a347` (feat) - Implement singleton module, all 8 tests pass
2. **Task 2: Update health API and workflow-runner to use state machine**
   - `188c21f` (feat, submodule) - tools.ts and workflow-runner.ts integration
   - `815ec077` (fix, parent) - Zod 4 compat fixes in shared types, submodule pointer update

## Files Created/Modified
- `integrations/mcp-server-semantic-analysis/src/workflow-state-machine.ts` - Singleton with getState, dispatch, subscribe, reset, createProgressFileSubscriber
- `integrations/mcp-server-semantic-analysis/src/workflow-state-machine.test.ts` - 8 tests covering lifecycle, subscribers, progress file writes
- `integrations/mcp-server-semantic-analysis/src/tools.ts` - getState() for status queries, dispatch() for cancel/start
- `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts` - Subscriber registration, dispatch for complete/fail, heartbeat removal
- `integrations/mcp-server-semantic-analysis/src/shared/workflow-types/` - Local copy of shared types for rootDir compatibility
- `shared/workflow-types/state.ts` - z.record Zod 4 fix
- `shared/workflow-types/transitions.ts` - z.record Zod 4 fix
- `shared/workflow-types/derived.ts` - CancelledState derivation fix (no progress field)

## Decisions Made
- Cross-process state: The MCP server process and the detached workflow-runner process each have their own singleton instance. The progress file written by the subscriber serves as the cross-process communication mechanism. getState() is authoritative for in-process (sync) workflows.
- Legacy functions kept with @deprecated: writeProgress and writeProgressPreservingDetails retained with deprecation notice for backward compatibility with dashboard. Full removal in Phase 19.
- Import paths use local copy: copy-shared-types.sh copies shared types into src/shared/workflow-types/ to satisfy tsconfig rootDir constraint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Zod 4 z.record() requires two arguments**
- **Found during:** Task 2 (TypeScript compilation)
- **Issue:** shared/workflow-types used `z.record(z.unknown())` which is invalid in Zod 4 (requires key schema)
- **Fix:** Changed to `z.record(z.string(), z.unknown())` in state.ts and transitions.ts
- **Files modified:** shared/workflow-types/state.ts, shared/workflow-types/transitions.ts
- **Verification:** TypeScript compiles clean
- **Committed in:** 815ec077

**2. [Rule 1 - Bug] CancelledState.progress doesn't exist**
- **Found during:** Task 2 (TypeScript compilation)
- **Issue:** derived.ts referenced `state.progress.completedSteps` in cancelled case, but CancelledState has no progress field
- **Fix:** Replaced with best-effort derivation using `state.lastStep` to mark steps up to cancellation point
- **Files modified:** shared/workflow-types/derived.ts
- **Verification:** TypeScript compiles clean
- **Committed in:** 815ec077

**3. [Rule 3 - Blocking] rootDir prevents imports from outside src/**
- **Found during:** Task 1 (import paths)
- **Issue:** tsconfig rootDir=./src prevents relative imports to repo-root shared/workflow-types/
- **Fix:** Used copy-shared-types.sh to copy shared types into src/shared/workflow-types/, updated import paths
- **Files modified:** workflow-state-machine.ts, workflow-state-machine.test.ts, tools.ts, workflow-runner.ts
- **Verification:** TypeScript compiles clean, all tests pass
- **Committed in:** 188c21f (submodule)

---

**Total deviations:** 3 auto-fixed (1 bug, 2 blocking)
**Impact on plan:** All fixes necessary for correctness and compilation. No scope creep.

## Issues Encountered
- Submodule git workflow requires committing inside the submodule first, then updating the parent repo pointer

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- State machine singleton ready for Plan 02 (wave-controller migration)
- All ~30 updateProgress() calls in wave-controller.ts can now be replaced with dispatch() calls
- Progress file subscriber is registered and writes on every transition
- Phase 17 (SSE events) can add a second subscriber for real-time streaming

## Self-Check: PASSED

All 5 key files found. All 4 commits verified (2 in submodule, 1 in parent, 1 parent pointer update).

---
*Phase: 16-backend-state-machine*
*Completed: 2026-03-11*
