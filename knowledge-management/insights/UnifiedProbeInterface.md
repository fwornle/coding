# UnifiedProbeInterface

**Type:** Detail

UnifiedProbeInterface, exported from service-probe.js, provides a single abstraction over HTTP and TCP probe implementations so that health-coordinator can invoke either protocol through a common call site without conditional branching.

# UnifiedProbeInterface

## What It Is

UnifiedProbeInterface is an abstraction exported from `lib/utils/service-probe.js` that provides a single, protocol-agnostic entry point for executing service health probes. It is a Detail-level component within the broader ServiceProbeLibrary, which lives in the same `lib/utils/service-probe.js` module. The interface unifies two underlying probe implementations — `HttpProbeExecutor` and `TcpProbeExecutor` — so that callers can invoke either protocol through a common call site without writing conditional branching logic.

The primary consumer of this interface is the health-coordinator, which performs service health checks across heterogeneous endpoints. By exposing UnifiedProbeInterface, the health-coordinator is shielded from the specifics of whether a given probe is conducted over HTTP or raw TCP. Protocol selection is treated as an internal concern of the service-probe module rather than a decision the caller must make explicitly at every invocation.

In effect, UnifiedProbeInterface is the public face of the ServiceProbeLibrary's probe-execution capability — the contract that downstream coordinators bind to when they need to determine whether a service is reachable or healthy.

## Architecture and Design

The architectural approach evident in `service-probe.js` is a classic **facade pattern** combined with **strategy encapsulation**. UnifiedProbeInterface acts as the facade that hides the existence of two concrete strategies — `HttpProbeExecutor` and `TcpProbeExecutor` — behind a single, uniform API. Rather than exporting each executor individually and forcing the health-coordinator to instantiate or select between them, the parent ServiceProbeLibrary co-locates both executors under one module boundary and surfaces only the unified abstraction.

This design reflects a deliberate **inversion of responsibility for protocol dispatch**. In a naive design, the call site would contain logic such as `if (target.protocol === 'http') { ... } else { ... }`. By moving that branching inside the service-probe module, the call site collapses to a single invocation and the protocol decision becomes a private implementation detail. This keeps health-coordinator focused on orchestration concerns (scheduling, aggregation, retries) rather than transport-layer dispatch.

The co-location of HttpProbeExecutor and TcpProbeExecutor under the same module boundary in `lib/utils/service-probe.js` is itself a significant design decision. It signals that these two executors are considered interchangeable variants of the same conceptual operation — "probe a service" — and that they should evolve together. The parent ServiceProbeLibrary serves as the cohesive unit of versioning, testing, and extension for any future probe variants.

## Implementation Details

UnifiedProbeInterface is implemented as an exported abstraction from `lib/utils/service-probe.js`. While the observations do not enumerate specific code symbols (0 symbols catalogued), the structural intent is clear: the module wraps the two concrete executors and routes incoming probe requests to the appropriate one based on properties of the probe target or configuration.

`HttpProbeExecutor` handles probes that require an HTTP-layer interaction — typically issuing a request to an endpoint and interpreting the response status as a health signal. `TcpProbeExecutor`, by contrast, operates at the transport layer, verifying that a TCP connection can be established to a host and port without concerning itself with any application-layer protocol. Both executors live as siblings inside the ServiceProbeLibrary module, and UnifiedProbeInterface is the orchestrator that delegates to whichever one matches the requested probe type.

Because the dispatch logic is internal, adding a new probe variant (for example, a UDP or gRPC executor) would involve registering it inside `service-probe.js` and extending UnifiedProbeInterface's dispatch logic — without any change required at the call sites in health-coordinator. This is the practical payoff of the facade design.

## Integration Points

The principal integration point for UnifiedProbeInterface is the **health-coordinator**, which is identified in the observations as the consumer that benefits from never having to conditionally select between HTTP or TCP probe implementations. The health-coordinator depends on UnifiedProbeInterface as its single contract for probe execution.

Upstream, UnifiedProbeInterface is a member of the ServiceProbeLibrary surface area defined in `lib/utils/service-probe.js`. It is a sibling to the two executor implementations — `HttpProbeExecutor` and `TcpProbeExecutor` — which it delegates to internally. There are no other entities documented in the observations that interact with UnifiedProbeInterface directly, suggesting it is intentionally a narrow, focused API.

The boundary established by `lib/utils/service-probe.js` defines the trust line: everything inside that file is part of the probing subsystem and can know about HTTP versus TCP details; everything outside it should interact only through UnifiedProbeInterface.

## Usage Guidelines

Developers consuming this interface from health-coordinator (or any future caller) should treat UnifiedProbeInterface as the **only** sanctioned entry point for probe execution. Importing `HttpProbeExecutor` or `TcpProbeExecutor` directly would defeat the encapsulation that the parent ServiceProbeLibrary establishes and would couple consumers to a transport-specific choice that may need to change.

When adding new probe protocols, the work should occur entirely within `lib/utils/service-probe.js`: introduce the new executor as a sibling to the existing two, then extend UnifiedProbeInterface's internal dispatch so that the appropriate executor is selected. Call sites should not need modification — if they do, that is a signal that the unification abstraction has leaked.

When debugging probe failures, the relevant code paths to inspect are all within `lib/utils/service-probe.js`: UnifiedProbeInterface for dispatch correctness, and then either HttpProbeExecutor or TcpProbeExecutor for protocol-specific behavior. Because both executors live in the same module, cross-protocol consistency (timeout semantics, error shapes, return contracts) should be maintained deliberately — divergence between the two would break the uniformity that UnifiedProbeInterface promises to its callers.

---

### Summary of Key Insights

1. **Architectural patterns identified:** Facade pattern over two protocol-specific strategies (`HttpProbeExecutor`, `TcpProbeExecutor`); encapsulated dispatch within a single module boundary.
2. **Design decisions and trade-offs:** Protocol selection is moved from caller to library, trading a small amount of indirection inside `service-probe.js` for significantly cleaner call sites in health-coordinator and easier future extensibility.
3. **System structure insights:** ServiceProbeLibrary (`lib/utils/service-probe.js`) is the cohesive unit; UnifiedProbeInterface is its public face, with the two executors as private siblings.
4. **Scalability considerations:** New protocols can be added without touching consumers — scalability here is about evolution of supported probe types, not throughput. The narrow interface limits the blast radius of changes.
5. **Maintainability assessment:** High. The single-module boundary and single-entry-point design mean changes to transport behavior are localized, and the absence of conditional dispatch at call sites prevents the proliferation of protocol-specific branches across the codebase.


## Hierarchy Context

### Parent
- [ServiceProbeLibrary](./ServiceProbeLibrary.md) -- lib/utils/service-probe.js implements both HTTP and TCP probe variants under a unified interface, allowing health-coordinator to invoke either protocol without branching logic at the call site


---

*Generated from 3 observations*
