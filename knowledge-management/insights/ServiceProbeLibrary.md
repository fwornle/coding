# ServiceProbeLibrary

**Type:** SubComponent

By normalizing HTTP and TCP probes behind a single library, service-probe.js acts as an abstraction boundary — adding a new protocol requires changes only in lib/utils/service-probe.js rather than in each health-coordinator call site

# ServiceProbeLibrary — Technical Insight Document

## What It Is

ServiceProbeLibrary is implemented in `lib/utils/service-probe.js` and serves as a unified abstraction over two distinct network reachability protocols: HTTP and TCP. Rather than exposing two separate probe implementations to callers, the library presents both variants behind a single interface, allowing consumers — most notably `scripts/health-coordinator.js` — to invoke probes without branching on protocol type at the call site. As a SubComponent within the broader DockerizedServices layer, it provides the low-level liveness detection primitives that higher-level orchestration logic depends on.

The library's central design constraint is encoded in the SPEC R6 contract: the probe is explicitly forbidden from ever returning a `'healthy'` result. This means ServiceProbeLibrary is intentionally scoped to liveness detection — answering "is this service reachable?" — rather than full health verification. The distinction shapes everything downstream: consumers must interpret probe output as binary liveness signals (reachable/unreachable) rather than as multi-state health classifications. Its single child entity, `UnifiedProbeInterface`, is the concrete realization of this protocol-agnostic surface.

![ServiceProbeLibrary — Architecture](images/service-probe-library-architecture.png)

## Architecture and Design

The architectural pattern at work in `lib/utils/service-probe.js` is a **strategy pattern behind a unified facade**. The HTTP and TCP probe variants are alternate strategies for ascertaining service reachability, but they are normalized so that the caller — `health-coordinator.js` — invokes a single function regardless of which protocol is actually in use. This is a deliberate inversion: rather than letting health-coordinator hold a `switch` on protocol type, the protocol selection is internalized within the library itself, exposed through `UnifiedProbeInterface`.

A second key design decision is the **polling model** rather than an event-driven one. `health-coordinator.js` invokes the probe on a fixed 5-second tick interval, meaning ServiceProbeLibrary itself is stateless and synchronous in its interface — it has no subscribers, no event emitters, no callbacks beyond the immediate probe result. This polling cadence is set externally; the library does not own its own scheduling. This is a clean separation: the library does the probing, the coordinator decides when probing happens.

The third architectural pillar is the **SPEC R6 "never returns healthy" contract**. This is more than a coding rule — it is an architectural boundary that defines what kind of information ServiceProbeLibrary is permitted to produce. By contractually limiting probe output to liveness semantics, the library is prevented from drifting into responsibilities (like dependency validation, schema checks, or readiness handshakes) that belong in higher layers. This keeps the abstraction sharp and prevents the kind of scope creep that would couple probe internals to application-specific health concerns.

## Implementation Details

The core file `lib/utils/service-probe.js` implements both HTTP and TCP probe variants under one umbrella. The HTTP variant presumably performs a request against a configured endpoint and treats response receipt (regardless of status semantics interpreted as "healthy") as a reachability indicator; the TCP variant likely opens a socket connection to a host/port and treats successful connection establishment as the liveness signal. The exact internal split between these two paths is encapsulated — the public surface (`UnifiedProbeInterface`) hides which variant is dispatched.

Because the SPEC R6 contract forbids returning `'healthy'`, the result vocabulary of the library is constrained. Probes must return values that signal reachability without making claims about service correctness. This means the implementation must explicitly avoid mapping HTTP 200 responses to a "healthy" state — instead, a successful HTTP response and a successful TCP handshake collapse to the same liveness category. This uniformity is what makes the unified interface possible in the first place: if HTTP and TCP probes returned different result vocabularies, the abstraction would leak.

![ServiceProbeLibrary — Relationship](images/service-probe-library-relationship.png)

The library has zero indexed code symbols in the current observation set, which suggests its surface is small and intentionally minimal — likely a handful of exported functions in `lib/utils/service-probe.js` rather than a class hierarchy. This small footprint is consistent with its role as a focused utility under the `lib/utils/` directory.

## Integration Points

The primary consumer is `scripts/health-coordinator.js`, which calls into `lib/utils/service-probe.js` on its 5-second tick. The integration is straightforward function invocation: health-coordinator passes probe configuration (protocol type, endpoint or host/port) and receives a liveness result synchronously (or via promise). Because the probe abstraction handles protocol selection, health-coordinator's code is free of protocol-specific branching.

ServiceProbeLibrary sits inside the DockerizedServices parent layer, which establishes a "spawn-then-register" pattern via the ProcessStateManager (PSM). While ServiceProbeLibrary itself does not interact with PSM directly, the liveness signals it produces complement PSM's process-existence guarantees: PSM tells you a PID is signal-addressable, while ServiceProbeLibrary tells you the service on that PID is reachable over its declared protocol. Together with PSM, this gives health-coordinator two independent reachability axes (process-alive and protocol-reachable) without coupling them in the probe library itself.

Among its siblings, ServiceProbeLibrary is more narrowly focused than `ServiceStarterLibrary` (which owns retry/backoff sequencing in `lib/service-starter.js`) and `LLMMockService` (which deals with workflow-progress path resolution via `CODING_ROOT`). The siblings each occupy a distinct concern within DockerizedServices: starting services, mocking LLM responses, and probing for liveness. There is no observed direct coupling between ServiceProbeLibrary and either sibling — they share only the common parent context.

The single child, `UnifiedProbeInterface`, is the integration contract itself. It is the named surface that callers depend on, and it is what allows new protocols to be added to `lib/utils/service-probe.js` without forcing changes at every call site.

## Usage Guidelines

The most important rule for developers working with ServiceProbeLibrary is to **respect the SPEC R6 contract**: do not modify the probe to return a `'healthy'` state, and do not write consumer logic that assumes probe output carries any meaning beyond binary liveness. If a feature requires multi-state health classification (e.g., "degraded", "ready", "healthy"), that logic belongs in a higher layer that may *combine* probe output with other signals — it does not belong inside `lib/utils/service-probe.js`.

When **adding a new protocol** (for example, gRPC or UDP probing), the change should be localized to `lib/utils/service-probe.js`. Because the unified interface absorbs protocol selection, no modifications should be required in `scripts/health-coordinator.js` or any other call site. This is the central maintenance benefit of the abstraction boundary — if you find yourself editing call sites to add a protocol, the abstraction has been broken and should be restored.

Be aware that the **polling cadence is owned externally**. The library does not schedule itself; `health-coordinator.js` invokes it every 5 seconds. If you need a different cadence for a specific use case, change the caller's schedule rather than embedding timing logic in the probe library. Conversely, do not introduce internal caching or rate-limiting within `lib/utils/service-probe.js` that would make probe behavior dependent on call frequency — the library's contract is that each invocation produces a fresh liveness check.

Finally, recognize that **probe results are inputs to orchestration decisions, not the decisions themselves**. Downstream logic should treat unreachable signals as triggers for further investigation (restart attempts, alerting, escalation) rather than as direct commands. This separation keeps ServiceProbeLibrary focused on observation and leaves action to coordinators like `health-coordinator.js`.

---

## Summary of Key Insights

**1. Architectural patterns identified:** Unified facade over strategy variants (HTTP/TCP), polling-based liveness detection with externally-owned scheduling, contractual constraint on result vocabulary (SPEC R6), and clear abstraction boundary at `lib/utils/service-probe.js`.

**2. Design decisions and trade-offs:** Choosing polling over event-driven detection trades freshness latency (up to 5 seconds) for simplicity and statelessness. Enforcing "never returns healthy" trades expressiveness for contract clarity — consumers cannot get richer signals, but the library's responsibility stays tightly scoped. Unifying HTTP and TCP behind one interface trades a small amount of internal complexity for elimination of branching at every call site.

**3. System structure insights:** ServiceProbeLibrary occupies a focused utility role within DockerizedServices, complementary to but decoupled from ProcessStateManager's process-existence tracking. Its child `UnifiedProbeInterface` is the contractual surface; its primary consumer is `scripts/health-coordinator.js`. Siblings `ServiceStarterLibrary` and `LLMMockService` address orthogonal concerns within the same parent layer.

**4. Scalability considerations:** The 5-second polling interval imposes a known, bounded load — probe frequency scales linearly with the number of probed services, not with traffic volume. Because the library is stateless, horizontal scaling is trivial; the bottleneck would be in coordinator scheduling, not in the probe library itself. Adding protocols scales well because the abstraction localizes the change.

**5. Maintainability assessment:** Maintainability is high due to the small surface area, single-file implementation in `lib/utils/service-probe.js`, and the explicit contract (SPEC R6) that prevents scope creep. The abstraction boundary is well-chosen: new protocols can be added without touching consumer code. The principal maintainability risk is contract erosion — if a future change weakens the "never returns healthy" rule, downstream consumers will begin depending on richer probe semantics, and the library's focused role will degrade.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- [LLM] The DockerizedServices layer uses a deliberate 'spawn-then-register' sequencing pattern in its wrapper scripts that has important reliability implications. In `scripts/api-service.js`, the child process is spawned first and only after a successful spawn does the wrapper register the resulting PID with the ProcessStateManager (PSM) under the key `'constraint-api-child'`. This means PSM never holds a stale or null PID reference — any entry in PSM is guaranteed to correspond to a live, OS-allocated process handle. This contrasts with an 'optimistic registration' approach where you'd register first and hope the spawn succeeds. The practical benefit is that any consumer of PSM (such as `scripts/health-coordinator.js` or an external orchestration script) can safely assume that a registered PID is signal-addressable. Similarly, `scripts/dashboard-service.js` follows the same pattern for the Next.js dashboard child. The PSM therefore functions as a live process registry rather than an intent registry, a distinction that matters when implementing SIGTERM forwarding or graceful drain logic during container shutdown sequences.

### Children
- [UnifiedProbeInterface](./UnifiedProbeInterface.md) -- Based on the L2 description, service-probe.js exposes a unified interface so health-coordinator callers never need to conditionally select between HTTP or TCP probe implementations.

### Siblings
- [ServiceStarterLibrary](./ServiceStarterLibrary.md) -- lib/service-starter.js implements exponential backoff between retry attempts, preventing thundering-herd restarts when a dependent service (e.g., database) is slow to become available
- [LLMMockService](./LLMMockService.md) -- llm-mock-service.ts resolves the workflow-progress.json path using the CODING_ROOT environment variable, making it portable across Docker volume mount configurations without hardcoded paths


---

*Generated from 5 observations*
