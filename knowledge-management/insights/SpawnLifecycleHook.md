# SpawnLifecycleHook

**Type:** Detail

The hook boundary decouples the spawning mechanism (whatever creates the child process) from state tracking, so process-state-manager.js has no dependency on how or why a process was started, only on being notified via registerService().

# SpawnLifecycleHook

## What It Is

`SpawnLifecycleHook` is a lifecycle integration point implemented within `scripts/process-state-manager.js` as part of the `ProcessStateManager` component. It is not a standalone module but rather a defined hook boundary expressed through two paired entry points: `registerService()`, which is invoked immediately after a child process is spawned, and `unregisterService()`, which is invoked when the process exits. Together these form a symmetric contract that mediates between whatever code spawns child processes and the state-tracking infrastructure that needs to know about them.

The hook exists to capture a specific, narrow piece of information at a precise moment in time: the PID and associated metadata of a freshly spawned process, recorded into the `ServiceRegistry` before any further orchestration logic executes. By isolating this concern, the hook ensures that downstream consumers can rely on the registry as an authoritative, up-to-date view of which child processes are currently alive.

## Architecture and Design

The architectural approach centers on a **lifecycle hook pattern** with strict symmetric pairing. `registerService()` on spawn and `unregisterService()` on exit are treated as complementary operations, and the design guarantees that the `ServiceRegistry`'s contents at any moment exactly mirror the set of currently live child processes. This invariant is the core architectural promise of the component — it transforms what would otherwise be ephemeral process events into queryable, persistent state for the duration of each process's lifetime.

A key design decision is **decoupling via the hook boundary**. The spawning mechanism — whatever code actually creates the child process — has no direct dependency on `process-state-manager.js`, and conversely `process-state-manager.js` has no knowledge of how or why a process was started. The only contract between them is the notification call to `registerService()`. This inversion of dependency means new spawning code paths can be added without modifying the state manager, and the state manager can evolve its internal representation without breaking callers.

The component also embraces a **stateless-between-calls** design at the manager level: `scripts/process-state-manager.js` itself holds no temporal reasoning logic. All knowledge about whether a service is "live" is derived purely from the presence or absence of its identifier in the `ServiceRegistry` at query time. This pushes the source of truth into a single, observable data structure (the sibling `ServiceRegistry`) and eliminates the need for separate state machines, timers, or liveness caches inside the manager itself.

## Implementation Details

The hook is realized through two functions exposed by `scripts/process-state-manager.js`. The `registerService()` entry point is called immediately after a child process is spawned and records the PID together with associated metadata into the `ServiceRegistry`. The strict ordering constraint here is significant: PID capture must occur before any further orchestration logic runs, ensuring that no window exists in which a live process is untracked. The complementary `unregisterService()` call removes the corresponding entry when the process exits, restoring the registry-to-reality correspondence.

Because the `ProcessStateManager` parent component houses both this hook and the `ServiceRegistry` sibling within the same file, the hook implementation can directly mutate the registry — keyed by service identifier and holding at minimum the recorded PID — without crossing module boundaries. This keeps the mutation surface small and auditable: only the hook functions write to the registry, and they do so in a structured, paired manner.

The metadata recorded alongside the PID at spawn time is the only data the registry holds for a service, and it is established once at registration. There is no provision in the lifecycle hook itself for mid-lifetime state updates; the hook's responsibility ends with registration, and the registry entry persists unchanged until `unregisterService()` removes it.

## Integration Points

The primary integration point is the call site of `registerService()`, which must be invoked by spawning code immediately after creating a child process. This is the sole channel through which external code informs `ProcessStateManager` of new processes — there is no polling, no process scanning, and no automatic discovery mechanism. The symmetric companion, `unregisterService()`, must be wired to the child process's exit event to maintain the registry invariant.

Downstream, the hook integrates with the sibling `ServiceRegistry` component, which is the sole mutable store for live process state. Any consumer that needs to determine whether a service is currently running performs that determination by querying the registry for the relevant identifier; the hook's registrations and unregistrations are what give those <USER_ID_REDACTED> meaning. This makes the `SpawnLifecycleHook` indirectly the source of every liveness signal the system can produce.

The hook deliberately has **no dependency** on the spawning mechanism. It does not care whether a process was started via `child_process.spawn`, a higher-level abstraction, a script runner, or any other means — it requires only that the caller invoke `registerService()` with the appropriate identifier, PID, and metadata. This loose coupling is the principal integration design choice.

## Usage Guidelines

Developers integrating with `SpawnLifecycleHook` should observe the following conventions:

- **Call `registerService()` immediately after spawning**, before any other orchestration logic. Delaying this call opens a window in which a live child process exists but is not tracked by the `ServiceRegistry`, breaking the core invariant of the design.
- **Always pair `registerService()` with `unregisterService()`** on the corresponding process exit. Leaking registrations leaves stale entries that will make the registry report dead processes as live, corrupting every downstream liveness query.
- **Treat the registry as the only source of truth for liveness**. Do not maintain parallel tracking structures or cached liveness state outside the registry, because `process-state-manager.js` itself is stateless between calls and relies on the registry being the singular authority.
- **Pass complete metadata at registration time**. Because the hook's responsibility ends with the initial registration, metadata that may be needed later by consumers must be supplied up front; there is no defined mid-lifetime update path.
- **Do not assume any spawning mechanism**. When extending or refactoring spawning code, preserve the hook contract but feel free to change underlying spawn implementations — the hook boundary was designed precisely to make this safe.

---

### Summary of Analysis

1. **Architectural patterns identified**: Lifecycle hook pattern with symmetric register/unregister pairing; dependency inversion at the hook boundary; single-source-of-truth state model anchored in `ServiceRegistry`.

2. **Design decisions and trade-offs**: Choosing a notification-based hook over automatic process discovery trades a small caller obligation for complete decoupling from spawning mechanisms. Making `process-state-manager.js` stateless between calls trades the convenience of cached derived state for the simplicity and correctness of a single mutable store.

3. **System structure insights**: `SpawnLifecycleHook` and `ServiceRegistry` are co-located siblings within the parent `ProcessStateManager`, allowing the hook to mutate registry state directly while presenting a narrow external interface (`registerService()`/`unregisterService()`) to the rest of the system.

4. **Scalability considerations**: The hook performs O(1) work per spawn/exit event and the registry is keyed by service identifier, so the design scales linearly with the number of live child processes. Because there is no polling or background reconciliation, overhead is proportional only to actual lifecycle events.

5. **Maintainability assessment**: The narrow hook contract and symmetric design make the component highly maintainable — changes to spawning logic do not propagate into the state manager, and changes to registry representation do not propagate out to callers. The principal maintenance risk is unpaired calls (registration without unregistration or vice versa), which would silently violate the registry's mirror-of-reality invariant.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- scripts/process-state-manager.js exposes registerService() as the entry point called immediately after a child process is spawned, recording PID and associated metadata into the registry

### Siblings
- [ServiceRegistry](./ServiceRegistry.md) -- Defined within scripts/process-state-manager.js, the registry is the sole mutable store for live process state, keyed by service identifier and holding at minimum the PID recorded at spawn time.


---

*Generated from 4 observations*
