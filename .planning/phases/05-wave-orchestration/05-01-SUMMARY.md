---
phase: 05-wave-orchestration
plan: 01
subsystem: pipeline
tags: [typescript, wave-analysis, workflow-routing, type-contracts]

# Dependency graph
requires:
  - phase: 04-schema-foundation
    provides: KGEntity hierarchy fields (parentId, level, hierarchyPath), ComponentManifest types
provides:
  - WaveControllerConfig, ChildManifestEntry, WaveAgentOutput, WaveResult, WaveExecutionResult type contracts
  - Wave1Input, Wave2Input, Wave3Input agent input interfaces
  - wave-analysis YAML workflow registration
  - workflow-runner.ts WaveController routing branch (dynamic import)
  - tools.ts wave-analysis in longRunningWorkflows and workflowMapping
affects: [05-02-PLAN (WaveController), 05-03-PLAN (wave agents), 05-04-PLAN (integration)]

# Tech tracking
tech-stack:
  added: []
  patterns: [dynamic-import-routing, type-contract-first-design]

key-files:
  created:
    - integrations/mcp-server-semantic-analysis/src/types/wave-types.ts
    - integrations/mcp-server-semantic-analysis/config/workflows/wave-analysis.yaml
  modified:
    - integrations/mcp-server-semantic-analysis/src/workflow-runner.ts
    - integrations/mcp-server-semantic-analysis/src/tools.ts

key-decisions:
  - "Dynamic import for WaveController avoids breaking batch-analysis when wave-controller.ts doesn't exist yet"
  - "wave-analysis.yaml has no steps block -- WaveController drives execution programmatically"
  - "workflowMapping entry added so MCP tool explicitly routes wave-analysis"

patterns-established:
  - "Type-contract-first: define all inter-module interfaces before implementation begins"
  - "Dynamic import routing: workflow-runner detects workflow name and lazy-loads controller via await import()"

requirements-completed: [WAVE-01, WAVE-05]

# Metrics
duration: 1min
completed: 2026-03-04
---

# Phase 5 Plan 01: Wave Types and Routing Summary

**8 shared type contracts (wave-types.ts), wave-analysis YAML config, and WaveController routing plumbing in workflow-runner.ts and tools.ts**

## Performance

- **Duration:** 1 min
- **Started:** 2026-03-04T12:18:05Z
- **Completed:** 2026-03-04T12:18:47Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Created 8 TypeScript interfaces defining all data contracts for WaveController and three wave agents
- Registered wave-analysis as a valid workflow via YAML config with type: wave
- Added WaveController routing branch in workflow-runner.ts using dynamic import (before coordinator path)
- Added wave-analysis to longRunningWorkflows and workflowMapping in tools.ts for MCP tool routing

## Task Commits

Each task was committed atomically in the submodule:

1. **Task 1: Create wave type contracts** - `50bb06d` (feat) [submodule]
2. **Task 2: Create wave-analysis YAML config and update routing** - `1adc986` (feat) [submodule]

**Parent repo submodule pointer update:** `89a7fe06` (feat: combined)

## Files Created/Modified
- `integrations/mcp-server-semantic-analysis/src/types/wave-types.ts` - 8 exported interfaces: WaveControllerConfig, ChildManifestEntry, WaveAgentOutput, WaveResult, WaveExecutionResult, Wave1Input, Wave2Input, Wave3Input
- `integrations/mcp-server-semantic-analysis/config/workflows/wave-analysis.yaml` - Minimal workflow registration (type: wave, no steps block)
- `integrations/mcp-server-semantic-analysis/src/workflow-runner.ts` - WaveController routing branch at line 469, before coordinator instantiation at line 517
- `integrations/mcp-server-semantic-analysis/src/tools.ts` - wave-analysis added to longRunningWorkflows array and workflowMapping object

## Decisions Made
- Used dynamic `await import()` for wave-controller.js so the module only loads when needed and batch-analysis continues to work even before wave-controller.ts exists
- YAML config has no `steps` block since WaveController manages all execution flow programmatically (unlike coordinator which reads YAML steps)
- Added `wave-analysis` to workflowMapping with empty defaults since wave-analysis doesn't need the same parameter defaults as batch-analysis

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Type contracts ready for import by WaveController (Plan 02) and wave agents (Plan 03)
- Routing plumbing in place -- when WaveController is implemented, `ukb full` with workflow_name "wave-analysis" will route to it
- wave-controller.ts does not exist yet (expected -- Plan 02 creates it). The dynamic import handles this gracefully at runtime

---
*Phase: 05-wave-orchestration*
*Completed: 2026-03-04*

## Self-Check: PASSED

All artifacts verified:
- wave-types.ts: FOUND (8 interfaces exported)
- wave-analysis.yaml: FOUND
- 05-01-SUMMARY.md: FOUND
- Commit 50bb06d (Task 1 submodule): FOUND
- Commit 1adc986 (Task 2 submodule): FOUND
- Commit 89a7fe06 (parent repo): FOUND
