# Architecture Patterns: v3.0 Workflow State Machine

**Domain:** Typed state machine for workflow orchestration
**Researched:** 2026-03-10

## Recommended Architecture

### State Ownership Model

```
Backend (workflow-runner.ts)           Frontend (dashboard)
================================       ================================
WorkflowStateMachine                   Redux Store
  - owns WorkflowState                   - receives WorkflowState
  - validates transitions                - dispatches from SSE events
  - emits SSE events                     - renders from state
  - writes progress file                 - ZERO inference logic
         |                                        ^
         |-- SSE: typed WorkflowState ------------|
         |-- File: workflow-progress.json (backup, not source of truth)
```

**Key principle:** The backend state machine is the SINGLE source of truth. The progress file is a crash-recovery backup, not a primary state source. The dashboard is a pure consumer — it never computes, infers, or guesses state.

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `workflow-state.ts` (shared types) | Type definitions, Zod schemas | Imported by all other components |
| `WorkflowStateMachine` (backend) | State transitions, validation, guards | workflow-runner.ts, SSE emitter |
| SSE emitter (backend, Express) | Serializes typed events to SSE stream | Dashboard EventSource listener |
| Redux workflowSlice (frontend) | Stores received state, provides selectors | Dashboard React components |
| Progress file writer (backend) | Crash recovery persistence | Read on startup only |

### Data Flow

1. Workflow runner calls `stateMachine.transition(currentState, event)`
2. Transition function validates event against current state, returns new state or throws
3. New state is emitted via typed SSE event
4. New state is written to progress file (async, non-blocking)
5. Dashboard EventSource listener receives SSE event
6. Zod validates the event payload
7. Redux dispatch updates workflowSlice
8. React components re-render from Redux selectors

## Patterns to Follow

### Pattern 1: Discriminated Union State Machine

**What:** Pure function that takes current state + event, returns new state. No classes, no mutation.
**When:** Always — this is the core pattern.

```typescript
type WorkflowState =
  | { status: 'idle' }
  | { status: 'running'; currentStep: string; substepIndex: number; startedAt: string }
  | { status: 'paused'; pausedStep: string; pausedSubstep: string; pausedAt: string }
  | { status: 'completed'; completedAt: string; summary: WorkflowSummary }
  | { status: 'failed'; error: string; failedStep: string; failedAt: string };

function transition(state: WorkflowState, event: WorkflowEvent): WorkflowState {
  switch (state.status) {
    case 'idle': /* handle START */ break;
    case 'running': /* handle STEP_ADVANCE, PAUSE, COMPLETE, FAIL */ break;
    case 'paused': /* handle RESUME, FAIL */ break;
    case 'completed':
    case 'failed': /* handle START (restart) */ break;
    default: const _exhaustive: never = state; throw new Error(`Unhandled: ${_exhaustive}`);
  }
}
```

### Pattern 2: Zod Schema as Single Source of Truth

**What:** Define Zod schemas, derive TypeScript types via `z.infer`. Never define types separately from schemas.
**When:** For all shared types that cross system boundaries (file, SSE, API).

### Pattern 3: Redux Slice as Pure Consumer

**What:** Dashboard Redux slice stores backend state verbatim. No transformation, no inference.
**When:** Always — dashboard must not compute state.

```typescript
const workflowSlice = createSlice({
  name: 'workflow',
  initialState: { status: 'idle' } as WorkflowState,
  reducers: {
    stateReceived: (_state, action: PayloadAction<WorkflowState>) => action.payload,
  },
});
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Fallback Inference
**What:** Dashboard computes "this step is probably running" from partial data
**Why bad:** Root cause of every dashboard coloring bug
**Instead:** Dashboard displays exactly what backend sends

### Anti-Pattern 2: Multiple State Sources
**What:** Reading state from SSE + polling + progress file + Redux and merging
**Why bad:** Sources disagree, merge logic has bugs, race conditions
**Instead:** Single source (backend state machine). Progress file is crash recovery only.

### Anti-Pattern 3: Boolean Flags for Mode
**What:** `singleStepMode: boolean`, `stepPaused: boolean`, `stepIntoSubsteps: boolean`
**Why bad:** Flags get stuck, combinatorial explosion (8 combinations of 3 booleans)
**Instead:** `paused` state variant with structured data about what's paused and how to resume.

### Anti-Pattern 4: Mutable State Object
**What:** `state.currentStep = newStep; state.substepIndex = 0;`
**Why bad:** Partial updates leave state inconsistent
**Instead:** Pure transition function returns complete new state object every time.

---
*Architecture patterns for: v3.0 Workflow State Machine*
*Researched: 2026-03-10*
