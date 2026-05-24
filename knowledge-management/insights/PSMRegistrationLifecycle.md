# PSMRegistrationLifecycle

**Type:** Detail

By bookending the child_process.spawn call with PSM registration, dashboard-service.js guarantees that the registry entry is only live while the spawned Next.js process is actually running, preventing stale entries that could mislead health checks or orchestration logic.

# PSMRegistrationLifecycle

## What It Is

PSMRegistrationLifecycle is the runtime contract implemented in `scripts/dashboard-service.js` (and mirrored in `scripts/api-service.js`) that governs how Dockerized services register themselves with the PSM (Process/Service Manager) registry at startup and unregister themselves at shutdown. It is a Detail-level concern within both the `DashboardWrapper` and `ConstraintAPIWrapper` parent entities, representing the shared lifecycle bookkeeping that keeps the PSM registry consistent with the actual state of spawned child processes.

The lifecycle is structured as a tight bracket around the `child_process.spawn` call that launches the underlying service (the Next.js dashboard process in the case of `dashboard-service.js`). A `registerService` call announces the service before or immediately as the child process becomes live, and an `unregisterService` call is wired into the process exit event to guarantee cleanup. This bracketing ensures the PSM registry's view of "what is running" stays aligned with what is actually executing under the wrapper.

Because the same pattern appears in both `dashboard-service.js` and `api-service.js`, PSMRegistrationLifecycle effectively defines a shared PSM contract across all Dockerized services in the project, rather than being a one-off implementation detail of a single wrapper.

## Architecture and Design

The architectural pattern at work is a **wrapper/bracket lifecycle** around a spawned subprocess. The wrapper script (`scripts/dashboard-service.js`) is not the service itself; it is a thin supervisor that owns three responsibilities: spawning the real service via `child_process.spawn`, registering that service in the PSM registry, and ensuring deregistration happens on exit. This separation lets the underlying Next.js process remain unaware of PSM concerns, while the wrapper handles all registry-side coordination.

The structural sequence — spawn, registerService, wire signals, unregisterService on exit — is shared exactly between `dashboard-service.js` and `api-service.js`. This consistency means PSMRegistrationLifecycle co-exists with a sibling concern, `SignalForwarder`, which is wired into the same startup sequence immediately after the child process is spawned. Together, lifecycle registration and signal forwarding form the two pillars of the wrapper's runtime contract: registration keeps the registry honest, while signal forwarding keeps the child process responsive to orchestration signals.

A key design decision is binding `unregisterService` to the **process exit event** rather than only to a normal shutdown path. This is a defensive choice: even if the dashboard wrapper terminates unexpectedly — crash, uncaught exception, or external kill — the exit handler still fires, preventing the PSM registry from accumulating stale entries that would otherwise mislead downstream health checks or orchestration logic.

## Implementation Details

In `scripts/dashboard-service.js`, the implementation follows a deliberate ordering. First, `child_process.spawn` is invoked to launch the Next.js process. Immediately thereafter, `registerService` is called against the PSM registry to publish the service's presence. Signal handlers are wired at this point (the `SignalForwarder` sibling concern), and finally `unregisterService` is attached to the process's exit event.

The bookending of `child_process.spawn` with PSM registration is the central mechanic: the registry entry is only live while the spawned Next.js process is actually running. There is no window during which the registry advertises a service that hasn't yet started, and no window after the child dies during which the registry still claims it is up. This invariant is what makes PSM-driven health checks and orchestration decisions trustworthy.

The `api-service.js` implementation mirrors this structure exactly, which means the lifecycle logic is effectively duplicated-by-convention across the two wrappers rather than abstracted into a shared module. The observations describe the pattern as identical in shape: spawn, registerService, wire signals, unregisterService on exit. This duplication is the current state of the codebase and is what makes the contract "shared" — through pattern conformance rather than through a shared base class or helper.

## Integration Points

PSMRegistrationLifecycle integrates with three external surfaces. First, it depends on the PSM registry's `registerService` and `unregisterService` APIs — the registry is the system of record for which services are live. Second, it depends on Node.js's `child_process` module and on the process-level `exit` event, which it uses as the deterministic trigger for cleanup. Third, it integrates implicitly with whatever orchestration layer consumes the PSM registry, because the correctness of that layer's decisions depends on the lifecycle's invariants.

Within the project's component hierarchy, PSMRegistrationLifecycle is contained by both `DashboardWrapper` and `ConstraintAPIWrapper`, reflecting that the same lifecycle Detail appears in both wrappers. Its sibling `SignalForwarder` shares the startup sequence inside the wrapper, and the two together fully describe the wrapper's responsibilities beyond simply launching a child process. The parent `DashboardWrapper` is documented as mirroring `api-service.js` exactly, which is why PSMRegistrationLifecycle can be reasoned about uniformly across both wrappers.

## Usage Guidelines

When adding a new Dockerized service to this project, the wrapper script for that service should follow the same four-step sequence: spawn the child process, call `registerService` to publish it to the PSM registry, wire signal handlers (the `SignalForwarder` concern), and attach `unregisterService` to the process exit event. Deviating from this ordering — for instance, calling `registerService` before deciding whether the spawn will succeed, or attaching `unregisterService` only to SIGTERM rather than to exit — will break the invariant that registry state matches actual process state.

Developers should resist the temptation to skip the exit-event binding in favor of only handling graceful shutdown signals. The current design specifically uses the exit event to cover unexpected termination paths; narrowing that to graceful shutdown alone would reintroduce the risk of stale registry entries that the design exists to prevent.

Finally, because PSMRegistrationLifecycle is currently implemented as a duplicated pattern across `dashboard-service.js` and `api-service.js` rather than as a shared helper, any change to the contract (such as a new registry field or a new lifecycle hook) must be applied to both wrappers — and to any future wrapper — to preserve the shared PSM contract. Treat the pattern itself as the source of truth until it is consolidated into a shared module.


## Hierarchy Context

### Parent
- [DashboardWrapper](./DashboardWrapper.md) -- scripts/dashboard-service.js mirrors the structural pattern of api-service.js exactly: spawn via child_process, registerService, wire signals, unregisterService on exit

### Siblings
- [SignalForwarder](./SignalForwarder.md) -- scripts/dashboard-service.js wires signal handlers as part of its startup sequence (described as 'wire signals' in the structural pattern shared with api-service.js), meaning signal forwarding is set up immediately after the child process is spawned.


---

*Generated from 3 observations*
