# Phase 16: Backend State Machine - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Wave-controller and health API operate through typed state transitions instead of ad-hoc progress updates. This phase creates the runtime state machine singleton, replaces all `updateProgress()` calls with typed events, makes the progress file a subscriber-written artifact, and implements typed cancel flow. No SSE changes (Phase 17) or dashboard changes (Phase 18).

</domain>

<decisions>
## Implementation Decisions

### State machine hosting
- Singleton module: `workflow-state-machine.ts` in backend `src/` (NOT in `shared/workflow-types/` — that stays pure types)
- Exports `getState()`, `transition(event)`, `subscribe(fn)` functions
- Module-level mutable state — single in-memory WorkflowState
- Singleton enforces single-workflow-at-a-time — `transition('start')` throws if already running
- Simple callback array for subscribers (not EventEmitter) — typed `(state, event) => void`

### Event dispatch pattern
- One event per sub-phase granularity (~8 distinct event types): WaveStarted, SubstepStarted, SubstepCompleted, WaveCompleted, OperatorStarted, OperatorCompleted, InsightGenerationStarted, WorkflowCompleted
- Events carry structured data only — no human-readable message strings
- Message formatting derived by subscribers (log subscriber, future SSE subscriber)
- Phase 16 events are internal only — Phase 17 adds full WorkflowState snapshots to SSE events
- Wave-controller imports `{ transition }` directly from the singleton (no injection/indirection)
- All 30+ `updateProgress()` call sites replaced with typed `transition()` calls
- `updateProgress()` method deleted entirely — no redirect/no-op wrapper

### Progress file subscriber
- Subscriber writes on every state transition (synchronous `writeFileSync`)
- Events are infrequent (~30 per run) so no debouncing needed
- Progress file uses new WorkflowState format only — clean break from old 16-key format
- Phase 15 Zod `preprocess()`/`transform()` handles reading old-format files at boundaries
- Health API queries `getState()` from singleton — progress file is persistence artifact, not query source
- Coordinator's `writeProgressPreservingDetails` calls removed — single writer via subscriber

### Cancel flow
- Cancel triggered via Health API endpoint only (`POST /cancel` in tools.ts)
- `transition({ type: 'cancel' })` moves state machine to cancelled state
- Cooperative cancellation: wave-controller checks `getState().status === 'cancelled'` between substeps
- In-progress LLM calls finish naturally; no new substeps start
- Cancelled is a terminal state — explicit reset required (start event implicitly resets from terminal states)
- Partial results preserved — entities already persisted to KG stay

### Claude's Discretion
- Exact event type naming and payload shapes
- How the singleton initializes on module load vs first access
- Internal structure of the transition function (switch vs map lookup)
- Error handling in subscribers (catch and log vs propagate)
- How cooperative cancel check is positioned in the wave-controller loop

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `shared/workflow-types/` (Phase 15): WorkflowState discriminated union, transition types, RunConfig/RunProgress, Zod schemas — the state machine imports and implements these
- `workflow-events.ts`: CancelWorkflowCommand, StepStatus, WorkflowStartedEvent — some types migrate, others become redundant
- `workflow-runner.ts`: ProgressUpdate interface, writeProgress functions — replaced by subscriber

### Established Patterns
- `wave-controller.ts` has `updateProgress()` with ~30 call sites using `{ currentWave, subPhase, message }` shape
- `coordinator.ts` has `writeProgressPreservingDetails()` — competing writer that must be eliminated
- `tools.ts` has ad-hoc progress file reads for status queries and single-step mode toggles
- Boolean flags (`singleStepMode`, `mockLLM`, `stepPaused`) scattered in progress file — replaced by RunConfig (immutable) on WorkflowState

### Integration Points
- `wave-controller.ts`: Primary consumer — all updateProgress calls become transition calls
- `tools.ts`: Health API — status queries switch from file reads to getState(), cancel endpoint added
- `coordinator.ts`: Remove competing progress writes, may need to import getState() for status checks
- `workflow-runner.ts`: Progress file write functions replaced by subscriber

</code_context>

<specifics>
## Specific Ideas

- The singleton pattern with subscribe() naturally sets up Phase 17 (SSE subscriber) and Phase 18 (dashboard) — each phase adds a new subscriber
- Cooperative cancel with between-substep checks mirrors how the existing single-step pause works (check a flag between steps)
- The ~8 event types map cleanly to the existing subPhase values in updateProgress, making the migration mechanical

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 16-backend-state-machine*
*Context gathered: 2026-03-10*
