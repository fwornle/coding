# Roadmap: Coding Project Knowledge Management

## Milestones

- v1.0 -- UKB Pipeline Fix & Improvement (shipped 2026-03-03) -> [archive](milestones/v1.0-ROADMAP.md)
- v2.0 -- Wave-Based Hierarchical Semantic Analysis (Phases 5-8, shipped 2026-03-07)
- v2.1 -- Wave Pipeline Quality Restoration (Phases 9-14, shipped 2026-03-10)
- v3.0 -- Workflow State Machine (Phases 15-19, in progress)

---

<details>
<summary>v1.0 UKB Pipeline Fix & Improvement -- SHIPPED 2026-03-03</summary>

- [x] Phase 1: Core Pipeline Data Quality (7/7 plans) -- completed 2026-03-02
- [x] Phase 4: Schema & Configuration Foundation (2/2 plans) -- completed 2026-03-01
- [ ] Phase 2: Insight Generation & Data Routing -- Deferred
- [ ] Phase 3: Significance & Quality Ranking -- Deferred

</details>

<details>
<summary>v2.0 Wave-Based Hierarchical Semantic Analysis -- Phases 5-8</summary>

- [x] **Phase 5: Wave Orchestration** - Replace flat batch DAG with hierarchical wave controller (completed 2026-03-04)
- [x] **Phase 6: Entity Quality** - Rich multi-observation entities with insight documents (completed 2026-03-04)
- [x] **Phase 7: Hierarchy Completeness** - Comprehensive sub-node coverage from code analysis (completed 2026-03-07)
- [x] **Phase 8: VKB Tree Navigation** - Deferred to v2.2

</details>

<details>
<summary>v2.1 Wave Pipeline Quality Restoration -- Phases 9-14, SHIPPED 2026-03-10</summary>

- [x] **Phase 9: Agent Pipeline Integration** (3/3 plans) -- completed 2026-03-07
- [x] **Phase 10: KG Operations Restoration** (5/5 plans) -- completed 2026-03-08
- [x] **Phase 11: Content Quality Gate** (3/3 plans) -- completed 2026-03-09
- [x] **Phase 12: Pipeline Observability** (4/4 plans) -- completed 2026-03-09
- [x] **Phase 13: Code Graph Agent Integration** (3/3 plans) -- completed 2026-03-09
- [~] **Phase 14: Documentation Generation** (2/3 plans) -- 14-03 deferred to v3.0

</details>

---

## v3.0 -- Workflow State Machine

### Overview

Five phases that replace the ad-hoc workflow state management with a typed state machine. The current system tracks state via an untyped JSON progress file, has dashboard "fallback inference" that guesses substep status, uses boolean flags that get stuck between runs, and has multiple competing state sources. Phase 15 defines the type foundation (discriminated union states, typed transitions, Zod validation). Phase 16 integrates the state machine into the backend (wave-controller, health API, progress file as subscriber). Phase 17 types the SSE event layer so every transition emits a full state snapshot. Phase 18 rewrites the dashboard as a pure consumer of typed events with no inference. Phase 19 runs old and new side-by-side, validates, then removes all legacy inference code.

### Phases

- [x] **Phase 15: Type Definitions** - Discriminated union states, typed transitions, RunConfig/RunProgress separation, Zod schemas (completed 2026-03-10)
- [x] **Phase 16: Backend State Machine** - Wave-controller typed events, health API state transitions, progress file as subscriber (completed 2026-03-11)
- [x] **Phase 17: SSE Event Typing** - Typed SSE events with full state snapshots, discriminated union event types, reconnection state (completed 2026-03-11)
- [x] **Phase 18: Dashboard Consumer** - Dashboard renders from typed SSE only, correct substep coloring, typed commands, no inference (completed 2026-03-11)
- [ ] **Phase 19: Migration & Cleanup** - Parallel path validation, backward-compatible progress reader, legacy code removal
- [ ] **Phase 19.1: Dashboard State Machine Integration** - Bridge state machine format to dashboard, fix step tracking and single-step controls (INSERTED - unblocks Phase 19)

### Phase Details

#### Phase 15: Type Definitions
**Goal**: All workflow states, transitions, and configuration are expressed as TypeScript types that make invalid states unrepresentable
**Depends on**: Nothing (foundation phase)
**Requirements**: SM-01, SM-02, SM-03, SM-04, SM-05
**Success Criteria** (what must be TRUE):
  1. WorkflowState is a discriminated union where each variant (idle/running/paused/completed/failed/cancelled) carries only the data relevant to that state -- accessing running-only fields on an idle state is a compile error
  2. Attempting to code a transition from idle directly to paused (or any other invalid transition) produces a TypeScript compiler error
  3. RunConfig (singleStepMode, mockLLM, llmMode, stepIntoSubsteps) is a readonly type set once at workflow start; RunProgress is a separate mutable type tracking current position
  4. Step and substep status values are derived from the state machine position via a pure function -- no separate mutable status fields exist
  5. Zod schemas exist for WorkflowState and can parse/reject JSON at runtime (e.g., reading progress file, receiving SSE event)
**Plans:** 2/2 plans complete
Plans:
- [ ] 15-01-PLAN.md -- Core Zod schemas: WorkflowState discriminated union, RunConfig/RunProgress separation, migration preprocess
- [ ] 15-02-PLAN.md -- Typed transitions, step status derivation, file-copy build script

#### Phase 16: Backend State Machine
**Goal**: The wave-controller and health API operate through typed state transitions instead of ad-hoc progress updates
**Depends on**: Phase 15
**Requirements**: BE-01, BE-02, BE-03, BE-04
**Success Criteria** (what must be TRUE):
  1. Wave-controller emits typed WorkflowEvent objects (e.g., StepStarted, StepCompleted, SubstepAdvanced) instead of calling updateProgress() with ad-hoc field objects
  2. The health API step-advance endpoint calls a state machine transition function that validates the transition is legal before applying it
  3. The progress file is written by a single subscriber function that serializes the current WorkflowState -- neither wave-controller nor health API write to it directly
  4. Cancelling a workflow triggers a typed Cancel transition that moves the state machine to the cancelled state, cleaning up in-flight work
**Plans:** 2/2 plans complete
Plans:
- [ ] 16-01-PLAN.md -- State machine singleton, progress file subscriber, health API integration
- [ ] 16-02-PLAN.md -- Wave-controller migration (30 updateProgress calls to typed dispatch), legacy cleanup

#### Phase 17: SSE Event Typing
**Goal**: Every workflow state transition is broadcast to connected clients as a typed SSE event carrying the full current state
**Depends on**: Phase 16
**Requirements**: SSE-01, SSE-02, SSE-03
**Success Criteria** (what must be TRUE):
  1. Every state machine transition emits an SSE event containing the complete WorkflowState snapshot -- clients never need to compute derived state
  2. SSE event types are discriminated unions (WorkflowStarted, StepAdvanced, WorkflowPaused, etc.) shared between backend and dashboard via copied type file
  3. When a new SSE client connects (or reconnects after disconnect), it immediately receives the full current WorkflowState as its first event
**Plans:** 2/2 plans complete
Plans:
- [ ] 17-01-PLAN.md -- SSE event types (discriminated union), broadcaster subscriber, /workflow-events endpoint
- [ ] 17-02-PLAN.md -- Dashboard server SSE client, WebSocket forwarding, reconnection state

#### Phase 18: Dashboard Consumer
**Goal**: The dashboard displays workflow state purely from typed SSE events with zero fallback inference or guessing
**Depends on**: Phase 17
**Requirements**: UI-01, UI-02, UI-03, UI-04, UI-05
**Success Criteria** (what must be TRUE):
  1. The dashboard renders step/substep status, progress, and timing exclusively from SSE events -- grep for "fallback" and "infer" in dashboard source returns zero hits in workflow-related code
  2. Substep coloring matches the state machine state: active substep is blue, completed is green, pending is gray -- never green-when-should-be-blue or stuck-in-wrong-color
  3. Step/Into buttons in single-step mode dispatch typed command events and are disabled while a transition is in flight -- no double-click race conditions
  4. The workflow label reads "Wave Analysis" (not "Batch") everywhere in the dashboard
  5. The Redux store receives typed SSE events and stores them directly as WorkflowState -- no transformation, inference, or status derivation in the reducer
**Plans:** 2/2 plans complete
Plans:
- [ ] 18-01-PLAN.md -- WebSocket STATE_SNAPSHOT handling, Redux store with direct WorkflowState, derived selectors
- [ ] 18-02-PLAN.md -- Substep coloring from state machine, typed command buttons, Wave Analysis renaming, inference removal

#### Phase 19: Migration & Cleanup
**Goal**: Legacy state management code is fully removed after validated parallel operation proves the new state machine is correct
**Depends on**: Phase 18, Phase 19.1
**Requirements**: MIG-01, MIG-02, MIG-03
**Success Criteria** (what must be TRUE):
  1. During migration, the old updateProgress path and new state machine run side-by-side, with a comparison log that flags any state divergence between old and new
  2. The progress file reader can parse both old-format (untyped) and new-format (WorkflowState) progress files without crashing -- enabling rollback if needed
  3. After validation, all old inference code, fallback logic, and updateProgress calls are deleted -- the codebase has exactly one state management path
**Plans:** 2 plans
Plans:
- [ ] 19-01-PLAN.md -- Parallel validation infrastructure: writeProgressFile redirect, comparison utility, dashboard warning banner, 3 validation runs
- [ ] 19-02-PLAN.md -- Legacy code removal: coordinator writeProgressFile deletion, dashboard legacy fields, deprecated constants, schema migration code

#### Phase 19.1: Dashboard State Machine Integration (INSERTED)
**Goal:** Bridge the state machine's WorkflowState format to the dashboard's expected flat format, add missing step-complete dispatches, fix single-step controls, and update graph visualization
**Depends on:** Phase 18
**Requirements**: MIG-01, MIG-02
**Success Criteria** (what must be TRUE):
  1. Dashboard shows wave progress as N/4 (not 0/0 or 0/14) -- no "Race condition detected" errors
  2. Wave-controller dispatches step-complete after each wave, so completedSteps tracks progress
  3. Single-step mode pause/resume works through the state machine with correct field mapping
  4. Graph visualization shows Wave Controller identity (not old SmartOrchestrator)
  5. Trace modal shows wave1/wave2/wave3/wave4 steps (not old 14-step coordinator pipeline)
**Plans:** 2/4 plans executed

Plans:
- [ ] 19.1-01-PLAN.md -- Wave-controller step-complete dispatches + server.js bridge layer
- [ ] 19.1-02-PLAN.md -- Dashboard SSE middleware bridge + constants update + end-to-end verification

### Progress

**Execution Order:** Phases execute sequentially: 15 -> 16 -> 17 -> 18 -> 19.1 -> 19

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 15. Type Definitions | 2/2 | Complete    | 2026-03-10 | - |
| 16. Backend State Machine | 2/2 | Complete    | 2026-03-11 | - |
| 17. SSE Event Typing | 2/2 | Complete    | 2026-03-11 | - |
| 18. Dashboard Consumer | 2/2 | Complete    | 2026-03-11 | - |
| 19.1. Dashboard SM Integration | 2/4 | In Progress|  | - |
| 19. Migration & Cleanup | v3.0 | 0/2 | Blocked (needs 19.1) | - |
