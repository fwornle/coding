---
phase: 17-sse-event-typing
plan: 01
subsystem: workflow
tags: [sse, event-stream, discriminated-union, broadcaster, zod, real-time]

requires:
  - phase: 16-backend-state-machine
    plan: 01
    provides: State machine singleton (subscribe, getState, dispatch)
  - phase: 15-type-definitions
    provides: WorkflowState discriminated union, WorkflowTransitionEvent
provides:
  - WorkflowSSEEvent discriminated union (state-change | initial-state) with Zod schema
  - SSEBroadcaster class for client management and SSE formatting
  - /workflow-events endpoint on port 3848 for typed state event streaming
affects: [17-02-deploy-verify, 18-dashboard-consumer, 19-migration]

tech-stack:
  added: []
  patterns: [sse-broadcaster-subscriber, discriminated-union-envelope, text-event-stream-formatting]

key-files:
  created:
    - shared/workflow-types/events.ts
    - integrations/mcp-server-semantic-analysis/src/workflow-sse-broadcaster.ts
    - integrations/mcp-server-semantic-analysis/src/workflow-sse-broadcaster.test.ts
    - integrations/mcp-server-semantic-analysis/src/shared/workflow-types/events.ts
  modified:
    - shared/workflow-types/index.ts
    - integrations/mcp-server-semantic-analysis/src/shared/workflow-types/index.ts
    - integrations/mcp-server-semantic-analysis/src/sse-server.ts

key-decisions:
  - "Two SSE event types (state-change, initial-state) instead of granular per-transition variants -- full state snapshot eliminates client-side state reconstruction"
  - "SSEBroadcaster accepts any object with write/writableEnded/destroyed for testability without Express dependency"
  - "Broadcaster subscribed at module load in sse-server.ts to capture all transitions from server start"

patterns-established:
  - "SSE format: event: {type}\\ndata: {json}\\n\\n with JSON envelope containing full WorkflowState"
  - "Broadcaster client lifecycle: addClient sends initial-state, req.on('close') triggers removeClient"
  - "Dead client detection: catch write errors per-client, remove after iteration"

requirements-completed: [SSE-01, SSE-02, SSE-03]

duration: 4min
completed: 2026-03-11
---

# Phase 17 Plan 01: SSE Event Types and Broadcaster Summary

**WorkflowSSEEvent discriminated union with SSEBroadcaster subscriber and /workflow-events endpoint streaming typed state snapshots on every transition**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-11T06:19:51Z
- **Completed:** 2026-03-11T06:24:33Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- Created WorkflowSSEEvent discriminated union on 'event' field with Zod schemas for state-change and initial-state events
- Built SSEBroadcaster class with addClient/removeClient/subscriber/clientCount, formatting events as text/event-stream
- Added /workflow-events GET endpoint to sse-server.ts with SSE headers, heartbeat, and cleanup
- Wired broadcaster to state machine subscriber at module load -- every dispatch() triggers SSE broadcast
- /health endpoint now includes workflowEventClients count
- All 7 unit tests pass, TypeScript compiles clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Define SSE event types and create broadcaster module** (TDD)
   - `3656dd0` (test, submodule) - Failing tests for schema validation and broadcaster behavior
   - `9893bbc` (feat, submodule) - Implement events.ts and broadcaster, all 7 tests pass
   - `96256e86` (feat, parent) - Shared types + submodule pointer update
2. **Task 2: Add /workflow-events endpoint and wire broadcaster**
   - `e65b8dc` (feat, submodule) - /workflow-events endpoint, broadcaster wiring, health count
   - `d7c9c0df` (feat, parent) - Submodule pointer update

## Files Created/Modified
- `shared/workflow-types/events.ts` - WorkflowSSEEvent discriminated union (state-change | initial-state) with Zod schemas
- `shared/workflow-types/index.ts` - Added events.ts exports
- `integrations/mcp-server-semantic-analysis/src/workflow-sse-broadcaster.ts` - SSEBroadcaster class with client management and SSE formatting
- `integrations/mcp-server-semantic-analysis/src/workflow-sse-broadcaster.test.ts` - 7 tests covering schema validation, formatting, client management, error handling
- `integrations/mcp-server-semantic-analysis/src/shared/workflow-types/events.ts` - Local copy of shared events types
- `integrations/mcp-server-semantic-analysis/src/shared/workflow-types/index.ts` - Updated local copy with events exports
- `integrations/mcp-server-semantic-analysis/src/sse-server.ts` - /workflow-events endpoint, broadcaster instantiation and subscriber wiring

## Decisions Made
- Two event types (state-change, initial-state) with full WorkflowState snapshot rather than granular per-transition variants. Clients always get complete state -- no client-side reconstruction needed. The `transition` field on state-change carries the specific event type (start, step-complete, pause, etc.).
- SSEBroadcaster uses a minimal SSEWritable interface (write/writableEnded/destroyed) instead of importing Express Response type. This keeps the broadcaster testable with plain mock objects.
- Broadcaster is subscribed to the state machine at module load time (before Express routes are registered) to ensure no transitions are missed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] JSDoc comment with nested block comment breaks esbuild parser**
- **Found during:** Task 1 (RED phase, test execution)
- **Issue:** `/* reconnect sync */` inside a JSDoc `/** */` block caused esbuild to see premature comment close at `*/`
- **Fix:** Changed inner comment to `// reconnect sync` style
- **Files modified:** shared/workflow-types/events.ts, src/shared/workflow-types/events.ts
- **Verification:** Tests execute successfully
- **Committed in:** 9893bbc (part of GREEN phase commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial comment formatting fix. No scope creep.

## Issues Encountered
- Submodule git workflow requires committing inside the submodule first, then updating the parent repo pointer (same as Phase 16 plans).

## User Setup Required
None - no external service configuration required. Runtime behavior will be verified after Docker deploy in Plan 17-02.

## Next Phase Readiness
- SSE event types and broadcaster are ready for Plan 17-02 (build, deploy, runtime verification)
- /workflow-events endpoint exists in source -- needs `npm run build` + Docker rebuild to go live
- Dashboard (Phase 18) can import WorkflowSSEEvent type from shared/workflow-types/events.ts
- EventSource client in dashboard will connect to /workflow-events and receive typed state snapshots

## Self-Check: PASSED

All 7 key files verified present. All 5 task commits verified in git log.

---
*Phase: 17-sse-event-typing*
*Completed: 2026-03-11*
