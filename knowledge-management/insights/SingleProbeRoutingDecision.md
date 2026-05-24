# SingleProbeRoutingDecision

**Type:** Detail

The result of isServerAvailable() is cached after the first initialize() call; subsequent method invocations on the adapter use this stored value without re-probing, meaning a server that goes down after initialization will still be treated as 'available' by that instance.

# SingleProbeRoutingDecision

## What It Is

`SingleProbeRoutingDecision` is a routing strategy implemented within `storage/graph-database-adapter.ts` as part of the `GraphDatabaseAdapter` component. It represents the design choice to determine the adapter's routing behavior through a single availability probe — specifically, one invocation of `isServerAvailable()` — performed during the adapter's `initialize()` lifecycle method. The result of this probe becomes the permanent routing decision for the entire lifetime of that adapter instance.

In concrete terms, when `GraphDatabaseAdapter.initialize()` runs for the first time, it calls `isServerAvailable()` exactly once. The boolean (or equivalent) result is cached on the adapter instance, and every subsequent read or write operation routed through that adapter consults this stored value rather than re-probing the underlying service. This makes the adapter behave as a statically-routed proxy after construction.

The Detail captures a deliberate, narrow design decision: routing is bound to initialization, not to per-operation evaluation. There is no circuit-breaker, no retry probe, and no re-routing mechanism visible from the parent context.

## Architecture and Design

The architectural pattern at work here is **eager, one-shot capability detection** combined with **static routing**. Rather than evaluate server availability continuously (as a circuit breaker or health-check loop would), the adapter commits to a single decision point at the boundary of its lifecycle. This is a classic trade-off favoring **simplicity and predictability over adaptability**: once an adapter instance exists, its behavior is fully determined and will not surprise callers with mid-flight routing changes.

This design pairs naturally with its sibling component, `LazyVkbClientImport`. Because `storage/graph-database-adapter.ts` uses a dynamic `import()` for `VkbApiClient` inside `initialize()` rather than a static top-level import, the probe and the import together form a coherent startup-time gate: the VKB client module is loaded lazily, the server is probed once, and the routing decision is frozen. Together, these two siblings ensure that environments without a VKB server pay neither the module-loading cost nor the runtime cost of repeated availability checks.

From the parent `GraphDatabaseAdapter` perspective, `SingleProbeRoutingDecision` is the policy that makes the adapter function as a proxy with fixed downstream targeting. The pattern is reminiscent of the **Strategy** pattern selected once at construction, except that the strategy is implicit rather than encoded as separate strategy objects — the cached probe result drives conditional branches inside the adapter's method bodies.

## Implementation Details

The mechanics are concentrated in `storage/graph-database-adapter.ts`:

1. **Probe invocation**: During the first call to `initialize()`, the adapter dynamically imports `VkbApiClient` and then invokes `isServerAvailable()` exactly once. This is the only place in the adapter's lifecycle where availability is <USER_ID_REDACTED>.

2. **Result caching**: The probe's return value is stored on the adapter instance (effectively as a private field). Subsequent method invocations consult this cached value rather than re-issuing a probe.

3. **Routing application**: Every read/write operation exposed by the `GraphDatabaseAdapter` branches on this cached value to decide whether to delegate to the VKB-backed path or to a fallback/no-op/local path. The branching logic itself is implicit in the adapter's method implementations rather than abstracted into a separate router class.

4. **No re-probing mechanism**: There is no scheduled health check, no exponential-backoff retry, and no externally exposed method to refresh the decision. A server that becomes available *after* initialization will be treated as unavailable; conversely, a server that goes down after initialization will still be treated as available, and operations will fail at the call site rather than be intercepted by routing logic.

This is a minimalistic implementation by design — the entire routing surface area amounts to "one call, one cached boolean, one branch per operation."

## Integration Points

The primary integration is with `VkbApiClient`, accessed via the dynamic `import()` performed by the sibling `LazyVkbClientImport` pattern within the same `initialize()` method. `isServerAvailable()` is the contract surface between the adapter and the VKB module — the adapter does not need to know how availability is determined, only that a single boolean answer is produced.

Upstream, integration occurs through whatever code constructs and initializes a `GraphDatabaseAdapter`. Because the routing decision is fixed at `initialize()` time, any code that instantiates the adapter implicitly commits to the availability state of the VKB server at that moment. This means startup ordering matters: if the VKB server is not yet ready when the adapter initializes, the adapter will route as if the server is permanently absent.

Downstream, all consumers of `GraphDatabaseAdapter` see uniform behavior — they call adapter methods without awareness of whether they reach the VKB backend or a fallback. The `SingleProbeRoutingDecision` is invisible at the API boundary; it manifests only as differences in side effects and return values from the adapter's operations.

## Usage Guidelines

Developers working with the `GraphDatabaseAdapter` should treat each adapter instance as **immutable with respect to routing**. The practical implications:

- **Initialize at the right moment**: Construct and `initialize()` the adapter only when the VKB server's startup state accurately reflects the desired runtime configuration. Initializing too early risks locking in an "unavailable" decision; initializing during a transient outage locks it in for that instance's lifetime.

- **Discard and recreate to refresh routing**: There is no API to re-probe. If runtime conditions change and you need the adapter to reconsider VKB availability, the correct pattern is to discard the existing adapter instance and construct a new one. Do not attempt to monkey-patch the cached value.

- **Do not rely on the adapter for liveness detection**: Because the cached decision can become stale, `GraphDatabaseAdapter` is not a source of truth for current server health. If liveness matters, layer an explicit health check above or alongside it.

- **Expect failures at the call site for late outages**: If the VKB server goes down after `initialize()`, operations will still be routed to it and will fail in whatever way `VkbApiClient` fails. Calling code must handle these errors directly; the adapter will not transparently fall back.

- **Pair conceptually with `LazyVkbClientImport`**: Understand that the lazy import and the single probe are complementary — both exist to ensure environments without VKB pay no cost. Changes to one should consider implications for the other.

---

### Architectural Patterns Identified
- **One-shot capability detection** at lifecycle initialization.
- **Static routing proxy** — `GraphDatabaseAdapter` behaves as a fixed-target proxy after construction.
- **Implicit Strategy selection** — branching on a cached flag rather than swappable strategy objects.
- **Lazy module loading gate** (via the sibling `LazyVkbClientImport`) coordinated with the probe.

### Design Decisions and Trade-offs
- **Simplicity over adaptability**: A single probe is easier to reason about than a circuit breaker but cannot react to changing server state.
- **Predictability over resilience**: Each adapter instance has deterministic routing for its entire lifetime; failures are surfaced rather than masked by re-routing.
- **Startup-time commitment**: The trade-off pushes correctness responsibility onto initialization ordering rather than runtime recovery.

### System Structure Insights
- Routing logic is co-located inside `storage/graph-database-adapter.ts` rather than extracted into a dedicated router class.
- The probe and the dynamic import are unified inside `initialize()`, creating a single startup-time decision point.
- No circuit-breaker or re-routing infrastructure exists in the parent context, indicating the system is intentionally not designed to recover from VKB outages within an adapter instance's lifetime.

### Scalability Considerations
- Scales well in terms of per-operation overhead: routing costs one cached-flag check per call, with no probe overhead.
- Does not scale to environments with intermittent or recovering backends — each transient outage at initialization permanently degrades that instance.
- Horizontal scaling (multiple adapter instances created at different times) could yield inconsistent routing decisions across instances if VKB availability fluctuates between initializations.

### Maintainability Assessment
- **High readability**: The single-probe model is trivial to understand and document.
- **Low surface area for bugs**: Without retry logic, scheduled probes, or state machines, there is little to test beyond the initialize-time branch.
- **Limited extensibility**: Adding dynamic re-routing later would require non-trivial refactoring, since branching logic is embedded in adapter methods rather than abstracted.
- **Clear separation from the sibling `LazyVkbClientImport`**: The two concerns (when to load the module, what to do based on availability) are conceptually distinct even though they share an implementation site, making future refactoring tractable if needs evolve.


## Hierarchy Context

### Parent
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- storage/graph-database-adapter.ts dynamically imports VkbApiClient during its first initialize() call and invokes isServerAvailable() exactly once, making this single probe the permanent routing decision for the adapter instance's lifetime

### Siblings
- [LazyVkbClientImport](./LazyVkbClientImport.md) -- storage/graph-database-adapter.ts uses a dynamic import (import()) for VkbApiClient inside initialize() rather than a static top-level import, so the VKB client module is never loaded in environments where the VKB server is absent at startup.


---

*Generated from 3 observations*
