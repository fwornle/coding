# ProcessStateManager

**Type:** SubComponent

psm.unregisterService() is called in each wrapper's exit handler, so the registry reflects live processes only — health-coordinator.js sees removals immediately without requiring its own process polling

# ProcessStateManager — Technical Insight Document

## What It Is

The ProcessStateManager (PSM) is a SubComponent within the DockerizedServices parent, implemented as a singleton module that maintains a centralized registry mapping stable service names to live OS-level process handles. It is consumed primarily by the wrapper scripts `scripts/api-service.js` and `scripts/dashboard-service.js`, and <USER_ID_REDACTED> by `scripts/health-coordinator.js`. The PSM itself contains two conceptual children: the **ServiceRegistry** (the underlying map data structure) and the **SingletonModulePattern** (the module-loading mechanism that guarantees a single shared instance across all importers).

The defining purpose of the PSM is to decouple **service identity** from **process identity**. Where raw PIDs change every time a child process is spawned or restarted, the PSM exposes a stable, name-based view of which services are currently live. This allows the rest of the system to reason about services symbolically rather than by transient OS resources.

![ProcessStateManager — Architecture](images/process-state-manager-architecture.png)

## Architecture and Design

The PSM follows the **Singleton Module Pattern**, leveraging Node.js's `require()` caching: the first import of the module instantiates the registry, and every subsequent importer (whether `api-service.js`, `dashboard-service.js`, or `health-coordinator.js`) receives the same object reference. No explicit reference passing or dependency injection is required. This is the technical foundation that makes the registry "shared" across otherwise independent scripts.

Architecturally, the PSM sits at the intersection of three concerns that have been deliberately separated:

1. **Process lifecycle and signal forwarding** — owned by the wrapper scripts (`scripts/api-service.js`, `scripts/dashboard-service.js`), which spawn child processes via Node's `child_process` module, register them with the PSM, and wire `SIGTERM`/`SIGINT` propagation.
2. **Retry and restart policy** — owned by `lib/service-starter.js`, which is explicitly isolated from signal handling. The starter updates state indirectly through the wrappers rather than mutating the registry directly.
3. **Health observation** — owned by `scripts/health-coordinator.js`, which <USER_ID_REDACTED> PSM state and delegates probing to **ServiceProbe** (`lib/utils/service-probe.js`).

The PSM is the connective tissue between these three concerns, and the indirection it provides is what allows each concern to evolve independently.

![ProcessStateManager — Relationship](images/process-state-manager-relationship.png)

## Implementation Details

The PSM exposes two principal operations: `psm.registerService()` and `psm.unregisterService()`. Both `api-service.js` and `dashboard-service.js` follow an identical structural pattern that exercises these methods:

1. Spawn a child process via Node's `child_process` module (the constraint monitor Express API in the case of **ConstraintAPIWrapper**; the dashboard process in the case of **DashboardWrapper**).
2. Call `psm.registerService()` immediately after spawn, binding a stable service name to the returned process handle. This inserts a service-name-to-process-handle entry into the **ServiceRegistry** shared map.
3. Wire up `SIGTERM` and `SIGINT` handlers so that signals delivered to the wrapper propagate to the child.
4. Call `psm.unregisterService()` from the exit handler, so the registry reflects only currently-live processes.

The crucial property of this design is that the registry is **eagerly maintained**: removals happen the moment a child exits, so consumers like `health-coordinator.js` never see stale entries and do not need to perform their own process polling or liveness verification at the OS level. Because PSM lives in module scope and is cached by Node, when `api-service.js` calls `psm.registerService()` and `health-coordinator.js` later iterates the registry, both are operating on the exact same in-memory object — the **SingletonModulePattern** child entity is what guarantees this invariant.

The PSM does not itself perform spawning, signal handling, restart logic, or probing. It is intentionally minimal: a registry with register/unregister semantics. Everything else is a collaborator.

## Integration Points

The PSM integrates with several sibling components within DockerizedServices, each touching it through a narrow, well-defined interface:

- **ConstraintAPIWrapper** (`scripts/api-service.js`) and **DashboardWrapper** (`scripts/dashboard-service.js`) are the *writers* — they call `psm.registerService()` after spawning and `psm.unregisterService()` on exit. The two wrappers mirror each other's structural pattern exactly, suggesting the integration contract is well-established but currently duplicated rather than abstracted.
- **HealthCoordinator** (`scripts/health-coordinator.js`) is the *primary reader* — it iterates the registry to discover which services are live, then dispatches **ServiceProbe** (`lib/utils/service-probe.js`) calls against those service names. Because the PSM removes entries promptly on exit, the coordinator never probes against dead PIDs.
- **ServiceStarter** (`lib/service-starter.js`) is deliberately *not* an integration point for signals — it owns retry policy but does not touch the registry directly. Its updates flow through the wrappers, preserving separation of concerns.
- **LLMMockService**, while a sibling under DockerizedServices, follows a different persistence philosophy (state in `workflow-progress.json`) and does not interact with the PSM.

The dependency direction is unambiguous: wrappers and the coordinator depend on the PSM; the PSM depends on nothing in the application layer. This makes it a foundational utility within the DockerizedServices subsystem.

## Usage Guidelines

When adding a new containerized service, developers should create a new wrapper script that replicates the established pattern: spawn via `child_process`, call `psm.registerService()` with a stable service name, wire `SIGTERM`/`SIGINT` forwarding to the child, and call `psm.unregisterService()` in the exit handler. The parent component documentation explicitly notes that this boilerplate is currently duplicated across wrappers rather than centralized — a known maintenance concern as service count grows. Until that abstraction is introduced, fidelity to the existing pattern in `api-service.js` and `dashboard-service.js` is the safest path.

Developers should treat the PSM as the **single source of truth for service liveness**. Code that needs to know whether a service is running, or what process handle backs it, must query the PSM rather than tracking PIDs independently. This is precisely how `health-coordinator.js` operates, and it is why probe results remain correlated to service names that are stable across restarts.

Restart and retry logic must remain in `lib/service-starter.js` and must not be embedded into the PSM or the wrappers. The current architecture relies on the starter being signal-agnostic and the wrappers being retry-agnostic; collapsing these responsibilities would erode the clean separation between lifecycle, policy, and observation.

**Scalability considerations:** The PSM's in-memory, single-process registry assumes that all wrapper scripts and the health coordinator run inside the same Node process or within a shared Docker container where module caching applies. The pattern does not natively span multiple Node processes — extending it to a distributed setting would require an external store. The current scope (a handful of Dockerized services) is well-served by the in-process singleton.

**Maintainability assessment:** The PSM itself is small, focused, and easy to reason about. The principal maintenance risk is not in the PSM but in the duplicated wrapper boilerplate around it; each new service requires copy-paste replication of the spawn/register/signal/unregister pattern. Refactoring this into a shared wrapper factory would reduce drift between `api-service.js` and `dashboard-service.js` and lower the cost of adding services, without altering the PSM's contract.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The ProcessStateManager (PSM) singleton implements a deliberate decoupling between service identity and process identity across both `scripts/api-service.js` and `scripts/dashboard-service.js`. Each script follows an identical structural pattern: spawn a child process via Node's `child_process` module, register the resulting process handle with the PSM via `psm.registerService()`, wire up `SIGTERM`/`SIGINT` forwarding so that signals delivered to the wrapper propagate to the child, and call `psm.unregisterService()` in the exit handler. This indirection means that the rest of the system (including `scripts/health-coordinator.js`) can query the PSM registry without holding direct references to OS-level process IDs. The practical consequence for developers is that a service restart — where a new child process replaces the old one — does not require the health coordinator or any consumer of PSM state to be aware of the PID change; only the wrapper scripts update the registry. This pattern also cleanly isolates the restart/retry logic in `lib/service-starter.js` from signal-handling responsibilities, since the wrapper owns the process lifecycle signals while the starter owns the retry policy. A new developer should note that adding a new containerized service almost certainly means creating a new wrapper script that replicates this boilerplate rather than centralizing it, which is a potential maintenance concern as the number of services grows.

### Children
- [ServiceRegistry](./ServiceRegistry.md) -- api-service.js and dashboard-service.js each call psm.registerService() immediately after spawning their child processes, inserting a service-name-to-process-handle entry into this shared map so downstream consumers have an up-to-date view.
- [SingletonModulePattern](./SingletonModulePattern.md) -- The singleton guarantee means that when api-service.js calls psm.registerService() and health-coordinator.js later iterates the registry, they are operating on the exact same object—a direct consequence of Node.js caching the first require() result for all subsequent importers.

### Siblings
- [ServiceProbe](./ServiceProbe.md) -- ServiceProbe lives at lib/utils/service-probe.js and is consumed by scripts/health-coordinator.js, establishing a clear utility-to-orchestrator dependency direction
- [ConstraintAPIWrapper](./ConstraintAPIWrapper.md) -- scripts/api-service.js uses Node's child_process module to spawn the constraint monitor Express API, decoupling the OS-level PID from the service identity tracked by PSM
- [DashboardWrapper](./DashboardWrapper.md) -- scripts/dashboard-service.js mirrors the structural pattern of api-service.js exactly: spawn via child_process, registerService, wire signals, unregisterService on exit
- [LLMMockService](./LLMMockService.md) -- llm-mock-service.ts persists LLM mode state to workflow-progress.json rather than keeping it in memory, making mode selection survive process restarts within the Docker environment
- [ServiceStarter](./ServiceStarter.md) -- lib/service-starter.js is explicitly isolated from SIGTERM/SIGINT handling — signal propagation is owned by the wrapper scripts (api-service.js, dashboard-service.js), not by the starter
- [HealthCoordinator](./HealthCoordinator.md) -- health-coordinator.js consumes PSM state by name rather than PID, so service restarts are transparent — it never needs to be notified of PID changes in api-service.js or dashboard-service.js


---

*Generated from 5 observations*
