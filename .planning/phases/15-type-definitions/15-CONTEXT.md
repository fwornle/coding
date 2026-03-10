# Phase 15: Type Definitions - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

All workflow states, transitions, and configuration are expressed as TypeScript types that make invalid states unrepresentable. This phase creates the type foundation — no runtime integration (that's phases 16-19). Existing StepStatus/StepDefinition types from workflow-events.ts are migrated into the new shared type system.

</domain>

<decisions>
## Implementation Decisions

### State granularity
- 6 base states: idle, running, paused, completed, failed, cancelled
- 'running' split into sub-states: running-step (actively executing) and running-between-steps (awaiting next)
- Fold 'starting' into 'running' — no separate starting state
- Paused carries full position: pausedAt (step/substep), pauseReason ('user-requested' | 'single-step-boundary'), resumable flag
- Rich terminal states: completed carries {completedSteps, duration, summary}, failed carries {failedStep, error, stackTrace?}, cancelled carries {cancelledAt, lastStep}

### Transition enforcement
- Transition function map pattern: typed transition(state, event) where each state variant maps to allowed events
- Both compile-time and runtime guards — types prevent invalid code, runtime throws on invalid transitions from external data
- Transition graph: idle→running, running→paused/completed/failed/cancelled, paused→running/cancelled, failed→idle (retry). Terminal states (completed, cancelled) have no outbound transitions
- Typed event payloads as discriminated union: { type: 'fail', error: string, step: string } vs { type: 'start', config: RunConfig }

### Type file organization
- New `shared/workflow-types/` directory at repo root
- Split by concern: state.ts (WorkflowState union), transitions.ts (event types + transition map), config.ts (RunConfig, RunProgress), schemas.ts (Zod schemas), index.ts (re-exports)
- Migrate existing StepStatus, StepDefinition, event types from workflow-events.ts into shared types
- Plain .ts files, copied into backend src/ and dashboard src/ on build — no package.json, no tsconfig in shared/

### Zod schema approach
- Zod-first: write Zod schemas, derive TS types via z.infer<>. Single source of truth
- Validation at three boundaries: reading progress file, receiving SSE events on dashboard, Health API request/response
- Schemas include z.preprocess()/.transform() for migration (old 'starting' → running, old format → new format). MIG-02 baked into schemas
- Invalid data at boundaries throws with context (schema.parse() with ZodError) — fail fast, no safeParse

### Claude's Discretion
- Exact Zod schema structure and nesting
- Helper type utilities (type guards, narrowing functions)
- Naming conventions for state variants
- How RunProgress tracks step/substep position internally

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `workflow-events.ts`: Has StepStatus ('pending'|'running'|'completed'|'failed'|'skipped'), StepDefinition, StepStatusInfo, SubstepStatusInfo, BatchProgress, WorkflowStartedEvent — all migrate into shared types
- `workflow-runner.ts`: Has ProgressUpdate interface and WorkflowConfig — these get replaced by new typed state

### Established Patterns
- Status strings used throughout: 'starting'|'running'|'completed'|'failed' in workflow-runner, 'pending'|'running'|'completed'|'failed'|'skipped' in events
- Progress file (.data/workflow-progress.json) mixes config (singleStepMode, mockLLM) with runtime state — this is the core problem the types fix
- singleStepMode/mockLLM/llmMode/stepIntoSubsteps scattered across wave-controller, coordinator, workflow-runner, tools.ts, workflow-events.ts

### Integration Points
- Progress file reader/writer in workflow-runner.ts (lines ~200-224)
- SSE event emission in workflow-events.ts (WorkflowStartedEvent already has preferences block)
- Health API in tools.ts (reads/writes workflow state)
- Dashboard Redux store (separate submodule, will consume via file-copy)

</code_context>

<specifics>
## Specific Ideas

- Zod is not yet in the project — needs to be added as a dependency to both backend and dashboard
- The progress file currently has 16 top-level keys with no type safety — the new WorkflowState replaces this
- RunConfig fields (singleStepMode, mockLLM, llmMode, stepIntoSubsteps) are already defined in WorkflowStartedEvent.preferences — consolidate into RunConfig type

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-type-definitions*
*Context gathered: 2026-03-10*
