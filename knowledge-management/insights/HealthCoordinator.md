# HealthCoordinator

**Type:** SubComponent

health-coordinator.js consumes PSM state by name rather than PID, so service restarts are transparent — it never needs to be notified of PID changes in api-service.js or dashboard-service.js

# HealthCoordinator — Technical Insight Document

## What It Is

HealthCoordinator is a SubComponent implemented in `scripts/health-coordinator.js` within the broader DockerizedServices parent component. It serves as the centralized health-aggregation layer for the dockerized service topology, responsible for reporting liveness across all services that have registered themselves with the ProcessStateManager (PSM) singleton. Rather than maintaining its own process registry or holding direct OS-level handles, the coordinator acts purely as a *reader* of PSM state and a *consumer* of probe results.

The coordinator decomposes into two child sub-components that reflect its two-phase operation: NameBasedServiceResolution, which encapsulates the design decision to consume PSM state by service name rather than by PID, and PSMStateReader, which performs the periodic or on-demand read from the ProcessStateManager registry that precedes any probe dispatch. Together, these children embody the coordinator's read-only, name-keyed relationship with the rest of the system.

![HealthCoordinator — Architecture](images/health-coordinator-architecture.png)

## Architecture and Design

The defining architectural choice in `scripts/health-coordinator.js` is **name-based service resolution against the PSM registry**. The coordinator <USER_ID_REDACTED> PSM by service name rather than by process ID, which means service restarts — where a new child process replaces an old one in wrappers such as `scripts/api-service.js` and `scripts/dashboard-service.js` — are completely transparent to it. The wrapper scripts re-register the new PID under the same name, and the coordinator simply observes the updated record on its next read. This decoupling mirrors and depends on the same identity/process-identity separation that the parent DockerizedServices component establishes across all wrapper scripts.

A second deliberate design decision is the **delegation of probe semantics to ServiceProbe**. The coordinator does not implement HTTP checks, socket pings, or any probe primitives itself; instead it consumes the normalized status envelopes that ServiceProbe (`lib/utils/service-probe.js`) produces. This creates a clean utility-to-orchestrator dependency direction — ServiceProbe is the utility, HealthCoordinator is the orchestrator — and keeps probe implementation details (timeouts, transport, retries) out of the coordinator's concern.

A third architectural property is the **absence of process lifecycle responsibilities**. Because HealthCoordinator only reads from PSM and never owns process handles, it has no signal-handling code. `SIGTERM` and `SIGINT` forwarding remains entirely in the wrapper scripts (`scripts/api-service.js`, `scripts/dashboard-service.js`), which own the spawned child processes. This is the inverse of its sibling ServiceStarter, which owns retry policy but not signal handling — the coordinator owns aggregation but not lifecycle.

## Implementation Details

Internally, the coordinator's workflow is structured around its two child sub-components. **PSMStateReader** performs the first step: a read from the singleton ProcessStateManager registry to obtain the current set of registered services. Because PSM is a singleton shared with all wrappers (`scripts/api-service.js`, `scripts/dashboard-service.js`) and with the coordinator itself, no reference passing is needed — the coordinator simply accesses the singleton instance.

**NameBasedServiceResolution** is the design contract that follows: each registry entry is keyed and resolved by its service name. This is what allows the coordinator to remain stable across PID changes. When `scripts/api-service.js` or `scripts/dashboard-service.js` calls `psm.unregisterService()` on exit and a replacement wrapper later calls `psm.registerService()`, the name slot is updated in place, and the coordinator's next read transparently picks up the new process handle metadata without any notification mechanism.

Once the set of named services is resolved, the coordinator hands off liveness assessment to ServiceProbe by consuming its normalized status envelopes. The envelope shape is the integration contract — the coordinator depends on the envelope's normalized fields rather than on probe internals. The aggregated output covers every service registered with PSM, so the coordinator scales automatically: adding a new service via a new wrapper script (following the boilerplate pattern shared by ConstraintAPIWrapper and DashboardWrapper) causes the new service to appear in health output with no changes to `scripts/health-coordinator.js` itself.

![HealthCoordinator — Relationship](images/health-coordinator-relationship.png)

## Integration Points

The coordinator integrates with three primary surfaces. First, with the **ProcessStateManager singleton** — the source of truth for which services exist and their current process metadata. PSM is also written to by sibling wrappers ConstraintAPIWrapper (`scripts/api-service.js`) and DashboardWrapper (`scripts/dashboard-service.js`), making PSM the shared rendezvous point between writers (wrappers) and this reader (coordinator).

Second, with **ServiceProbe** at `lib/utils/service-probe.js`. This is a one-way utility-to-orchestrator dependency: the coordinator imports and invokes probe functionality, and ServiceProbe has no knowledge of the coordinator. The normalized status envelope is the boundary contract.

Third, with the **wrapper script ecosystem** indirectly. The coordinator never imports or calls wrapper scripts, but its correctness depends on wrappers faithfully calling `psm.registerService()` and `psm.unregisterService()` at the appropriate lifecycle moments. Sibling LLMMockService (`llm-mock-service.ts`) is notable here as a service that persists its own state to `workflow-progress.json` rather than relying solely on PSM, illustrating that not all services have identical state-management contracts — though for health purposes, PSM registration remains the unifying signal.

The coordinator has no direct relationship with ServiceStarter (`lib/service-starter.js`); the two are orthogonal collaborators that both interact with PSM-managed services but never call each other.

## Usage Guidelines

Developers extending the dockerized service topology should observe several conventions to keep HealthCoordinator working correctly. **Never special-case the coordinator when adding a new service.** Because aggregation is driven by PSM registration, adding a new wrapper script that replicates the boilerplate pattern of `scripts/api-service.js` and `scripts/dashboard-service.js` — spawn via `child_process`, `psm.registerService()`, signal wiring, `psm.unregisterService()` on exit — is sufficient to make the new service appear in health output automatically. No edits to `scripts/health-coordinator.js` are required or appropriate.

**Do not add signal handling or process-ownership logic to the coordinator.** Signal forwarding (`SIGTERM`, `SIGINT`) belongs in the wrapper scripts that own the spawned children. Introducing signal handling into the coordinator would violate its read-only contract with PSM and would couple aggregation logic to lifecycle concerns that are deliberately housed elsewhere.

**Resolve services by name, never by PID.** The transparency-across-restarts property depends on this. Any new logic added to the coordinator or its child sub-components NameBasedServiceResolution and PSMStateReader must continue to key off service names; introducing PID-based lookups would break the restart-transparency guarantee.

**Keep probe semantics inside ServiceProbe.** If a new kind of liveness check is needed (for example, a deeper application-level probe), extend `lib/utils/service-probe.js` and ensure it continues to return the normalized status envelope. The coordinator should remain agnostic to probe internals and consume only the envelope, preserving the clean utility-to-orchestrator boundary.

Finally, be aware of the parent component's broader concern: the boilerplate-per-wrapper pattern is a known maintenance trade-off as the number of services grows. While this does not directly affect the coordinator, it does mean that the contract the coordinator relies on (correct PSM register/unregister calls) is replicated across many files, and any drift in wrapper boilerplate will manifest as incorrect health output rather than as a coordinator bug.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The ProcessStateManager (PSM) singleton implements a deliberate decoupling between service identity and process identity across both `scripts/api-service.js` and `scripts/dashboard-service.js`. Each script follows an identical structural pattern: spawn a child process via Node's `child_process` module, register the resulting process handle with the PSM via `psm.registerService()`, wire up `SIGTERM`/`SIGINT` forwarding so that signals delivered to the wrapper propagate to the child, and call `psm.unregisterService()` in the exit handler. This indirection means that the rest of the system (including `scripts/health-coordinator.js`) can query the PSM registry without holding direct references to OS-level process IDs. The practical consequence for developers is that a service restart — where a new child process replaces the old one — does not require the health coordinator or any consumer of PSM state to be aware of the PID change; only the wrapper scripts update the registry. This pattern also cleanly isolates the restart/retry logic in `lib/service-starter.js` from signal-handling responsibilities, since the wrapper owns the process lifecycle signals while the starter owns the retry policy. A new developer should note that adding a new containerized service almost certainly means creating a new wrapper script that replicates this boilerplate rather than centralizing it, which is a potential maintenance concern as the number of services grows.

### Children
- [NameBasedServiceResolution](./NameBasedServiceResolution.md) -- The HealthCoordinator sub-component description explicitly states that health-coordinator.js 'consumes PSM state by name rather than PID' — this is the central design decision that distinguishes it from a naive process-monitor approach.
- [PSMStateReader](./PSMStateReader.md) -- The sub-component description states health-coordinator.js 'consumes PSM state by name,' implying a periodic or on-demand read from the ProcessStateManager registry as the first step before any probe is dispatched.

### Siblings
- [ServiceProbe](./ServiceProbe.md) -- ServiceProbe lives at lib/utils/service-probe.js and is consumed by scripts/health-coordinator.js, establishing a clear utility-to-orchestrator dependency direction
- [ConstraintAPIWrapper](./ConstraintAPIWrapper.md) -- scripts/api-service.js uses Node's child_process module to spawn the constraint monitor Express API, decoupling the OS-level PID from the service identity tracked by PSM
- [DashboardWrapper](./DashboardWrapper.md) -- scripts/dashboard-service.js mirrors the structural pattern of api-service.js exactly: spawn via child_process, registerService, wire signals, unregisterService on exit
- [LLMMockService](./LLMMockService.md) -- llm-mock-service.ts persists LLM mode state to workflow-progress.json rather than keeping it in memory, making mode selection survive process restarts within the Docker environment
- [ProcessStateManager](./ProcessStateManager.md) -- PSM is a singleton, meaning all wrapper scripts (api-service.js, dashboard-service.js) and health-coordinator.js share a single registry instance without passing references explicitly
- [ServiceStarter](./ServiceStarter.md) -- lib/service-starter.js is explicitly isolated from SIGTERM/SIGINT handling — signal propagation is owned by the wrapper scripts (api-service.js, dashboard-service.js), not by the starter


---

*Generated from 4 observations*
