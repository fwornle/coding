---
phase: 15-type-definitions
plan: 01
subsystem: api
tags: [zod, typescript, state-machine, discriminated-union, validation]

requires: []
provides:
  - WorkflowState discriminated union (6 variants + running sub-states)
  - RunConfig (readonly) and RunProgress (mutable) Zod schemas
  - Migration preprocess for old format compatibility
  - StepStatus and StepDefinition shared types
affects: [16-state-transitions, 17-backend-integration, 18-dashboard-consumer, 19-migration]

tech-stack:
  added: [zod@4.3.6]
  patterns: [zod-first-types, discriminated-union-on-status, config-progress-separation]

key-files:
  created:
    - shared/workflow-types/config.ts
    - shared/workflow-types/state.ts
    - shared/workflow-types/schemas.ts
    - shared/workflow-types/index.ts
  modified:
    - integrations/mcp-server-semantic-analysis/package.json
    - integrations/system-health-dashboard/package.json

key-decisions:
  - "Zod-first: schemas are source of truth, TS types derived via z.infer<>"
  - "Single RunningStateSchema with subStatus enum instead of nested discriminatedUnion"
  - "Migration preprocess handles 'starting' status and flat config/progress format"

patterns-established:
  - "Config-progress separation: RunConfig (readonly, set at start) vs RunProgress (mutable, tracks position)"
  - "Discriminated union on status field for type narrowing"
  - "z.preprocess migration wrapper at system boundaries"

requirements-completed: [SM-01, SM-03, SM-05]

duration: 3min
completed: 2026-03-10
---

# Phase 15 Plan 01: Type Definitions Summary

**Zod-first WorkflowState discriminated union with 6 status variants, config/progress separation, and migration-aware parsing**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T21:10:20Z
- **Completed:** 2026-03-10T21:12:55Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created Zod-first type system with RunConfig (readonly) and RunProgress (mutable) as separate schemas
- Built WorkflowState discriminated union with idle, running, paused, completed, failed, cancelled variants
- Running state includes subStatus enum for executing-step vs between-steps granularity
- Migration preprocess handles old 'starting' status and flat format transparently
- Installed Zod 4.3.6 in both backend and dashboard consumers

## Task Commits

Each task was committed atomically:

1. **Task 1: Install Zod and create RunConfig + RunProgress schemas** - `d8b1ef9b` (feat)
2. **Task 2: Create WorkflowState discriminated union and migration schemas** - `3e62a0cf` (feat)

## Files Created/Modified
- `shared/workflow-types/config.ts` - RunConfig (readonly) and RunProgress (mutable) Zod schemas with inferred types
- `shared/workflow-types/state.ts` - WorkflowState discriminated union with 6 status variants
- `shared/workflow-types/schemas.ts` - Migration preprocess, StepStatus, StepDefinition types
- `shared/workflow-types/index.ts` - Single import point re-exporting all types and schemas

## Decisions Made
- Used single RunningStateSchema with `subStatus: z.enum(['executing-step', 'between-steps'])` instead of nested discriminatedUnion to avoid Zod pitfall of non-unique discriminator values
- Migration preprocess maps old 'starting' to running with subStatus 'executing-step'
- Flat format migration extracts singleStepMode/mockLLM/llmMode/stepIntoSubsteps into config sub-object

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All type definitions ready for Phase 16 (state transitions) to build typed transition functions
- Phase 17 (backend integration) can import from shared/workflow-types/index.ts
- Phase 18 (dashboard consumer) can use WorkflowStateWithMigrationSchema at SSE boundary
- Phase 19 (migration) can use preprocess schema for progress file migration

---
*Phase: 15-type-definitions*
*Completed: 2026-03-10*
