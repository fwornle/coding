# Domain Pitfalls: v3.0 Workflow State Machine

**Domain:** Typed state machine for workflow orchestration
**Researched:** 2026-03-10

## Critical Pitfalls

### Pitfall 1: Breaking In-Progress Workflows During Migration
**What goes wrong:** Changing the progress file format causes a running workflow to crash on the next heartbeat write, or a paused workflow to fail on resume.
**Why it happens:** workflow-runner.ts writes progress on every heartbeat and state change. Format mismatch causes parse failures.
**Consequences:** Data loss — partially completed workflow must restart from scratch.
**Prevention:** Backward-compatible reader that handles both old (untyped) and new (Zod-validated) formats. Use a `version` field. If absent, treat as legacy and convert.
**Detection:** Zod parse errors in workflow-runner.ts logs when reading progress file.

### Pitfall 2: Dashboard Still Inferring After "Pure Consumer" Refactor
**What goes wrong:** Remove some inference logic, miss other paths. Dashboard shows contradictory state.
**Why it happens:** Inference logic scattered across Redux selectors, React components, utility functions.
**Consequences:** Worse than before — two competing systems create impossible UI states.
**Prevention:** Complete audit before writing code. Grep for every place that reads stepStatus, substepStatus, progress percentage. Convert ALL in one phase.
**Detection:** Any if/else in dashboard components that computes step status instead of reading from Redux.

### Pitfall 3: SSE Event Loss During Reconnect
**What goes wrong:** Dashboard loses SSE connection, misses a state transition, shows stale state.
**Why it happens:** SSE has no built-in delivery guarantee.
**Consequences:** Dashboard shows "running" when workflow is "completed".
**Prevention:** On SSE reconnect, fetch current state via HTTP GET. Add `GET /api/workflow/state` endpoint.
**Detection:** Dashboard state differs from `curl localhost:3033/api/ukb/status`.

## Moderate Pitfalls

### Pitfall 4: Zod Schema Drift Between Backend and Frontend
**What goes wrong:** Schema updated in backend, forgotten in dashboard copy. Frontend rejects valid events.
**Prevention:** Sync script in dashboard build step. Header comment: `// GENERATED — do not edit`.

### Pitfall 5: Transition Function Allows Invalid States
**What goes wrong:** Missed guard allows `completed -> paused` or `failed -> STEP_ADVANCE`.
**Prevention:** Test matrix: every state x event combination (~36 cases). Most should throw InvalidTransition.

### Pitfall 6: Progress File Write Blocks Event Loop
**What goes wrong:** Synchronous `fs.writeFileSync` blocks Node.js event loop, causes SSE heartbeat timeouts.
**Prevention:** Use `fs.promises.writeFile` with debounce. Write at most once per second, always on terminal states.

## Minor Pitfalls

### Pitfall 7: Forgetting `never` Exhaustive Check
**What goes wrong:** New state variant added, not handled in switch. No compiler error without the check.
**Prevention:** Always include `default: const _exhaustive: never = state;` in every switch.

### Pitfall 8: Date Serialization Mismatch
**What goes wrong:** Zod schema uses `z.date()` but JSON serialization produces strings.
**Prevention:** Use `z.string()` for dates in schemas crossing serialization boundaries.

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Type definition | Schema drift (Pitfall 4) | Sync script in build, header comment |
| Backend state machine | Invalid transitions (Pitfall 5) | Full state x event test matrix |
| SSE typing | Event loss on reconnect (Pitfall 3) | HTTP GET fallback on reconnect |
| Dashboard consumer | Leftover inference (Pitfall 2) | Complete audit before writing code |
| Migration | Breaking in-progress workflows (Pitfall 1) | Version field, backward-compatible reader |

---
*Pitfalls for: v3.0 Workflow State Machine*
*Researched: 2026-03-10*
