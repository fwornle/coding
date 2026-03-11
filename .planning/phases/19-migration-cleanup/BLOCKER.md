---
created: 2026-03-11
status: blocked
phase: 19
---

# Phase 19 Blocker: Dashboard ↔ State Machine Integration Incomplete

## Context

Plan 19-01 reached its validation checkpoint (task 3: run 3 validation workflows). During validation, we discovered the state machine progress format is structurally incompatible with the dashboard's expectations. The comparison utility cannot detect meaningful "divergences" because the two formats aren't comparable — they're fundamentally different schemas.

## Gaps Found

### 1. Progress File Format Mismatch
- **State machine writes:** `{status, progress: {completedSteps: string[], currentStepName, currentSubstepId, currentWave, totalWaves, elapsedSeconds}}`
- **Dashboard expects:** `{status, completedSteps: number, totalSteps: number, currentStep: string, stepsDetail: [{name, status}], elapsedSeconds}`
- **Impact:** Dashboard shows [0/0], "Race condition detected", Idle status during active workflows

### 2. Wave Step Tracking Missing
- Wave-controller dispatches `substep-update` events but never `step-complete`
- `completedSteps` array stays empty throughout execution → dashboard sees 0 progress
- Duration field in completed state is seconds but dashboard may interpret as ms

### 3. Trace Modal Shows Old DAG Steps
- Reads workflow definitions from YAML files describing the old coordinator pipeline (14 steps)
- Wave-analysis has 4 waves with different substeps — no matching definition exists
- Result: "analyze git history", "semantic analysis", etc. shown instead of Wave 1/2/3/Insights

### 4. Single-Step Controls Disconnected
- State machine uses `subStatus: 'paused'` + config flags
- Dashboard reads `stepPaused: true` + `pausedAtStep: string` (flat fields)
- Step/Step-Into buttons don't trigger because field mapping is wrong

### 5. Graph Visualization Stale
- Multi-agent graph still shows coordinator-centric layout
- Wave legend shows correctly but nodes aren't connected to live state

## What Works

- The wave-analysis pipeline itself runs correctly (42 entities, ~230s, real LLM calls)
- SSE server properly pushes progress file changes
- WebSocket connection works (fixed port issue during this session)
- State machine transitions are correct internally

## Resolution Path

Need a "dashboard state machine integration" phase **before** migration cleanup:
1. Update server.js + healthRefreshMiddleware.ts to bridge state machine format
2. Add `step-complete` dispatches in wave-controller after each wave
3. Create wave-analysis workflow definition for trace modal
4. Fix single-step pause/resume field mapping
5. Then re-attempt phase 19 (migration cleanup)

## Files Modified During Investigation (reverted)

- `integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts` — added step-complete dispatches (reverted)
- `integrations/system-health-dashboard/server.js` — bridge layer for state machine format (reverted)
- `integrations/system-health-dashboard/src/store/middleware/healthRefreshMiddleware.ts` — bridge layer (reverted)

## Files Kept

- `integrations/system-health-dashboard/src/hooks/useWorkflowWebSocket.ts` — WebSocket port fix (uses SYSTEM_HEALTH_API_PORT from .env.ports instead of broken NODE_ENV check)
