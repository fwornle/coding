# Feature Landscape: v3.0 Workflow State Machine

**Domain:** Typed workflow state management
**Researched:** 2026-03-10

## Table Stakes

Features that solve the problems driving this milestone. Missing = milestone fails.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Typed workflow states (idle/running/paused/completed/failed) | Eliminates untyped JSON progress file | Medium | Discriminated union + Zod schema |
| Typed SSE events | Eliminates dashboard fallback inference | Medium | Type existing Express SSE code |
| Single source of truth for state | Eliminates competing state sources | Medium | Backend state machine is authoritative |
| Correct step/substep status | Fixes broken coloring (green vs blue, stuck states) | Medium | Dashboard displays backend state, no guessing |
| Typed transition functions | Prevents invalid state transitions | Low | `transition(state, event): WorkflowState` pure function |
| Runtime validation at boundaries | Prevents stuck flags from malformed progress file | Low | Zod parse on file read, SSE parse, API response |

## Differentiators

Features that go beyond fixing bugs to improve the development experience.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Exhaustive switch checking | Compiler catches unhandled states | Low | Native TS with `never` default case |
| State history/audit log | Debug why a workflow entered a bad state | Medium | Append-only log of state transitions |
| Typed single-step/substep mode | Replaces sticky boolean flags with state variants | Medium | `paused` state variant carries resume context |
| "Wave Analysis" label (replace "Batch") | UI correctness — matches actual workflow name | Low | Trivial once state machine owns workflow metadata |
| Progress percentage from state machine | Accurate progress bar instead of guessed percentages | Low | State machine knows step count and current position |

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Visual state machine editor (Stately.ai style) | Over-engineering for ~6 states; team is developers | Define states in TypeScript code |
| Workflow DSL / YAML state definition | Adds indirection; TS types ARE the definition | TypeScript discriminated unions |
| Distributed state (Redis/DB backed) | Single workflow runner process, no distributed state needed | In-memory state + progress file backup |
| Undo/redo workflow transitions | Workflows are forward-only; retry is restart | Restart from beginning or last checkpoint |
| Generic state machine library for reuse | YAGNI — only one workflow type exists | Purpose-built types for wave-analysis |

## Feature Dependencies

```
Typed WorkflowState definition
  -> Backend state machine (uses types)
  -> Typed SSE events (uses types)
     -> Dashboard consumer (uses typed SSE events)
        -> Correct step coloring (result of typed consumption)
        -> "Wave Analysis" label (result of typed metadata)

Zod schemas
  -> Runtime validation on file read
  -> Runtime validation on SSE parse
  -> Runtime validation on API response

Typed single-step mode
  -> Requires typed WorkflowState.paused variant
  -> Replaces boolean flags (singleStepMode, stepPaused, stepIntoSubsteps)
```

## MVP Recommendation

Prioritize:
1. WorkflowState discriminated union + Zod schemas (everything depends on this)
2. Backend state machine replacing workflow-runner.ts ad-hoc state (fixes root cause)
3. Typed SSE events (enables dashboard fix)
4. Dashboard as pure consumer (fixes visible bugs)

Defer:
- State history/audit log — nice-to-have, not blocking any bug fix
- Progress percentage — can be added once state machine is stable

---
*Feature landscape for: v3.0 Workflow State Machine*
*Researched: 2026-03-10*
