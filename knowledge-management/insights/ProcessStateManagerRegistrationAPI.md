# ProcessStateManagerRegistrationAPI

**Type:** Detail

Because registration is the liveness signal, ProcessStateManager is responsible for maintaining authoritative state about which services are active — downstream components that need to route to or monitor services must consult this manager rather than probing services directly.

# ProcessStateManagerRegistrationAPI

## What It Is

The `ProcessStateManagerRegistrationAPI` is the programmatic surface exposed by `ProcessStateManager` through its `registerService()` method, which serves as the canonical entry point for spawned services to announce their readiness. The primary call site is in `scripts/api-service.js`, where the method is invoked immediately after process spawn. This API is the concrete mechanism that implements the broader patterns defined by its parent, `ServiceRegistrationPatterns`, and operates in close coordination with its sibling, `PostSpawnRegistrationContract`, which governs *when* the call must occur relative to other lifecycle events.

In essence, `ProcessStateManager.registerService()` is a single-purpose, well-defined call that transitions a freshly spawned process from an opaque OS-level entity into a tracked, addressable service within the application's runtime registry. The L2 description characterizes this call as the "canonical signal that a service is live and trackable," meaning no other heuristic — port scanning, log parsing, or PID inspection — should be used to determine service liveness.

## Architecture and Design

The architectural approach centers on a **registry pattern** in which `ProcessStateManager` holds authoritative state about active services, and individual services participate via an explicit handshake rather than passive observation. By making `registerService()` the *single entry point* for liveness announcement, the design eliminates ambiguity about service state: a service is either registered (live and trackable) or it is not. This avoids the failure modes of inference-based detection schemes where multiple signals can contradict each other.

The placement of the registration call in `scripts/api-service.js` immediately post-spawn reflects a deliberate ordering decision that is formalized by the sibling component `PostSpawnRegistrationContract`. Together, the two entities form complementary halves of the registration discipline: `ProcessStateManagerRegistrationAPI` defines *the mechanism* (the method to call and what it represents), while `PostSpawnRegistrationContract` defines *the timing rule* (no service logic runs before this call completes). This separation of mechanism from contract is a clean design choice that allows the registration semantics to be reasoned about independently of the lifecycle constraints they impose.

From the parent `ServiceRegistrationPatterns` perspective, this API is the focal point around which the registration discipline coheres. Because the API doubles as both an announcement mechanism and the source of truth for service tracking, downstream consumers — anything that needs to route to, monitor, or coordinate with services — must query `ProcessStateManager` rather than attempting direct service discovery.

## Implementation Details

The core implementation is the `registerService()` method on `ProcessStateManager`. While the source observations do not enumerate its internal data structures, the responsibilities are clear: the method must accept a service identity, record it in an authoritative in-process registry, and make that registry queryable by other components. Because registration is the liveness signal itself, the method's completion semantically corresponds to the transition of the service from "spawned" to "active."

The invocation pattern in `scripts/api-service.js` places the call before any dependency initialization, request handler binding, or downstream wiring. This implies that `registerService()` must be safe to call in a near-empty execution context — it cannot depend on configuration loading, network availability, or any state that the service itself is responsible for setting up. The call must be synchronous (or at least awaitable) at a very early stage, and it must be robust enough that failures here propagate as fatal startup errors rather than silent state inconsistencies.

The absence of any indirection layer between `scripts/api-service.js` and `ProcessStateManager` suggests a direct method-call interface rather than an event-bus or IPC-mediated registration. This is consistent with the design intent: the registration is meant to be unambiguous and synchronous, with the registry living in the same process boundary as the manager.

## Integration Points

The primary integration point is `scripts/api-service.js`, which holds the responsibility of issuing the `registerService()` call at the correct moment in the spawn sequence. This is the only call site explicitly identified in the observations, but the design implies a broader integration topology: any component that needs to know whether a service is alive, route requests to it, or react to its lifecycle must consult `ProcessStateManager` as the authoritative source.

This positions `ProcessStateManager` as a **service registry hub**. The registration API is the *write side* of that hub; corresponding read-side APIs (lookup, enumeration, health <USER_ID_REDACTED>) must exist for the registry to be useful, though they are outside the scope of this entity. The contract enforced by the sibling `PostSpawnRegistrationContract` ensures that any consumer querying the registry can trust that a "registered" service has at minimum completed its spawn, even if it has not yet completed full initialization.

The parent `ServiceRegistrationPatterns` aggregates this API together with the post-spawn contract to describe the complete registration discipline. Developers working at the pattern level should understand that touching either child entity has implications for the other.

## Usage Guidelines

Developers spawning new services into this architecture must invoke `ProcessStateManager.registerService()` as their first meaningful action after spawn — before initializing dependencies, binding handlers, or accepting work. This rule is not merely a convention but is enforced by the `PostSpawnRegistrationContract` sibling: violating the order means the system's view of service liveness will be incorrect, and downstream consumers may either fail to route to a live service or attempt to use a service that is not yet ready.

Do not introduce alternative liveness signals. Because `registerService()` is defined as the *canonical* signal, parallel mechanisms (heartbeat files, port probing, log-line matching) would fragment the source of truth and undermine the registry's authority. If additional health information is needed beyond binary liveness, it should be expressed as extensions to `ProcessStateManager`'s API rather than as out-of-band signals.

When adding new service types, follow the existing pattern visible in `scripts/api-service.js`: spawn, register, then initialize. Any code that needs to interact with services should query `ProcessStateManager` for the current set of registered services rather than maintaining its own list or attempting direct discovery. This keeps the registry as the single source of truth and ensures that lifecycle changes propagate consistently across the system.

---

### Cross-Cutting Analysis

**1. Architectural patterns identified:** Registry pattern with a single authoritative manager (`ProcessStateManager`); explicit handshake registration over inferred discovery; separation of mechanism (this API) from policy (`PostSpawnRegistrationContract`).

**2. Design decisions and trade-offs:** Choosing an explicit registration call trades a small amount of boilerplate in each service for strong guarantees about state consistency. Placing the call before dependency initialization trades flexibility (services can't use complex logic to decide whether to register) for predictability (the registry always reflects spawned processes accurately).

**3. System structure insights:** The system is organized around a central process state registry that all service-aware components consult. `scripts/api-service.js` exemplifies the expected spawn-and-register pattern that other service entry scripts should mirror.

**4. Scalability considerations:** Because `ProcessStateManager` is the single registry, it is also a potential bottleneck and single point of failure. The observations do not indicate distribution or replication; this design is appropriate for a bounded set of in-process or co-located services but would need extension for distributed deployments.

**5. Maintainability assessment:** The narrow API surface (a single `registerService()` method as the liveness signal) is highly maintainable: changes to internal registry representation can occur without affecting callers, and the contract is simple enough to verify by inspection. The clean separation between this API and the `PostSpawnRegistrationContract` sibling means timing rules and mechanism can evolve independently. The main maintenance risk is drift in call-site discipline — if new service spawn scripts neglect the post-spawn registration step, the registry's authority degrades silently.


## Hierarchy Context

### Parent
- [ServiceRegistrationPatterns](./ServiceRegistrationPatterns.md) -- scripts/api-service.js calls ProcessStateManager.registerService() immediately after process spawn, establishing the registration as the canonical signal that a service is live and trackable.

### Siblings
- [PostSpawnRegistrationContract](./PostSpawnRegistrationContract.md) -- scripts/api-service.js enforces a post-spawn, pre-work call to ProcessStateManager.registerService(), meaning no service logic runs before the registration handshake is complete.


---

*Generated from 3 observations*
