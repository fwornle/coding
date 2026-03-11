---
phase: 17-sse-event-typing
plan: 02
subsystem: workflow
tags: [sse, eventsource, websocket, dashboard, real-time, event-forwarding]

requires:
  - phase: 17-sse-event-typing
    plan: 01
    provides: WorkflowSSEEvent types, SSEBroadcaster, /workflow-events endpoint
provides:
  - Dashboard server SSE client consuming /workflow-events typed events
  - WebSocket forwarding of STATE_SNAPSHOT to dashboard clients
  - lastKnownState cache for instant state on WebSocket connect
  - Copied event types in dashboard src/shared/workflow-types/events.ts
affects: [18-dashboard-consumer, 19-migration]

tech-stack:
  added: []
  patterns: [sse-client-http-get, state-snapshot-forwarding, legacy-event-mapping]

key-files:
  created:
    - integrations/system-health-dashboard/src/shared/workflow-types/events.ts
  modified:
    - integrations/system-health-dashboard/src/shared/workflow-types/index.ts
    - integrations/system-health-dashboard/server.js
    - integrations/mcp-server-semantic-analysis/src/shared/workflow-types/index.ts
    - integrations/mcp-server-semantic-analysis/src/shared/workflow-types/state.ts
    - integrations/mcp-server-semantic-analysis/src/shared/workflow-types/transitions.ts
    - integrations/mcp-server-semantic-analysis/src/shared/workflow-types/events.ts
    - integrations/mcp-server-semantic-analysis/src/shared/workflow-types/schemas.ts
    - integrations/mcp-server-semantic-analysis/src/shared/workflow-types/derived.ts
    - docker/Dockerfile.coding-services

key-decisions:
  - "Minimal SSE client via http.get() instead of eventsource npm package -- zero dependency, ~30 lines, auto-reconnect with exponential backoff"
  - "STATE_SNAPSHOT envelope type for typed state forwarding over WebSocket -- dashboard receives full state on every transition"
  - "Legacy event types (WORKFLOW_STARTED etc.) mapped from state.status transitions for backward compat with existing React code"

patterns-established:
  - "SSE client with http.get(): manual parsing of event:/data: lines, buffer until double-newline"
  - "Exponential backoff reconnect: 1s initial, doubling to 30s max, reset on successful connect"
  - "Legacy event mapping from typed state status changes -- removed in Phase 18"

requirements-completed: [SSE-01, SSE-02, SSE-03]

duration: 15min
completed: 2026-03-11
---

# Phase 17 Plan 02: Deploy and Verify SSE Event Pipeline Summary

**Dashboard server SSE client replaces file-polling, forwarding typed WorkflowState snapshots via WebSocket with legacy event mapping for backward compatibility**

## Performance

- **Duration:** 15 min
- **Started:** 2026-03-11T06:27:28Z
- **Completed:** 2026-03-11T06:42:53Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Replaced setupWorkflowProgressWatcher (100ms file polling) with setupWorkflowEventStream (SSE client to /workflow-events)
- Dashboard server connects to backend SSE endpoint and forwards typed STATE_SNAPSHOT events to all WebSocket clients
- New WebSocket clients receive lastKnownState immediately on connect (SSE-03)
- Copied WorkflowSSEEvent types to dashboard for TypeScript consumption
- Legacy event types (WORKFLOW_STARTED, PAUSED, COMPLETED, FAILED) still emitted for backward compat
- handleUKBStream() SSE endpoint preserved (Phase 19 removal)
- Fixed ESM .js extension imports in shared workflow types -- service now starts in Docker
- End-to-end verified: health endpoint shows workflowEventClients: 1, SSE stream delivers initial-state events

## Task Commits

Each task was committed atomically:

1. **Task 1: Copy event types and replace file-polling with SSE client** - `9dd077c7` (feat)
2. **Task 2: Build, deploy, and verify end-to-end SSE event flow** - `d8dc6e65` (fix, submodule + parent)
   - Submodule commit: `0dcd45d` (fix: .js extensions in shared types)

## Files Created/Modified
- `integrations/system-health-dashboard/src/shared/workflow-types/events.ts` - Copied WorkflowSSEEvent types for dashboard TS consumption
- `integrations/system-health-dashboard/src/shared/workflow-types/index.ts` - Re-exports SSE event types
- `integrations/system-health-dashboard/server.js` - SSE client replacing file polling, STATE_SNAPSHOT forwarding, lastKnownState cache
- `integrations/mcp-server-semantic-analysis/src/shared/workflow-types/*.ts` - Added .js extensions to ESM imports (6 files)
- `docker/Dockerfile.coding-services` - Fixed npm install with --legacy-peer-deps

## Decisions Made
- Used Node.js native `http.get()` for SSE client instead of adding `eventsource` npm package. The SSE protocol is simple enough (~30 lines of parsing) and avoids a new dependency in a project with many already.
- STATE_SNAPSHOT WebSocket message type wraps the full WorkflowState, optionally including the transition name for state-change events. This gives the React client everything it needs without reconstruction.
- Legacy event types (WORKFLOW_STARTED, PAUSED, COMPLETED, FAILED) are mapped from state.status transitions rather than deriving step-level events. This is sufficient for the existing dashboard UI until Phase 18 rewrites it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Missing .js extensions in ESM imports**
- **Found during:** Task 2 (Docker deploy verification)
- **Issue:** Shared workflow-types files used `from './config'` instead of `from './config.js'` -- Node.js ESM in Docker (Node 22) requires explicit .js extensions
- **Fix:** Added .js extensions to all 15 local imports across 6 files in the submodule's shared/workflow-types/
- **Files modified:** state.ts, transitions.ts, events.ts, schemas.ts, derived.ts, index.ts
- **Verification:** `npm run build` succeeds, semantic-analysis service starts in Docker
- **Committed in:** 0dcd45d (submodule), d8dc6e65 (parent)

**2. [Rule 3 - Blocking] Missing cheerio dependency in Docker container**
- **Found during:** Task 2 (Docker deploy verification)
- **Issue:** Dockerfile `npm install --ignore-scripts 2>/dev/null || true` silently failed, leaving no node_modules for semantic-analysis submodule
- **Fix:** Added --legacy-peer-deps flag to Dockerfile; installed deps in running container to verify
- **Files modified:** docker/Dockerfile.coding-services
- **Verification:** semantic-analysis service starts, supervisorctl shows RUNNING
- **Committed in:** d8dc6e65

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes were required for the service to start in Docker. The .js extension issue was introduced in Plan 01 (shared types used bare imports unlike the rest of the submodule). The Dockerfile issue is pre-existing but was exposed during this deploy. No scope creep.

## Issues Encountered
- Semantic-analysis service crashed in Docker with two separate errors: first ERR_MODULE_NOT_FOUND for missing .js extensions, then ERR_MODULE_NOT_FOUND for cheerio package. Both required investigation and separate fixes before the SSE endpoint could be verified.

## User Setup Required
None - all services running and verified in Docker.

## Next Phase Readiness
- SSE event pipeline is live: backend broadcasts typed events, dashboard server consumes them, WebSocket clients receive STATE_SNAPSHOT
- Phase 18 (dashboard consumer rewrite) can consume STATE_SNAPSHOT events directly and remove legacy event type handling
- Phase 19 (migration cleanup) can remove handleUKBStream() SSE endpoint and file-polling remnants

## Self-Check: PASSED

All 4 key files verified present. Both task commits verified in git log.

---
*Phase: 17-sse-event-typing*
*Completed: 2026-03-11*
