# ServiceRegistry

**Type:** Detail

api-service.js and dashboard-service.js each call psm.registerService() immediately after spawning their child processes, inserting a service-name-to-process-handle entry into this shared map so downstream consumers have an up-to-date view.

# ServiceRegistry

## What It Is

ServiceRegistry is an in-memory map data structure contained within `ProcessStateManager` (PSM) that maintains the canonical mapping of service names to their corresponding child process handles. Based on the observations, it is accessed and mutated through PSM's public surface—specifically `psm.registerService()` for insertion and `psm.unregisterService()` for removal—and is consumed by at least three scripts in the system: `api-service.js`, `dashboard-service.js`, and `health-coordinator.js`.

Functionally, the registry serves as the single source of truth for "which services are currently alive and reachable." When a wrapper script spawns its child process, it registers a name-to-handle entry; when that child exits, the entry is removed via the wrapper's exit handler. Any other component that needs to enumerate or act on live services—most notably `health-coordinator.js`—reads this same map rather than maintaining its own bookkeeping.

## Architecture and Design

The architectural approach is a **shared mutable registry** layered on top of a **singleton module**. The registry itself is a simple map, but its system-wide coherence depends entirely on the fact that its parent `ProcessStateManager` is exposed through the `SingletonModulePattern` (its sibling concept at the same level). Because Node.js caches the result of the first `require()` call for a given module, every importer—`api-service.js`, `dashboard-service.js`, and `health-coordinator.js`—obtains the exact same PSM instance and therefore the exact same registry object. No explicit reference passing, dependency injection, or service-locator boilerplate is required.

This design produces an **implicit inter-script communication channel**. Rather than introducing message-passing, IPC sockets, or an event bus between the wrapper scripts and the health coordinator, the registry functions as shared state that all participants read and write. Producers (the wrappers) mutate the map at well-defined lifecycle moments—immediately after spawning a child, and inside the exit handler—and the consumer (`health-coordinator.js`) treats the map as an authoritative snapshot at probe time.

The pattern trades the indirection of formal IPC for the simplicity of in-process shared memory. It is only viable because all consumers run in the same Node.js process and load PSM through the same module resolution path. The registry is therefore tightly coupled to PSM's singleton guarantee; any change that breaks that guarantee (e.g., loading PSM under two different paths, or running consumers in separate processes) would silently fragment the registry into disjoint views.

## Implementation Details

The registry exposes two primary mutation entry points through its parent `ProcessStateManager`:

- **`psm.registerService(name, handle)`** — Called by `api-service.js` and `dashboard-service.js` immediately after each spawns its child process. This insertion happens synchronously with spawn so that downstream consumers never observe a window in which the process exists but the registry does not reflect it.
- **`psm.unregisterService(name)`** — Invoked inside the wrapper scripts' exit handlers. When the child process terminates, the wrapper removes the corresponding entry, preventing `health-coordinator.js` from later probing a dead handle.

On the read side, `health-coordinator.js` iterates the registry to determine which services are currently active and eligible for health probing. Critically, the coordinator keeps **no separate bookkeeping** of its own; it treats the registry as the definitive list. This means correctness of health probing depends entirely on the wrappers maintaining their register/unregister discipline at the correct lifecycle boundaries.

The map itself is a plain in-memory structure with no persistence layer. Because all access occurs within a single Node.js process under cooperative single-threaded execution, no locking or synchronization primitives are needed—the JavaScript event loop serializes all reads and writes automatically.

## Integration Points

ServiceRegistry sits at the convergence of three caller surfaces:

1. **Producer wrappers** — `api-service.js` and `dashboard-service.js` are the registry's writers. They depend on PSM solely for the `registerService` / `unregisterService` lifecycle hooks. Each maintains a 1:1 relationship between its spawned child and a single registry entry.
2. **Consumer coordinator** — `health-coordinator.js` is the registry's primary reader. Its health-probing loop is driven entirely by registry contents, making it transitively dependent on the wrappers' correct usage of the registration API.
3. **Containing module** — `ProcessStateManager` owns the registry's lifetime, and the `SingletonModulePattern` (its sibling) guarantees that all three consumers share one instance. This containment relationship is what allows the registry to function as a coordination point without explicit wiring.

There are no observed external integrations—no database, no IPC, no network protocol. All coupling is in-process and via Node's module cache.

## Usage Guidelines

When working with ServiceRegistry, developers should observe the following conventions:

- **Register synchronously with spawn.** Always call `psm.registerService()` immediately after spawning a child process, as `api-service.js` and `dashboard-service.js` do. Delaying registration opens a window in which `health-coordinator.js` cannot see the new service.
- **Unregister from the exit handler.** Stale entries cause `health-coordinator.js` to probe dead process handles. The established pattern is to invoke `psm.unregisterService()` inside the wrapper's child-exit handler, ensuring the map stays consistent with actual process state.
- **Do not duplicate registry state.** `health-coordinator.js` deliberately avoids maintaining its own list of services; new consumers should follow the same convention. Parallel bookkeeping would drift out of sync and reintroduce the bugs the singleton registry is designed to eliminate.
- **Preserve the singleton invariant.** Because the registry's correctness depends on every consumer importing the same `ProcessStateManager` instance (via the `SingletonModulePattern`), avoid any change that could cause PSM to be loaded under two module paths, bundled into separate process boundaries, or instantiated explicitly. Such a change would silently split the registry into disjoint views and break health probing.
- **Treat reads as point-in-time snapshots.** The map can change between iteration steps as wrappers register or unregister. Consumers should not assume registry stability across asynchronous boundaries.

---

### Summary of Insights

1. **Architectural patterns identified:** Shared mutable in-memory registry built atop a singleton module; implicit inter-process-script coordination via shared state in lieu of IPC.
2. **Design decisions and trade-offs:** Chooses simplicity (plain map + module-cache singleton) over formal IPC or dependency injection. Trade-off: zero ceremony and zero latency, at the cost of being tightly coupled to single-process execution and the singleton guarantee.
3. **System structure insights:** Three scripts (`api-service.js`, `dashboard-service.js`, `health-coordinator.js`) coordinate through a single object inside `ProcessStateManager`. Producers mutate at spawn/exit boundaries; the sole consumer treats the registry as authoritative with no shadow state.
4. **Scalability considerations:** Bounded to a single Node.js process. Cannot scale to multiple host processes, multiple nodes, or restart-survivable state without replacing the in-memory map with an external store or IPC mechanism. For the current set of a handful of services, the design is more than sufficient.
5. **Maintainability assessment:** High locally—the API surface is just two methods and the semantics are obvious. Fragility lies at the edges: any new wrapper script must follow the register-on-spawn / unregister-on-exit discipline, and any change to PSM's loading model risks silently fragmenting the registry. Adding new consumers is trivial as long as they read through the same PSM singleton.


## Hierarchy Context

### Parent
- [ProcessStateManager](./ProcessStateManager.md) -- PSM is a singleton, meaning all wrapper scripts (api-service.js, dashboard-service.js) and health-coordinator.js share a single registry instance without passing references explicitly

### Siblings
- [SingletonModulePattern](./SingletonModulePattern.md) -- The singleton guarantee means that when api-service.js calls psm.registerService() and health-coordinator.js later iterates the registry, they are operating on the exact same object—a direct consequence of Node.js caching the first require() result for all subsequent importers.


---

*Generated from 4 observations*
