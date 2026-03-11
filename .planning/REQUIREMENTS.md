# Requirements: Coding Project v3.0

**Defined:** 2026-03-10
**Core Value:** Workflow state management via typed state machine — single source of truth, typed transitions, dashboard as pure consumer

## v3.0 Requirements

### State Machine Core

- [x] **SM-01**: Workflow state is a TypeScript discriminated union with state-specific data (idle/running/paused/completed/failed/cancelled)
- [x] **SM-02**: State transitions are typed — only valid transitions compile
- [x] **SM-03**: RunConfig (singleStepMode, mockLLM, llmMode, stepIntoSubsteps) is immutable after workflow start, separated from RunProgress
- [x] **SM-04**: Step/substep status derived from state machine position — not stored as separate mutable fields
- [x] **SM-05**: Zod schemas validate state at system boundaries

### Backend Integration

- [ ] **BE-01**: Wave-controller dispatches typed events instead of ad-hoc updateProgress() calls
- [x] **BE-02**: Health API step-advance endpoint operates on the state machine
- [x] **BE-03**: Progress file written by subscriber — not directly by wave-controller or health API
- [x] **BE-04**: Workflow cancel operates via state machine transition

### SSE Events

- [ ] **SSE-01**: Every state transition emits typed SSE event with full WorkflowState snapshot
- [ ] **SSE-02**: SSE events use discriminated union types shared between backend and dashboard
- [ ] **SSE-03**: SSE reconnection sends full current state on connect

### Dashboard Consumer

- [ ] **UI-01**: Dashboard renders from typed SSE events only — zero fallback inference
- [ ] **UI-02**: Substep coloring derived from state machine state (SUBSTEP_COLORS from constants)
- [ ] **UI-03**: Step/Into buttons dispatch typed commands, disabled during transitions
- [ ] **UI-04**: "Batch" label replaced with correct workflow name
- [ ] **UI-05**: Redux store receives typed SSE events directly — no inference

### Migration

- [ ] **MIG-01**: Parallel path — old updateProgress and new state machine run side-by-side
- [ ] **MIG-02**: Backward-compatible progress file reader
- [ ] **MIG-03**: All old inference/fallback code removed after validation

## v3.1 Requirements (Deferred)

- **SM-06**: Crash recovery from persisted state
- **SM-07**: Workflow history for comparison
- **UI-06**: State machine inspector panel
- **BE-05**: Retry with feedback as typed state machine loop

## Out of Scope

| Feature | Reason |
|---------|--------|
| XState / state machine library | Overkill for ~6 states. Hand-rolled DU is simpler |
| Shared npm package for types | File-copy sync sufficient for ~100 lines |
| Distributed state | Single process, unnecessary complexity |
| Workflow queue | One workflow at a time |
| Dynamic step insertion | Step sequence is static |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SM-01 | Phase 15 | Complete |
| SM-02 | Phase 15 | Complete |
| SM-03 | Phase 15 | Complete |
| SM-04 | Phase 15 | Complete |
| SM-05 | Phase 15 | Complete |
| BE-01 | Phase 16 | Pending |
| BE-02 | Phase 16 | Complete |
| BE-03 | Phase 16 | Complete |
| BE-04 | Phase 16 | Complete |
| SSE-01 | Phase 17 | Pending |
| SSE-02 | Phase 17 | Pending |
| SSE-03 | Phase 17 | Pending |
| UI-01 | Phase 18 | Pending |
| UI-02 | Phase 18 | Pending |
| UI-03 | Phase 18 | Pending |
| UI-04 | Phase 18 | Pending |
| UI-05 | Phase 18 | Pending |
| MIG-01 | Phase 19 | Pending |
| MIG-02 | Phase 19 | Pending |
| MIG-03 | Phase 19 | Pending |

---
*Requirements defined: 2026-03-10*
