# PostSpawnRegistrationContract

**Type:** Detail

The L2 description explicitly designates registration as the 'canonical signal that a service is live and trackable', establishing a system-wide contract: any service not yet registered must be treated as not yet live, regardless of process existence.

# PostSpawnRegistrationContract

## What It Is

The `PostSpawnRegistrationContract` is a behavioral contract implemented in `scripts/api-service.js` that mandates a strict ordering between process spawn and service operation: immediately after a service process is spawned, and before any service logic executes, the process must invoke `ProcessStateManager.registerService()`. This call is not merely a notification — it is the canonical handshake that transitions a service from "spawned but invisible" to "live and trackable" within the system.

As a Detail under the parent `ServiceRegistrationPatterns`, this contract codifies a single, system-wide rule: **process existence is not service liveness**. A running PID or a bound port does not constitute a valid signal that a service is available. Only the completion of the `ProcessStateManager.registerService()` call grants a service its "live" status. This makes the contract a foundational invariant for any component that observes, depends on, or coordinates with services in the system.

The contract is tightly coupled to its sibling, `ProcessStateManagerRegistrationAPI`, which defines the single entry point (`ProcessStateManager.registerService()`) through which the handshake occurs. Together, these two entities define both the *when* (post-spawn, pre-work) and the *how* (a specific API call) of service registration.

## Architecture and Design

The architectural approach centralizes liveness semantics in a dedicated authority — `ProcessStateManager` — rather than distributing them across OS-level primitives. This is a deliberate inversion of the more common pattern where consumers infer liveness from process tables, port scans, or health-check endpoints. By making registration the canonical signal, the design establishes a clear separation between *process lifecycle* (managed by the OS) and *service lifecycle* (managed by `ProcessStateManager`).

This design follows a **registration-as-contract** pattern: the spawn step alone is insufficient to declare a service operational. Instead, a two-phase initialization is enforced — first the process exists, then it must register before doing any work. The contract is encoded directly in `scripts/api-service.js`, which acts as the enforcement point. Any service logic that could run before `registerService()` returns would violate the contract and produce an inconsistent system state where the process is consuming resources but is invisible to state-aware consumers.

The architectural trade-off is explicit: the system gains a single source of truth for service liveness at the cost of requiring all services to participate in the registration handshake. Services cannot opt out, and consumers cannot bypass `ProcessStateManager` by querying OS-level signals directly without violating the system's liveness contract.

## Implementation Details

The implementation lives in `scripts/api-service.js`, where the post-spawn flow is structured to call `ProcessStateManager.registerService()` as the first meaningful action after the process boots. The observation explicitly states "no service logic runs before the registration handshake is complete," meaning the call is synchronous-blocking with respect to any subsequent business logic, ensuring strict ordering.

The mechanics rely on the API surface provided by the sibling entity `ProcessStateManagerRegistrationAPI`. The `registerService()` method is the single entry point — there is no alternative registration mechanism, no implicit registration via side effects, and no fallback path. This single-entry-point design simplifies reasoning: either `registerService()` was called and the service is live, or it was not and the service is not live.

Because the contract is enforced at the call site (`scripts/api-service.js`) rather than within `ProcessStateManager` itself, the contract is a *convention* upheld by service-spawning code. This places the responsibility for compliance on whichever script or harness brings the service into existence. The L2 description's phrasing — that registration is the "canonical signal that a service is live and trackable" — elevates this convention to a system-wide invariant that downstream consumers depend on.

## Integration Points

The primary integration is with `ProcessStateManager`, accessed through its `registerService()` method. This is the only interface that `scripts/api-service.js` uses to fulfill the contract, and it is the only interface that downstream consumers should use to query service liveness. The contract explicitly redirects consumers away from OS-level primitives (PID existence, port binding) and toward `ProcessStateManager` as the authoritative source.

The relationship with the sibling `ProcessStateManagerRegistrationAPI` is foundational: `PostSpawnRegistrationContract` describes *when* the registration must occur (post-spawn, pre-work), while `ProcessStateManagerRegistrationAPI` describes *what* mechanism is used (the `registerService()` entry point). These two details together fully specify the registration behavior under the parent `ServiceRegistrationPatterns`.

Indirect integration points include any service-observing component — monitors, schedulers, orchestrators, or dependency resolvers — that needs to know whether a service is live. All such consumers must integrate with `ProcessStateManager` rather than with OS-level signals to remain consistent with the contract.

## Usage Guidelines

When authoring new service-spawning scripts, replicate the pattern from `scripts/api-service.js`: call `ProcessStateManager.registerService()` as the first action after process bootstrap, and ensure no service-side logic, request handling, or work-loop initialization runs until that call has completed. Treat the registration call as a blocking precondition for all service work.

When authoring consumers that observe service state, never use PID checks, port probes, or other OS-level primitives as substitutes for querying `ProcessStateManager`. Per the contract, a process that exists but has not registered is not live, and treating it as live will produce inconsistent system behavior. Always route liveness <USER_ID_REDACTED> through `ProcessStateManager` to align with the canonical signal.

When modifying or extending the registration flow, preserve the single-entry-point property maintained by the sibling `ProcessStateManagerRegistrationAPI`. Do not introduce alternative registration paths, implicit registration via side effects, or partial registration states. The contract's value derives from its uniformity: every live service registered through exactly one mechanism at exactly one point in its lifecycle.

---

### Architectural Patterns Identified
- **Registration-as-Contract**: Service liveness is defined by an explicit handshake, not by process existence.
- **Centralized Authority for Liveness**: `ProcessStateManager` owns all liveness semantics, displacing OS-level primitives.
- **Single Entry Point**: `ProcessStateManager.registerService()` is the sole registration mechanism (per sibling `ProcessStateManagerRegistrationAPI`).
- **Strict Ordering Invariant**: Post-spawn, pre-work ordering is enforced at the call site in `scripts/api-service.js`.

### Design Decisions and Trade-offs
- **Decision**: Make registration the canonical liveness signal rather than relying on PID/port checks.
- **Trade-off**: Gains a single source of truth and consistent semantics; requires every service to participate and every consumer to query `ProcessStateManager`.
- **Decision**: Enforce the contract at the spawning script (`scripts/api-service.js`) rather than inside `ProcessStateManager`.
- **Trade-off**: Keeps `ProcessStateManager` simple but places compliance burden on each service-spawning code path.

### System Structure Insights
The system separates *process lifecycle* (OS-managed) from *service lifecycle* (`ProcessStateManager`-managed). The two are joined by the post-spawn registration handshake, which is the only legitimate bridge between them. Under `ServiceRegistrationPatterns`, this Detail pairs with `ProcessStateManagerRegistrationAPI` to fully specify both the timing and the mechanism of registration.

### Scalability Considerations
The contract's reliance on a single `ProcessStateManager` as the authority for all service liveness implies that this component sits on the hot path for any liveness query and every service registration. Observations do not specify how `ProcessStateManager` scales, but the centralization is an architectural choice that concentrates load and consistency requirements in one place — a trade-off favoring correctness over distributed scalability.

### Maintainability Assessment
Maintainability is strengthened by the contract's clarity: a single rule ("register before working") and a single mechanism (`registerService()`) make compliance auditable. The main maintainability risk is that the contract is enforced by convention at call sites like `scripts/api-service.js`; if new spawning paths are added without following the pattern, the system-wide liveness invariant can be silently violated. Documenting the contract under `ServiceRegistrationPatterns` and pairing it with `ProcessStateManagerRegistrationAPI` mitigates this by making the rule discoverable for future contributors.


## Hierarchy Context

### Parent
- [ServiceRegistrationPatterns](./ServiceRegistrationPatterns.md) -- scripts/api-service.js calls ProcessStateManager.registerService() immediately after process spawn, establishing the registration as the canonical signal that a service is live and trackable.

### Siblings
- [ProcessStateManagerRegistrationAPI](./ProcessStateManagerRegistrationAPI.md) -- ProcessStateManager.registerService() is the single entry point through which spawned services announce their readiness, as established by the L2 description's phrasing 'canonical signal that a service is live and trackable'.


---

*Generated from 3 observations*
