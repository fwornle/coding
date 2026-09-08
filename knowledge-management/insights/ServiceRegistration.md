# ServiceRegistration

**Type:** Detail

[Architecture Notes] Tight coupling between child_process spawn/exit event handlers and PSM registration/unregistration calls, with no shared abstraction layer between scripts/api-service.js and scripts/dashboard-service.js; No timeout/deadline protection (unlike lib/service-starter.js's withDeadline()) wraps the PSM registerService/unregisterService calls in either wrapper script, despite that pattern existing elsewhere in the codebase; Asymmetric logging: registration failures are logged via console.error; unregistration failures during exit are silently swallowed with only a code comment; Dynamic `import('./process-state-manager.js')` is repeated per-call-site (register IIFE and exit handler each re-import and re-instantiate ProcessStateManager) rather than importing once at module scope

# ServiceRegistration — Technical Insight Document

## What It Is

ServiceRegistration refers to the pattern by which child-process wrapper scripts — specifically `scripts/api-service.js` and `scripts/dashboard-service.js` — register and unregister themselves with `ProcessStateManager` (PSM), the parent entity that owns this registration mechanism. The concrete call sites are:

- `scripts/api-service.js:69-85` — an async IIFE that calls `psm.registerService(...)` with metadata including `parentWrapper: process.pid`, registering under the name `'constraint-api-child'`.
- `scripts/api-service.js:47-52` — a `child.on('exit')` handler that calls `unregisterService`, keyed only by name and type (`'constraint-api-child', 'global'`).
- `scripts/dashboard-service.js:64-83` and `scripts/dashboard-service.js:44-49` — structurally mirrored registration and unregistration logic for `'constraint-monitor-dashboard'` / `'constraint-dashboard-child'`.

This mechanism operates inside the broader lifecycle context of `docker/entrypoint.sh:1-160`, where these wrapper scripts run as supervisord-managed child programs.

## Architecture and Design

The dominant pattern is **fire-and-forget async registration**: an IIFE performs PSM registration as a side channel, decoupled from the primary process startup/shutdown flow. This is paired with a **best-effort/non-blocking telemetry philosophy** — registration and unregistration failures are caught and swallowed, never affecting the core service's actual start or stop behavior. PSM bookkeeping is treated as advisory metadata, not a control-flow dependency.

A notable structural decision is **name-based rather than PID-based resource identity**. Even though `child.pid` is available at the call site (and is even passed as `parentWrapper: process.pid` during registration), the unregistration call keys purely by service name and type. This discards the more specific identifier in favor of a static string key, which is simpler but less precise if multiple instances of the same service type could ever coexist.

The two wrapper scripts exhibit **structural duplication** rather than sharing a common registration helper — the same IIFE-plus-exit-handler pattern is copy-pasted between `api-service.js` and `dashboard-service.js` with only name/type parameters changed. This is a maintainability trade-off: simplicity and independence per-script at the cost of duplicated logic that must be kept in sync manually.

## Implementation Details

Each wrapper script performs a **dynamic `import('./process-state-manager.js')`** independently at each call site — once in the registration IIFE, and again in the exit handler — rather than importing PSM once at module scope. This means `ProcessStateManager` is effectively re-instantiated per call, which is a mechanical inefficiency without an obvious functional benefit.

Logging is **asymmetric**: registration failures are logged via `console.error`, giving visibility into problems at startup, while unregistration failures during process exit are silently swallowed with only a code comment as documentation — no runtime signal. This asymmetry reflects an implicit assumption that unregistration failures matter less (perhaps because the process is already terminating), but it also means unregistration issues are effectively invisible in production.

Notably absent is any **timeout/deadline protection** around the PSM `registerService`/`unregisterService` calls. This is a deliberate contrast with `lib/service-starter.js:70-89`, which implements a `withDeadline()` utility used elsewhere in the codebase for bounding async operations. Neither wrapper script applies this existing pattern to its PSM calls, despite the precedent being available.

There is **tight coupling** between `child_process` spawn/exit event handlers and the PSM registration calls, with no shared abstraction layer bridging `scripts/api-service.js` and `scripts/dashboard-service.js`.

## Integration Points

ServiceRegistration is a child concept under `ProcessStateManager (class)` in `process-state-manager.js`, which supplies the `registerService`/`unregisterService` API consumed by both wrapper scripts. Its sibling, `PsmIntegrationInStartupOrchestration`, clarifies an important architectural boundary: PSM registration is **orthogonal** to both major orchestration layers in the system — it does not feed `startServiceWithRetry()`'s health-check logic in `lib/service-starter.js` (health checks are supplied externally by the coordinator, not sourced from PSM), and it is not referenced anywhere in `docker/entrypoint.sh`'s `PROGRAM_FEATURES` gating.

This produces two disjoint bookkeeping systems describing overlapping facts about the same child processes: supervisord's own process table (authoritative in the containerized path) and PSM's registry (populated by the wrapper scripts regardless of who actually owns the process lifecycle). A supervisord-launched `dashboard-service.js` or `api-service.js` still performs its PSM register/unregister dance even though supervisord — not the Node-based coordinator — owns its lifecycle in that deployment path.

## Usage Guidelines

Developers extending or modifying this mechanism should treat PSM registration as **non-authoritative telemetry**, not a lifecycle control mechanism — do not build logic that depends on PSM registry state being consistent with actual process state, especially in the supervisord-managed path. When adding new wrapper scripts, consider extracting a shared registration helper rather than duplicating the IIFE/exit-handler pattern found in `api-service.js` and `dashboard-service.js`, to reduce drift risk. If deadline protection is a codebase-wide concern, apply `withDeadline()` from `lib/service-starter.js` consistently to PSM calls to avoid resource stalls. Finally, be aware of the logging asymmetry: if debugging unregistration issues, know that failures there are currently silent, and add explicit logging before relying on absence-of-errors as a signal of correctness. Given the identity mismatch (name+type keys vs. available PID), avoid assuming registry entries uniquely identify a specific process instance.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- [CGR] ProcessStateManager (class) in process-state-manager.js

### Siblings
- [PsmIntegrationInStartupOrchestration](./PsmIntegrationInStartupOrchestration.md) -- [LLM] PsmIntegrationInStartupOrchestration sits at the intersection of two independent orchestration layers that never call each other: lib/service-starter.js's startServiceWithRetry()/withDeadline() drives the retry-and-health-check lifecycle for services started directly by the Node-based Global Service Coordinator, while docker/entrypoint.sh drives a completely separate, shell-based gating mechanism for supervisord-managed programs inside the container. ProcessStateManager registration in scripts/api-service.js and scripts/dashboard-service.js is orthogonal to both — it neither feeds startServiceWithRetry()'s health check (healthCheckFn is passed in by the coordinator, not sourced from PSM) nor is it referenced anywhere in entrypoint.sh's PROGRAM_FEATURES gating. This means a supervisord-launched dashboard-service.js/api-service.js still performs its own PSM register/unregister dance even though supervisord — not the coordinator — actually owns its process lifecycle in the containerized path, producing two disjoint bookkeeping systems (supervisord's process table and PSM's registry) describing overlapping but not identical facts about the same child processes.


---

*Generated from 9 observations*
