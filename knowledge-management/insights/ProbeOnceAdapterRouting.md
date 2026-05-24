# ProbeOnceAdapterRouting

**Type:** Detail

storage/graph-database-adapter.ts contains the probe-once initialization logic: on first use the adapter checks which backend is reachable and caches the result, so the routing decision (VKB HTTP API vs. GraphDatabaseService) is made exactly once per process lifetime rather than per request.

# ProbeOnceAdapterRouting

## What It Is

ProbeOnceAdapterRouting is the initialization and dispatch strategy implemented in `storage/graph-database-adapter.ts` that determines, exactly once per process lifetime, which backend the `GraphDatabaseAdapter` will route writes to. On the adapter's first use, it probes the available backends to discover whether the VKB HTTP API is reachable or whether it should fall back to the direct `GraphDatabaseService` path. The result of this probe is cached for the remainder of the process, eliminating per-request routing overhead and ensuring all subsequent operations follow a single, deterministic path.

This routing mechanism is a Detail-level concern nested within the broader ManualLearning system. ManualLearning operations — including entity creation and observation attachment — are funnelled exclusively through the `GraphDatabaseAdapter`, which makes ProbeOnceAdapterRouting the de facto gatekeeper for every hand-crafted knowledge-graph mutation in the system. The "probe-once" name captures the essential trade-off: a single startup-time backend discovery in exchange for stable, fast routing throughout the rest of the process's life.

## Architecture and Design

The architectural approach reflects a classic **Adapter pattern** combined with a **lazy-initialized, cached strategy selection**. The `GraphDatabaseAdapter` presents a uniform write interface to callers, while internally hiding two divergent concrete backends: a remote VKB HTTP API path and a local, in-process `GraphDatabaseService` path. By probing once and memoizing the choice, the adapter avoids the cost and complexity of per-call backend negotiation — a deliberate optimization for workloads like ManualLearning where the backend is not expected to change at runtime.

The design also embodies the **single-gateway principle** for the ManualLearning subsystem. Because every manual write must pass through `GraphDatabaseAdapter`, the routing decision made by the probe is universally enforced; there is no path by which a ManualLearning operation can bypass the cached strategy and reach a backend directly. This concentration of routing authority in one place simplifies reasoning about consistency: whichever backend "won" the initial probe is the one that owns all ManualLearning state for that process lifetime.

A notable consequence of this dual-target design is that calling code remains entirely backend-agnostic. Callers depend only on the `GraphDatabaseAdapter` interface, and the probe result transparently selects the concrete implementation. This separation of concerns means that adding a new manual-write operation is a one-sided change — the operation is defined against the adapter, and both backend paths inherit it without modification at the call sites.

## Implementation Details

The core mechanics live in `storage/graph-database-adapter.ts`. On the adapter's first invocation, initialization logic checks backend reachability — first probing the VKB HTTP API and, depending on outcome, either binding the adapter to that remote path or falling back to bind it to the in-process `GraphDatabaseService`. The probe outcome is stored within the adapter instance (or module-level state) such that all subsequent calls bypass the probe and dispatch directly through the cached backend reference.

Because the cached decision is made exactly once per process lifetime, the implementation does not maintain any background health-checking, retry-with-rediscovery, or re-probing logic. The routing state is monotonic: once set, it is never re-evaluated. This keeps the dispatch path on the hot side of every ManualLearning call extremely simple — effectively a function pointer or method dispatch into the chosen backend with no conditional logic per request.

The two backend targets differ substantially in their characteristics. The VKB HTTP API path involves network I/O to a remote service, while the direct `GraphDatabaseService` path operates in-process against a local graph. Despite these differences, both expose semantically equivalent operations for entity creation and observation attachment — the operations that the parent ManualLearning component relies on — allowing the adapter to present them interchangeably to callers.

## Integration Points

ProbeOnceAdapterRouting sits at the intersection of three subsystems. Upstream, it serves the ManualLearning component, which directs all hand-crafted entity creation and observation attachment operations through the `GraphDatabaseAdapter`. Downstream, it dispatches to either the VKB HTTP API (a remote service interface) or the `GraphDatabaseService` (a local, in-process graph implementation). The adapter itself is the binding layer that abstracts these two concrete backends behind a single interface.

The integration contract is asymmetric in an important way: while ManualLearning depends on the adapter, the adapter's chosen backend depends on the deployment environment's reachability characteristics at startup. This means the runtime topology — whether the system is operating in "VKB HTTP mode" or "direct-graph mode" — is decided not by configuration alone but by what the probe actually observes when the process first uses the adapter.

For developers extending the system, the integration surface is narrow and well-defined: any new manual-write operation must be added to the `GraphDatabaseAdapter` interface (and implemented for both backends to preserve parity). No calling code in ManualLearning needs to be aware of the backend distinction.

## Usage Guidelines

The single most important rule is that **all manual knowledge-graph writes must go through `GraphDatabaseAdapter`**. Bypassing the adapter — for example, by calling `GraphDatabaseService` directly from a ManualLearning code path — would violate the single-gateway invariant and defeat the routing abstraction. When adding new manual-write operations (such as new entity types or observation patterns), define them against the adapter interface and ensure both the VKB HTTP and direct-graph backends implement them consistently.

A critical operational constraint follows from the probe-once semantics: **any change in backend availability after startup is invisible to ManualLearning**. If the VKB HTTP API becomes reachable after the process has already cached a fallback to `GraphDatabaseService` (or vice versa), the adapter will continue using the originally chosen path until the process is restarted. Deployments that intend to switch between VKB HTTP and direct-graph modes must therefore treat process restart as a required step for the routing change to take effect. This should be documented in deployment runbooks and considered during failover planning.

Developers should also recognize that the probe-once design optimizes for steady-state correctness and performance, not for backend hot-swapping or high-availability failover. If a use case emerges that requires dynamic re-routing — for instance, transparent failover from the VKB HTTP API to the local service mid-process — this would require fundamental changes to the routing strategy in `storage/graph-database-adapter.ts`, not just configuration tweaks. Until such a need arises, the current design's simplicity and predictability are its primary virtues.

---

### Summary of Key Insights

**1. Architectural patterns identified:** Adapter pattern (uniform interface over divergent backends), lazy-initialized cached strategy selection (probe-once memoization), and single-gateway enforcement (all ManualLearning writes funnelled through one component).

**2. Design decisions and trade-offs:** The decision to probe exactly once trades runtime adaptability for dispatch simplicity and performance. Cached routing means zero per-request overhead but also zero responsiveness to backend availability changes — a deliberate choice favoring steady-state stability over dynamic resilience.

**3. System structure insights:** `GraphDatabaseAdapter` in `storage/graph-database-adapter.ts` is the authoritative chokepoint for ManualLearning's write operations. The two backends (VKB HTTP API and `GraphDatabaseService`) are interchangeable from the caller's perspective, enforced by the adapter's uniform interface.

**4. Scalability considerations:** Per-request routing cost is constant and minimal (one cached dispatch). However, the design does not scale to scenarios requiring per-tenant or per-request backend selection, nor to environments with frequent backend availability changes. The probe itself only happens once, so initialization cost is bounded.

**5. Maintainability assessment:** High maintainability for the common case — new manual-write operations require changes only at the adapter interface and its two implementations, with no calling-code churn. The operational constraint that restarts are required to re-evaluate routing is a maintainability concern that must be clearly communicated in deployment documentation to prevent surprising failover behavior.


## Hierarchy Context

### Parent
- [ManualLearning](./ManualLearning.md) -- ManualLearning entities are routed through GraphDatabaseAdapter, meaning all hand-crafted writes go either to the VKB HTTP API or directly to GraphDatabaseService depending on the probe-once initialization decision in storage/graph-database-adapter.ts


---

*Generated from 4 observations*
