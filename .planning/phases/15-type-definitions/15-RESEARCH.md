# Phase 15: Type Definitions - Research

**Researched:** 2026-03-10
**Domain:** TypeScript discriminated unions, Zod runtime validation, workflow state modeling
**Confidence:** HIGH

## Summary

Phase 15 creates the type foundation for the workflow state machine. The existing codebase has extensive type definitions in `workflow-events.ts` (500 lines of event/command types) and an untyped `ProgressUpdate` interface in `workflow-runner.ts` that mixes config with runtime state. The core work is: (1) define a discriminated union `WorkflowState` with 6+2 variants, (2) create typed transition functions, (3) separate `RunConfig` (immutable) from `RunProgress` (mutable), (4) derive step/substep status from state position, and (5) add Zod schemas for runtime validation at boundaries.

Zod is not currently installed in either the backend or dashboard. Zod 4 is now stable and should be used. The project uses TypeScript 5.8.3 (backend) and 5.2.2 (dashboard), both fully support discriminated unions and `const` assertions needed for this pattern. The shared types will live in `shared/workflow-types/` at repo root and be file-copied into consumers on build -- no npm package needed per user decision.

**Primary recommendation:** Write Zod schemas first, derive all TypeScript types via `z.infer<>`. This gives a single source of truth for both compile-time safety and runtime validation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- 6 base states: idle, running, paused, completed, failed, cancelled
- 'running' split into sub-states: running-step (actively executing) and running-between-steps (awaiting next)
- Fold 'starting' into 'running' -- no separate starting state
- Paused carries full position: pausedAt (step/substep), pauseReason ('user-requested' | 'single-step-boundary'), resumable flag
- Rich terminal states: completed carries {completedSteps, duration, summary}, failed carries {failedStep, error, stackTrace?}, cancelled carries {cancelledAt, lastStep}
- Transition function map pattern: typed transition(state, event) where each state variant maps to allowed events
- Both compile-time and runtime guards
- Transition graph: idle->running, running->paused/completed/failed/cancelled, paused->running/cancelled, failed->idle (retry). Terminal states (completed, cancelled) have no outbound transitions
- Typed event payloads as discriminated union
- New `shared/workflow-types/` directory at repo root
- Split by concern: state.ts, transitions.ts, config.ts, schemas.ts, index.ts
- Migrate existing StepStatus, StepDefinition, event types from workflow-events.ts into shared types
- Plain .ts files, copied into backend src/ and dashboard src/ on build -- no package.json, no tsconfig in shared/
- Zod-first: write Zod schemas, derive TS types via z.infer<>. Single source of truth
- Validation at three boundaries: reading progress file, receiving SSE events on dashboard, Health API request/response
- Schemas include z.preprocess()/.transform() for migration (old 'starting' -> running, old format -> new format). MIG-02 baked into schemas
- Invalid data at boundaries throws with context (schema.parse() with ZodError) -- fail fast, no safeParse

### Claude's Discretion
- Exact Zod schema structure and nesting
- Helper type utilities (type guards, narrowing functions)
- Naming conventions for state variants
- How RunProgress tracks step/substep position internally

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SM-01 | Workflow state is a TypeScript discriminated union with state-specific data (idle/running/paused/completed/failed/cancelled) | Zod discriminatedUnion + z.infer pattern; existing HeartbeatEvent.status and WorkflowExecutionState.status show current flat enum to replace |
| SM-02 | State transitions are typed -- only valid transitions compile | Transition map pattern with conditional types; existing WorkflowEvent union provides event payloads to map from |
| SM-03 | RunConfig (singleStepMode, mockLLM, llmMode, stepIntoSubsteps) is immutable after workflow start, separated from RunProgress | Existing WorkflowStartedEvent.preferences block has these 4 fields; ProgressUpdate mixes them with runtime state -- separate into readonly RunConfig + mutable RunProgress |
| SM-04 | Step/substep status derived from state machine position -- not stored as separate mutable fields | Pure function deriveStepStatuses(state: WorkflowState): Record<string, StepStatus> replaces StepStatusInfo/SubstepStatusInfo mutable storage |
| SM-05 | Zod schemas validate state at system boundaries | z.discriminatedUnion on 'status' field; z.preprocess for old 'starting' -> 'running' migration; schema.parse() at progress file read, SSE receive, Health API |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | ^4.0.0 | Runtime schema validation + type inference | Zod 4 is stable; z.infer<> eliminates type duplication; z.discriminatedUnion is purpose-built for this use case |
| typescript | ^5.8.3 | Type system (already installed) | Already in project; strict mode enabled; full discriminated union support |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | - | No additional libraries needed for type definitions |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod | io-ts | More FP-oriented, steeper learning curve, less ecosystem support |
| Zod | Manual type guards | No runtime validation, duplicated logic, error-prone |
| Zod 4 | Zod 3 | Zod 3 is maintenance-only; v4 has better discriminated union composition |

**Installation:**
```bash
cd integrations/mcp-server-semantic-analysis && npm install zod@^4.0.0
cd integrations/system-health-dashboard && npm install zod@^4.0.0
```

## Architecture Patterns

### Recommended Project Structure
```
shared/
  workflow-types/
    state.ts          # WorkflowState discriminated union (Zod + inferred types)
    transitions.ts    # WorkflowEvent union, transition map, transition()
    config.ts         # RunConfig (readonly), RunProgress (mutable)
    schemas.ts        # Zod schemas with preprocess/transform for migration
    index.ts          # Re-exports everything
```

### Pattern 1: Zod-First Discriminated Union
**What:** Define Zod schemas first, derive TypeScript types via z.infer
**When to use:** Always -- this is the single source of truth approach decided by user

```typescript
import { z } from 'zod';

// State variant schemas
const IdleStateSchema = z.object({
  status: z.literal('idle'),
});

const RunningStepStateSchema = z.object({
  status: z.literal('running'),
  subStatus: z.literal('executing-step'),
  workflowId: z.string(),
  workflowName: z.string(),
  currentStep: z.string(),
  currentStepIndex: z.number(),
  startTime: z.string(),
  config: RunConfigSchema,    // immutable config reference
  progress: RunProgressSchema, // mutable position
});

const RunningBetweenStepsStateSchema = z.object({
  status: z.literal('running'),
  subStatus: z.literal('between-steps'),
  workflowId: z.string(),
  workflowName: z.string(),
  lastCompletedStep: z.string(),
  nextStep: z.string().optional(),
  startTime: z.string(),
  config: RunConfigSchema,
  progress: RunProgressSchema,
});

// The discriminated union
const WorkflowStateSchema = z.discriminatedUnion('status', [
  IdleStateSchema,
  // For 'running' sub-states, use a nested discriminatedUnion or z.union
  RunningStateSchema,  // wraps both sub-states
  PausedStateSchema,
  CompletedStateSchema,
  FailedStateSchema,
  CancelledStateSchema,
]);

// Derived type -- no manual interface needed
type WorkflowState = z.infer<typeof WorkflowStateSchema>;
```

### Pattern 2: Typed Transition Map
**What:** Map each state to its allowed events, enforced at compile time
**When to use:** For the transition() function

```typescript
// Event discriminated union
const WorkflowTransitionEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), config: RunConfigSchema }),
  z.object({ type: z.literal('step-complete'), stepName: z.string(), duration: z.number() }),
  z.object({ type: z.literal('pause'), reason: PauseReasonSchema }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('fail'), error: z.string(), step: z.string() }),
  z.object({ type: z.literal('cancel'), reason: z.string().optional() }),
  z.object({ type: z.literal('complete'), summary: z.record(z.unknown()).optional() }),
  z.object({ type: z.literal('reset') }),  // failed -> idle
]);
type WorkflowTransitionEvent = z.infer<typeof WorkflowTransitionEventSchema>;

// Transition map type -- compile-time enforcement
type TransitionMap = {
  idle: Extract<WorkflowTransitionEvent, { type: 'start' }>;
  running: Extract<WorkflowTransitionEvent, { type: 'pause' | 'fail' | 'cancel' | 'complete' | 'step-complete' }>;
  paused: Extract<WorkflowTransitionEvent, { type: 'resume' | 'cancel' }>;
  failed: Extract<WorkflowTransitionEvent, { type: 'reset' }>;
  completed: never;  // no outbound transitions
  cancelled: never;  // no outbound transitions
};

// Pure transition function
function transition(state: WorkflowState, event: WorkflowTransitionEvent): WorkflowState {
  // Runtime guard + compile-time narrowing
  switch (state.status) {
    case 'idle':
      if (event.type !== 'start') throw new InvalidTransitionError(state.status, event.type);
      return { status: 'running', subStatus: 'executing-step', /* ... */ };
    case 'running':
      // handle pause, fail, cancel, complete, step-complete
      break;
    case 'paused':
      if (event.type !== 'resume' && event.type !== 'cancel')
        throw new InvalidTransitionError(state.status, event.type);
      break;
    case 'completed':
    case 'cancelled':
      throw new InvalidTransitionError(state.status, event.type);
    case 'failed':
      if (event.type !== 'reset') throw new InvalidTransitionError(state.status, event.type);
      return { status: 'idle' };
  }
}
```

### Pattern 3: Immutable Config vs Mutable Progress
**What:** RunConfig frozen at workflow start; RunProgress tracks position
**When to use:** For SM-03

```typescript
const RunConfigSchema = z.object({
  singleStepMode: z.boolean(),
  mockLLM: z.boolean(),
  llmMode: z.enum(['public', 'local', 'mock']),
  stepIntoSubsteps: z.boolean(),
  mockLLMDelay: z.number().optional(),
}).readonly();
type RunConfig = z.infer<typeof RunConfigSchema>;

const RunProgressSchema = z.object({
  currentStepIndex: z.number(),
  currentStepName: z.string(),
  currentSubstepIndex: z.number().optional(),
  currentSubstepId: z.string().optional(),
  completedSteps: z.array(z.string()),
  currentWave: z.number().optional(),
  totalWaves: z.number().optional(),
  startTime: z.string(),
  lastUpdate: z.string(),
  elapsedSeconds: z.number(),
});
type RunProgress = z.infer<typeof RunProgressSchema>;
```

### Pattern 4: Derived Step Status (SM-04)
**What:** Pure function that computes step statuses from state machine position
**When to use:** Replaces mutable StepStatusInfo records

```typescript
function deriveStepStatuses(
  state: WorkflowState,
  stepDefinitions: readonly StepDefinition[]
): Map<string, StepStatus> {
  const statuses = new Map<string, StepStatus>();

  if (state.status === 'idle') {
    stepDefinitions.forEach(s => statuses.set(s.name, 'pending'));
    return statuses;
  }

  if (state.status === 'running' || state.status === 'paused') {
    const progress = state.progress;
    stepDefinitions.forEach((s, i) => {
      if (progress.completedSteps.includes(s.name)) {
        statuses.set(s.name, 'completed');
      } else if (i === progress.currentStepIndex && state.status === 'running') {
        statuses.set(s.name, 'running');
      } else {
        statuses.set(s.name, 'pending');
      }
    });
    return statuses;
  }

  // completed/failed/cancelled -- all steps up to terminal point
  // ... similar logic
  return statuses;
}
```

### Pattern 5: Migration Preprocess in Zod Schema
**What:** z.preprocess transforms old progress file format into new format
**When to use:** Reading progress files that may be in old format (MIG-02)

```typescript
const WorkflowStateWithMigrationSchema = z.preprocess((input) => {
  if (typeof input !== 'object' || input === null) return input;
  const obj = input as Record<string, unknown>;

  // Migrate old 'starting' status to 'running'
  if (obj.status === 'starting') {
    return { ...obj, status: 'running', subStatus: 'executing-step' };
  }

  // Migrate flat progress file to structured state
  if (obj.singleStepMode !== undefined && obj.status !== undefined) {
    return {
      status: obj.status,
      workflowId: obj.workflowId,
      config: {
        singleStepMode: obj.singleStepMode ?? false,
        mockLLM: obj.mockLLM ?? false,
        llmMode: (obj.llmState as any)?.mode ?? 'public',
        stepIntoSubsteps: obj.stepIntoSubsteps ?? false,
      },
      progress: {
        currentStepIndex: 0,
        currentStepName: obj.currentStep ?? '',
        completedSteps: (obj.stepsDetail as any[])?.filter(s => s.status === 'completed').map(s => s.name) ?? [],
        startTime: obj.startTime,
        lastUpdate: obj.lastUpdate,
        elapsedSeconds: obj.elapsedSeconds ?? 0,
      },
    };
  }

  return input;
}, WorkflowStateSchema);
```

### Anti-Patterns to Avoid
- **Mutable status fields alongside state machine:** Do not keep `stepStatuses: Record<string, StepStatusInfo>` as a mutable field. Derive it from state position via pure function.
- **Optional fields on all variants:** Each state variant should carry ONLY its relevant data. Idle has no `workflowId`; completed has no `currentStep`.
- **String enums for state:** Use `z.literal()` discriminators, not `z.enum()` for the top-level status. This is what makes the discriminated union work.
- **safeParse at boundaries:** User decision is fail-fast with `parse()`. Reserve `safeParse()` only for migration probing if needed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Runtime type validation | Manual type guards with typeof checks | Zod `schema.parse()` | Edge cases (null, undefined, extra fields, wrong types), error messages |
| Discriminated union narrowing | if/else chains on `.status` field | `z.discriminatedUnion()` + TS narrowing | Compiler catches missing cases, Zod validates at runtime |
| Type derivation | Separate interfaces + Zod schemas | `z.infer<typeof Schema>` | Single source of truth, no drift |
| Migration transforms | if/else in reader code | `z.preprocess()` on the schema | Declarative, composable, tested via Zod's own validation |

**Key insight:** With Zod-first, there is exactly one place that defines each type -- the schema. Any drift between runtime validation and compile-time types is structurally impossible.

## Common Pitfalls

### Pitfall 1: Zod discriminatedUnion with Shared Discriminator Value
**What goes wrong:** Two sub-states of 'running' (running-step, running-between-steps) share `status: 'running'` -- `z.discriminatedUnion('status', [...])` requires unique discriminator values per variant.
**Why it happens:** The user wants 'running' with sub-states, but Zod needs a unique literal per branch.
**How to avoid:** Use a two-level approach: the top-level discriminated union uses `status`, and the 'running' variant internally uses a nested `z.discriminatedUnion('subStatus', [...])` or a `z.union([...])` for its sub-states. Alternatively, flatten to `status: 'running-step' | 'running-between-steps'` at the Zod level and provide a type guard `isRunning(state)` that checks either.
**Warning signs:** Zod throws "discriminator not unique" error at schema definition time.

### Pitfall 2: Readonly Types Not Enforced at Runtime
**What goes wrong:** `RunConfig` is typed as `Readonly<{...}>` but JavaScript doesn't freeze objects -- code can still mutate at runtime.
**Why it happens:** TypeScript `readonly` is compile-time only.
**How to avoid:** Use `Object.freeze()` when constructing RunConfig. The Zod `.readonly()` modifier only affects the inferred type, not runtime behavior. Add `Object.freeze(config)` in the transition function when creating running state from idle+start event.
**Warning signs:** Config values changing mid-workflow (the sticky debug state bug).

### Pitfall 3: Circular Reference Between State and Progress
**What goes wrong:** WorkflowState includes RunProgress, RunProgress needs to reference step definitions, step definitions come from workflow config.
**Why it happens:** Natural desire to make state self-contained.
**How to avoid:** RunProgress tracks position only (indices, names, timestamps). Step definitions are external context passed to derivation functions, not embedded in state. Keep WorkflowState lean.

### Pitfall 4: Zod 4 Breaking Changes from v3 Examples
**What goes wrong:** Following Zod v3 blog posts/tutorials -- v4 changed error customization APIs.
**Why it happens:** Most online examples are Zod v3.
**How to avoid:** Use only `zod.dev` (v4 docs). Key change: `z.object({}).refine()` error API uses `error` param instead of `message`/`invalid_type_error`/`required_error`.
**Warning signs:** TypeScript errors on `.refine()` or `.superRefine()` error parameters.

### Pitfall 5: File-Copy Sync Drift
**What goes wrong:** Shared types in `shared/workflow-types/` are edited but not copied to consumers, or consumers have local edits.
**Why it happens:** Manual file-copy process.
**How to avoid:** Add a build script that copies `shared/workflow-types/*.ts` into `integrations/mcp-server-semantic-analysis/src/shared/` and `integrations/system-health-dashboard/src/shared/`. Make it part of both projects' build step. Add a git pre-commit hook or CI check that verifies files are in sync.
**Warning signs:** Type errors in one consumer but not the other.

## Code Examples

### Complete WorkflowState Schema (Recommended Structure)

```typescript
// shared/workflow-types/state.ts
import { z } from 'zod';
import { RunConfigSchema, RunProgressSchema } from './config';

const PauseReasonSchema = z.enum(['user-requested', 'single-step-boundary']);

export const IdleStateSchema = z.object({
  status: z.literal('idle'),
});

export const RunningStepStateSchema = z.object({
  status: z.literal('running'),
  subStatus: z.literal('executing-step'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  progress: RunProgressSchema,
});

export const RunningBetweenStepsStateSchema = z.object({
  status: z.literal('running'),
  subStatus: z.literal('between-steps'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  progress: RunProgressSchema,
});

// Nested union for running sub-states
export const RunningStateSchema = z.union([
  RunningStepStateSchema,
  RunningBetweenStepsStateSchema,
]);

export const PausedStateSchema = z.object({
  status: z.literal('paused'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  progress: RunProgressSchema,
  pausedAt: z.object({
    step: z.string(),
    substep: z.string().optional(),
  }),
  pauseReason: PauseReasonSchema,
  resumable: z.boolean(),
});

export const CompletedStateSchema = z.object({
  status: z.literal('completed'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  completedSteps: z.number(),
  duration: z.number(),
  summary: z.record(z.unknown()).optional(),
});

export const FailedStateSchema = z.object({
  status: z.literal('failed'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  failedStep: z.string(),
  error: z.string(),
  stackTrace: z.string().optional(),
  progress: RunProgressSchema,
});

export const CancelledStateSchema = z.object({
  status: z.literal('cancelled'),
  workflowId: z.string(),
  workflowName: z.string(),
  config: RunConfigSchema,
  cancelledAt: z.string(),
  lastStep: z.string(),
});

// Top-level: use z.discriminatedUnion on 'status'
// Note: 'running' has unique status value, sub-states distinguished internally
export const WorkflowStateSchema = z.discriminatedUnion('status', [
  IdleStateSchema,
  // For running, we need a wrapper that handles sub-states
  // Option A: flatten to separate status values at Zod level
  // Option B: single running schema with optional subStatus
  // Recommendation: single RunningStateWrapperSchema with subStatus union inside
  z.object({
    status: z.literal('running'),
    subStatus: z.enum(['executing-step', 'between-steps']),
    workflowId: z.string(),
    workflowName: z.string(),
    config: RunConfigSchema,
    progress: RunProgressSchema,
  }),
  PausedStateSchema,
  CompletedStateSchema,
  FailedStateSchema,
  CancelledStateSchema,
]);

export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export type IdleState = z.infer<typeof IdleStateSchema>;
export type PausedState = z.infer<typeof PausedStateSchema>;
export type CompletedState = z.infer<typeof CompletedStateSchema>;
export type FailedState = z.infer<typeof FailedStateSchema>;
export type CancelledState = z.infer<typeof CancelledStateSchema>;
```

### Type-Safe Transition with Compile-Time Error
```typescript
// This pattern makes invalid transitions a compile error via exhaustive switch
function transition(state: WorkflowState, event: WorkflowTransitionEvent): WorkflowState {
  switch (state.status) {
    case 'idle': {
      if (event.type !== 'start') {
        throw new InvalidTransitionError('idle', event.type);
      }
      const config = Object.freeze(event.config); // Runtime immutability
      return {
        status: 'running',
        subStatus: 'executing-step',
        workflowId: crypto.randomUUID(),
        workflowName: event.workflowName,
        config,
        progress: { currentStepIndex: 0, currentStepName: event.firstStep, completedSteps: [], startTime: new Date().toISOString(), lastUpdate: new Date().toISOString(), elapsedSeconds: 0 },
      };
    }
    case 'completed':
    case 'cancelled': {
      // Terminal states -- no valid transitions
      throw new InvalidTransitionError(state.status, event.type);
    }
    // ... other cases
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| ProgressUpdate with 16 untyped keys | WorkflowState discriminated union | This phase | Compile-time safety, no invalid state combinations |
| singleStepMode/mockLLM mixed into progress file | RunConfig (immutable) + RunProgress (mutable) | This phase | Eliminates sticky debug state bug |
| Manual type guards (isWorkflowEvent) | Zod schema.parse() | This phase | Runtime validation with automatic type narrowing |
| 'starting' as separate status | Folded into 'running' via z.preprocess migration | This phase | Fewer states, cleaner transitions |
| Zod v3 | Zod v4 (stable) | 2025 | Better discriminated union composition, maintained going forward |

**Deprecated/outdated:**
- `ProgressUpdate` interface (workflow-runner.ts:200): Replaced by WorkflowState
- `WorkflowExecutionState` (workflow-events.ts:451): Replaced by WorkflowState
- `WorkflowPreferencesState` (workflow-events.ts:468): Replaced by RunConfig
- Old status values: 'starting' -> 'running', no migration needed in types since z.preprocess handles it

## Open Questions

1. **Running sub-states in z.discriminatedUnion**
   - What we know: z.discriminatedUnion requires unique discriminator values per variant. Two running sub-states share `status: 'running'`.
   - What's unclear: Whether Zod 4's improved discriminated union composition handles nested discrimination (status='running', then subStatus='executing-step'|'between-steps').
   - Recommendation: Use a single 'running' schema with `subStatus: z.enum(...)` inside the discriminated union. The TypeScript type will still narrow correctly via `state.status === 'running' && state.subStatus === 'executing-step'`.

2. **Existing event types migration scope**
   - What we know: workflow-events.ts has 500 lines of event types, commands, and Redux state types. Some will be superseded, some kept.
   - What's unclear: Exactly which event interfaces to keep vs replace -- this is a design decision during implementation.
   - Recommendation: Keep the event types (WorkflowEvent union) but re-derive them from Zod schemas. Drop WorkflowExecutionState and WorkflowPreferencesState since WorkflowState replaces both.

3. **File-copy build integration**
   - What we know: Shared types copied into both consumers at build time. Neither consumer has a shared/ directory yet.
   - What's unclear: Exact build script mechanism (npm script, shell script, symlink).
   - Recommendation: npm `prebuild` script in each consumer that does `cp -r ../../shared/workflow-types/ src/shared/workflow-types/`. Simple, transparent, debuggable.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `workflow-events.ts` (500 lines, full event type system)
- Existing codebase: `workflow-runner.ts` (ProgressUpdate interface, writeProgress function)
- Existing codebase: `tsconfig.json` (strict mode, ES2022 target, ESNext modules)
- Zod official docs (zod.dev) -- discriminatedUnion API, preprocess, transform, z.infer

### Secondary (MEDIUM confidence)
- Zod v4 release notes (zod.dev/v4) -- confirmed stable, breaking changes from v3
- npm package versions -- zod@^4.0.0 current stable

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Zod is the decided choice, version verified as stable
- Architecture: HIGH -- discriminated union pattern is well-established TypeScript idiom; existing code thoroughly analyzed
- Pitfalls: HIGH -- identified from direct analysis of existing codebase (sticky debug state, mixed config/progress, 16 untyped keys)

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain, Zod 4 just released)
