# NameBasedServiceResolution

**Type:** Detail

Because the lookup key is a stable service name (e.g., 'api-service', 'dashboard-service') rather than an ephemeral PID, a restart of api-service.js or dashboard-service.js that changes the PID is fully transparent: health-coordinator.js continues resolving the same logical handle without receiving any notification.

# NameBasedServiceResolution

## What It Is

NameBasedServiceResolution is the design contract embedded within `health-coordinator.js` that mandates all health-monitoring lookups be keyed by a stable, human-readable service name (e.g., `'api-service'`, `'dashboard-service'`) rather than by an operating-system PID. It is a sub-component of the HealthCoordinator, sitting alongside its sibling PSMStateReader, and it governs the interpretive layer that sits between raw ProcessStateManager (PSM) state and the probe logic that ultimately exercises each service.

Rather than being a discrete module with its own file, NameBasedServiceResolution manifests as a consistent convention inside `health-coordinator.js`: every time the coordinator needs to address a service, it does so through the logical service-identity namespace. The observations describe this as the "central design decision that distinguishes it from a naive process-monitor approach," meaning the entity is best understood as an architectural rule enforced through code structure rather than as a class hierarchy.

This resolution layer ensures that the HealthCoordinator's view of the world is built on stable identifiers — identifiers that survive process restarts, crashes, and re-spawns — so that downstream probe scheduling and health-state aggregation can remain stateless with respect to OS-level process churn.

## Architecture and Design

The architecture reflects a clear **separation of concerns** between identity and lifecycle. The ProcessStateManager owns PID lifecycle — tracking which OS processes are alive, when they were spawned, and which PIDs correspond to which logical services. The HealthCoordinator, via NameBasedServiceResolution, deliberately stays one level above this: it never holds a PID directly, and its probe logic is never coupled to low-level process metadata. This is a textbook **indirection pattern**, where a stable logical key (the service name) shields a consumer from churn in the underlying physical identifier (the PID).

A complementary pattern in play is **late binding through a registry**. The sibling PSMStateReader handles the actual read from the PSM registry — either periodically or on demand — and exposes the current state. NameBasedServiceResolution then consumes that state by looking up entries by name, so the binding between service name and current PID is resolved at the moment of each probe rather than cached. This makes restarts of `api-service.js` or `dashboard-service.js` fully transparent: even though their PIDs change, the next name-based lookup will resolve to the new process without any notification being delivered to `health-coordinator.js`.

The design also enforces a **unidirectional dependency**: HealthCoordinator depends on ProcessStateManager state (via PSMStateReader), but never the other way around. PSM does not need to know that health monitoring exists; it simply maintains its registry keyed by service name, and any consumer — health-coordinator.js being one — can resolve names to current process handles on demand.

## Implementation Details

Implementation centers on `health-coordinator.js` and its consumption pattern. Each time a probe must be issued or a health verdict computed, the coordinator <USER_ID_REDACTED> the PSM-derived state object using the service name as the key. There is no caching of PIDs across probe cycles, and no subscription to PID-change events; the lookup itself, performed afresh each time, is the mechanism that guarantees correctness across restarts.

The two named consumers visible in the observations are `api-service` and `dashboard-service` (whose underlying implementations are `api-service.js` and `dashboard-service.js`). When either of these is restarted by the ProcessStateManager, the PSM registry entry for that name is updated in place with the new PID. Because `health-coordinator.js` re-resolves the name on its next cycle, it picks up the new PID implicitly — no callback, no event, no invalidation step is required.

This implementation strategy effectively makes NameBasedServiceResolution a **stateless resolver**. It holds no internal mapping of its own; the canonical mapping lives in the ProcessStateManager, and the resolver simply dereferences it on every access. The trade-off is one extra registry lookup per probe in exchange for complete immunity to stale-PID bugs — a trade-off the design clearly considers worthwhile given the central position health monitoring occupies.

## Integration Points

The primary integration point is with the sibling component **PSMStateReader**, which performs the actual read of ProcessStateManager state. NameBasedServiceResolution operates on the output of that read, so the contract between the two is essentially: PSMStateReader returns a name-keyed view of the registry, and NameBasedServiceResolution indexes into that view using the logical service name.

The parent component **HealthCoordinator** consumes the resolved handles to drive its probe dispatching. Because the resolution layer abstracts away PID details, the probe logic in `health-coordinator.js` works exclusively with logical service identities — a property that simplifies any future extension of the probe set (e.g., adding new services to monitor requires only that they appear in the PSM registry under a known name).

Implicit integration points are the monitored services themselves — `api-service.js` and `dashboard-service.js` — but the relationship is one-way and indirect. These services do not interact with NameBasedServiceResolution directly; they are simply registered in PSM under their canonical names, and the resolver finds them through that registration. The ProcessStateManager is therefore the de-facto integration hub, while NameBasedServiceResolution acts as a pure consumer of its registry.

## Usage Guidelines

Developers extending or modifying `health-coordinator.js` should treat the service name as the **only legitimate identifier** for a monitored service. Caching PIDs, passing PIDs across function boundaries inside the coordinator, or subscribing to PID-change events would all violate the design principle and reintroduce the coupling that NameBasedServiceResolution exists to prevent. If a piece of logic needs to act on "the current process for `api-service`", it should perform a fresh name-based lookup at the point of use.

When adding a new monitored service, the correct workflow is to ensure the service is registered in the ProcessStateManager under a stable, well-known name and then reference that name from the HealthCoordinator's configuration. No additional wiring for PID tracking is needed — the existing resolution layer will automatically pick up the service through PSMStateReader.

Finally, debugging health-monitoring issues should always start at the name-resolution boundary. If a probe is firing against the wrong process, the question to ask is not "did the PID change?" (the design assumes it can change at any time) but rather "is the PSM registry entry for this name pointing at the expected service?" This framing aligns the debugging mental model with the architectural intent, and keeps the separation of concerns between ProcessStateManager (PID lifecycle owner) and HealthCoordinator (service-identity consumer) intact.

---

### Summary

1. **Architectural patterns identified**: Indirection through a stable logical key; late binding via registry lookup; stateless resolver pattern; unidirectional dependency from HealthCoordinator to ProcessStateManager.
2. **Design decisions and trade-offs**: Chose per-probe re-resolution over PID caching, accepting a small lookup cost in exchange for transparent handling of service restarts and immunity to stale-handle bugs.
3. **System structure insights**: Clean two-layer split — ProcessStateManager owns PID lifecycle, HealthCoordinator (via NameBasedServiceResolution and PSMStateReader) operates purely at service-identity level.
4. **Scalability considerations**: Adding services scales linearly with PSM registry entries; no per-service wiring is required in `health-coordinator.js` beyond knowing the canonical name. Restart storms remain transparent because no event propagation is needed.
5. **Maintainability assessment**: High — the absence of PID coupling eliminates an entire class of stale-reference bugs, and the resolver's stateless nature means there is no internal cache to invalidate, reason about, or test for consistency.


## Hierarchy Context

### Parent
- [HealthCoordinator](./HealthCoordinator.md) -- health-coordinator.js consumes PSM state by name rather than PID, so service restarts are transparent — it never needs to be notified of PID changes in api-service.js or dashboard-service.js

### Siblings
- [PSMStateReader](./PSMStateReader.md) -- The sub-component description states health-coordinator.js 'consumes PSM state by name,' implying a periodic or on-demand read from the ProcessStateManager registry as the first step before any probe is dispatched.


---

*Generated from 3 observations*
