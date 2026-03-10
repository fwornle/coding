# Research Summary: v3.0 Workflow State Machine

**Domain:** Typed state machine for workflow orchestration in TypeScript/React/Redux codebase
**Researched:** 2026-03-10
**Overall confidence:** HIGH

## Executive Summary

The v3.0 milestone replaces ad-hoc workflow state management with a typed state machine. The current system uses an untyped JSON progress file, competing state sources (SSE events, polling, progress file, Redux store), and boolean flags that get stuck — causing broken step coloring, fallback inference in the dashboard, and edge cases on every fix.

Research concludes that hand-rolled TypeScript discriminated unions are the right approach — not XState v5 or robot3. The workflow has ~6 states and ~10 transitions, which is far below the complexity threshold where a state machine library adds value. XState v5 critically cannot associate different data shapes with different states (a v6 feature), which is exactly what this workflow needs (idle has no data, running has currentStep, failed has error). Discriminated unions provide this natively.

The only new dependency is Zod for runtime validation at system boundaries (reading progress from disk, parsing SSE events, validating API responses). Everything else is TypeScript types layered onto existing Express SSE, Redux, and file I/O code. The typed state becomes the single source of truth: backend owns it, emits it via typed SSE events, dashboard consumes and displays it — no inference, no guessing.

Shared types between backend and frontend should use a simple file copy with a sync script, not a separate npm package. The codebase already has 3 submodules with build+Docker cycles; adding a 4th for ~100 lines of types would slow iteration without proportional benefit.

## Key Findings

**Stack:** Hand-rolled discriminated union state machine + Zod for runtime validation. Zero new frameworks.
**Architecture:** Backend owns state, emits typed SSE events, dashboard is a pure consumer via Redux.
**Critical pitfall:** Migrating the progress file format without a backward-compatible reader will break in-progress workflows.

## Implications for Roadmap

Based on research, suggested phase structure:

1. **Define Types** - Define WorkflowState, WorkflowEvent, SSEEvent discriminated unions + Zod schemas
   - Addresses: Untyped state, no single source of truth
   - Avoids: Building on sand — all subsequent phases depend on correct type definitions

2. **Backend State Machine** - Replace workflow-runner.ts ad-hoc state with typed transitions
   - Addresses: Stuck boolean flags, competing state sources
   - Avoids: Premature dashboard changes before backend emits correct state

3. **SSE Event Typing** - Type the existing Express SSE layer, emit WorkflowState on every transition
   - Addresses: Dashboard fallback inference (root cause: untyped/incomplete events)
   - Avoids: Transport replacement (SSE works fine, typing is the problem)

4. **Dashboard Consumer** - Replace Redux inference logic with typed SSE event handlers
   - Addresses: Wrong step coloring, stuck states, "Batch" label
   - Avoids: Any state computation in dashboard — pure display of backend state

5. **Migration + Cleanup** - Backward-compatible progress file reader, remove old inference code
   - Addresses: In-progress workflow compatibility, dead code removal

**Phase ordering rationale:**
- Types first because every other phase imports them
- Backend before frontend because dashboard consumes backend state
- SSE before dashboard because dashboard needs typed events to consume
- Migration last because it's cleanup, not new capability

**Research flags for phases:**
- Phase 2: Standard patterns, unlikely to need research
- Phase 4: May need research on Redux Toolkit patterns for discriminated union action payloads

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack (no XState) | HIGH | XState v5 confirmed lacks state-specific context; DU is native TS |
| Stack (Zod) | HIGH | Industry standard, zero deps, 30M+ weekly downloads |
| Architecture | HIGH | Pattern is well-established: backend owns state, frontend consumes |
| Pitfalls | MEDIUM | Progress file migration needs careful design; exact format TBD |
| SSE typing | HIGH | No new library needed, just types on existing Express code |

## Gaps to Address

- Exact WorkflowState variants need to be enumerated from current workflow-runner.ts behavior
- Dashboard Redux slice structure needs audit to understand how deeply inference logic is embedded
- Progress file backward compatibility strategy needs design during Phase 5

---
*Research summary for: v3.0 Workflow State Machine*
*Researched: 2026-03-10*
