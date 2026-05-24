# PSMStateReader

**Type:** Detail

This reader pattern keeps health-coordinator.js stateless with respect to service registration: it holds no authoritative list of its own, delegating service discovery entirely to the ProcessStateManager and reading only what PSM currently exposes by name.

# PSMStateReader

## What It Is

PSMStateReader is a Detail-level sub-component within the `health-coordinator.js` module, operating as part of the broader HealthCoordinator system. It is the read-path interface responsible for consuming state from the ProcessStateManager (PSM) registry. As described in the source observations, `health-coordinator.js` "consumes PSM state by name," and PSMStateReader is the mechanism that performs this consumption — executing either periodic or on-demand reads from the PSM registry as the first step in any health-check cycle before a probe is dispatched.

Rather than maintaining its own authoritative inventory of services, PSMStateReader acts as a thin query layer over the ProcessStateManager. It surfaces only what PSM currently exposes by name, making it the canonical entry point for service discovery within the health-checking workflow. This positions PSMStateReader as a critical boundary component: it is the gate through which the HealthCoordinator learns which services exist at any given moment.

## Architecture and Design

The architecture follows a **reader pattern** (also recognizable as a query-side projection or pull-based discovery model). PSMStateReader does not push notifications or subscribe to events; instead, it actively reads the current state of the PSM registry whenever the HealthCoordinator needs to know which services to probe. This pull-based model keeps the coupling between HealthCoordinator and ProcessStateManager minimal and unidirectional.

A central design decision evident from the observations is **delegation of service discovery**. The HealthCoordinator holds no authoritative list of services of its own — that responsibility lives entirely in the ProcessStateManager. PSMStateReader is the mechanism that enforces this delegation. This is closely aligned with its sibling component, NameBasedServiceResolution, which encodes the related decision that lookups happen "by name rather than PID." Together, these two sub-components define the HealthCoordinator's discovery model: read by name, from PSM, on demand.

This design also makes `health-coordinator.js` **stateless with respect to service registration**. Because PSMStateReader fetches the current snapshot of registered services on each cycle, services added or removed in PSM are automatically reflected in subsequent health checks. There is no cached membership list that could drift from reality, and no registration callback that could be missed.

## Implementation Details

The implementation lives within `health-coordinator.js`. While no exported code symbols are surfaced in the structural metadata, the behavioral contract is clear from the observations: PSMStateReader performs a read against the ProcessStateManager registry, returning the set of services currently known by name. This read occurs as the **first step** of any health-check operation — preceding probe dispatch — ensuring that every cycle operates on fresh registry data rather than stale local state.

The reader is invoked either periodically (as part of a recurring health-check schedule) or on-demand (when a specific health-check is requested). In both cases the contract is the same: query PSM, receive the current service list keyed by name, and pass that list forward into the probe-dispatch stage. Because the lookup is by name, PID changes within underlying services (such as `api-service.js` or `dashboard-service.js` restarting) require no special handling from PSMStateReader — the name remains stable across restarts even when the PID changes.

The reader contains no caching, no local registration table, and no event subscription machinery. Its simplicity is deliberate: by being a pure pass-through query, it cannot fall out of sync with PSM, and it requires no invalidation logic.

## Integration Points

PSMStateReader sits at the intersection of two key systems. **Upstream**, it depends on the ProcessStateManager registry as its sole source of truth for service membership. Any service must be registered in PSM by name to be visible to the HealthCoordinator — PSMStateReader will not discover services through any other channel.

**Downstream**, PSMStateReader feeds the rest of the HealthCoordinator pipeline. The service list it produces is consumed by the probe-dispatch logic, and the by-name keys it returns flow into NameBasedServiceResolution for resolving each service to a probe target. PSMStateReader and NameBasedServiceResolution are complementary siblings: the reader produces the names, and the resolver translates them into actionable probe endpoints.

The reader also defines an implicit contract with services like `api-service.js` and `dashboard-service.js`: as long as they register with PSM under a stable name, they will be transparently re-discovered after any restart. There is no need for these services to notify the HealthCoordinator of lifecycle events — the next read cycle by PSMStateReader will pick up their current state automatically.

## Usage Guidelines

Developers working within or around PSMStateReader should observe several conventions. First, **never bypass PSM as the source of service membership**. Adding a static service list to `health-coordinator.js`, or hard-coding services elsewhere in the health-check path, would defeat the design's central benefit — automatic inclusion/exclusion of services as they enter or leave the PSM registry.

Second, **services must be registered in PSM by name** for the HealthCoordinator to find them. A service that exists as a running process but is not present in PSM will be invisible to health checks; conversely, a service present in PSM but not actually running will still be <USER_ID_REDACTED> (and will simply fail its probe). The PSM registry is the contract.

Third, **do not introduce caching or local state into PSMStateReader**. The statelessness of `health-coordinator.js` with respect to service registration is a deliberate property. Caching the service list locally would reintroduce the synchronization problems that the reader pattern is specifically designed to avoid.

From a **scalability** perspective, the on-demand read model means cost scales with check frequency and registry size, not with the number of registration events. The design is well-suited to environments where services churn frequently. From a **maintainability** perspective, this is a low-surface-area component: by delegating all discovery responsibility to PSM and avoiding caches, callbacks, or local state, PSMStateReader minimizes the failure modes that future maintainers must reason about. The primary trade-off is that every health cycle pays the cost of a PSM read, but that read is the simplest possible operation against the registry and is unlikely to become a bottleneck in practice.


## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- health-coordinator.js consumes PSM state by name rather than PID, so service restarts are transparent — it never needs to be notified of PID changes in api-service.js or dashboard-service.js

### Siblings
- [NameBasedServiceResolution](./NameBasedServiceResolution.md) -- The HealthCoordinator sub-component description explicitly states that health-coordinator.js 'consumes PSM state by name rather than PID' — this is the central design decision that distinguishes it from a naive process-monitor approach.


---

*Generated from 3 observations*
