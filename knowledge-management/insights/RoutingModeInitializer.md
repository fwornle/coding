# RoutingModeInitializer

**Type:** Detail

Based on the parent context, GraphDatabaseAdapter invokes VkbApiClient.isServerAvailable() a single time at initialization — never again during normal operation — making the live/direct decision immutable for the adapter instance.

## What It Is  

**RoutingModeInitializer** is the component that decides, once and only once, how a `GraphDatabaseAdapter` will route its operations. During the adapter’s startup sequence it invokes `VkbApiClient.isServerAvailable()` and captures the returned boolean. That value becomes an **immutable routing‑mode flag** for the entire lifetime of the `GraphDatabaseAdapter` instance. When the flag is `true` the adapter routes all calls to the live `VkbApiClient`; when `false` it bypasses the API and talks directly to the underlying `GraphDatabaseService`. The initializer lives inside the `GraphDatabaseAdapter` package (the exact file path is not disclosed in the observations) and is the sole source of truth for the routing decision.

---

## Architecture and Design  

The design follows a **single‑evaluation strategy pattern**: at construction time the system selects one concrete strategy (live vs. direct) and then uses that strategy for every subsequent operation. The decision is made by `RoutingModeInitializer` and stored as a simple boolean, effectively turning the routing mode into a **static configuration** for the adapter instance.  

Because the boolean is cached and never recomputed, the architecture embraces **immutability** and **deterministic routing**. This eliminates any runtime branching overhead and guarantees that all components downstream of the adapter see a consistent execution path. The pattern also mirrors a **configuration‑on‑boot** approach—similar to a lightweight `Singleton` for the routing flag, but scoped to the adapter instance rather than the whole JVM.

Interaction flow (illustrated below) shows the one‑time call chain:

```
GraphDatabaseAdapter
│
└─► RoutingModeInitializer
      │
      └─► VkbApiClient.isServerAvailable()
            (returns boolean → cached as routingMode)
```

Once the boolean is cached, every method inside `GraphDatabaseAdapter` checks the flag (often via an internal helper) and forwards the request either to `VkbApiClient` (live mode) or directly to `GraphDatabaseService` (direct mode). No other component re‑invokes the availability check, making the routing decision **immutable** for the adapter’s lifespan.

---

## Implementation Details  

* **`RoutingModeInitializer`** – contains the sole call to `VkbApiClient.isServerAvailable()`. The method is executed during the adapter’s construction phase, typically in the adapter’s constructor or a dedicated `init()` routine. The returned value is stored in a private final field, e.g. `private final boolean liveMode;`. Because the field is final, Java’s memory model guarantees visibility to all threads after construction.

* **`GraphDatabaseAdapter`** – holds a reference to `RoutingModeInitializer` (or directly to its boolean flag). All public API methods begin with a lightweight conditional, e.g.:

  ```java
  if (routingModeInitializer.isLiveMode()) {
      return vkbApiClient.performOperation(...);
  } else {
      return graphDatabaseService.performOperation(...);
  }
  ```

  The adapter never calls `VkbApiClient.isServerAvailable()` again; the cached flag is the only gate.

* **`VkbApiClient.isServerAvailable()`** – a health‑check endpoint that returns `true` when the remote server can be reached. The initializer treats this as a binary signal; any exception or false result leads to direct mode.

* **Immutability enforcement** – because the boolean is final and set only once, the system avoids race conditions and eliminates the need for synchronization around routing decisions.

There are no additional child classes or helper objects reported; the whole routing mechanism revolves around this single boolean cache.

---

## Integration Points  

* **Parent – `GraphDatabaseAdapter`** – `RoutingModeInitializer` is instantiated (or invoked) by the adapter during its own initialization. The adapter depends on the initializer for its routing flag and on `VkbApiClient` for the live‑mode path.

* **Sibling components** – any other adapters or services that need to know the routing mode would have to query the same `VkbApiClient.isServerAvailable()` independently; there is no shared global flag, which isolates the decision to each adapter instance.

* **External dependency – `VkbApiClient`** – the only external call made by the initializer. The client must implement `isServerAvailable()` and be reachable at startup; otherwise the adapter falls back to direct mode.

* **Direct backend – `GraphDatabaseService`** – used when the routing flag is false. No additional negotiation occurs; the adapter forwards calls straight to this service.

Because the routing mode never changes after construction, integration concerns are limited to **startup configuration**: ensuring the server is up if live mode is desired, and that the `GraphDatabaseService` is correctly configured for direct mode.

---

## Usage Guidelines  

1. **Treat the routing mode as immutable** – once a `GraphDatabaseAdapter` instance is created, its routing behavior cannot be altered. If the environment changes (e.g., the remote server becomes available after a failure), a new adapter instance must be constructed to pick up the new mode.

2. **Validate server availability before startup** – if the application expects live mode, guarantee that `VkbApiClient.isServerAvailable()` will succeed during the adapter’s initialization. Otherwise the system will silently fall back to direct mode.

3. **Do not call `VkbApiClient.isServerAvailable()` elsewhere** – the design assumes a single evaluation point. Additional checks add no value and may introduce inconsistent routing decisions.

4. **Restart or re‑instantiate to change mode** – any change in deployment topology (e.g., switching from a test environment without the remote API to production) requires a fresh `GraphDatabaseAdapter` construction so that `RoutingModeInitializer` can re‑evaluate the flag.

5. **Thread safety is guaranteed by final field semantics** – developers can safely share a `GraphDatabaseAdapter` instance across threads without additional synchronization for routing decisions.

---

### Architectural Patterns Identified  

1. **Strategy (static selection)** – live vs. direct routing chosen once at startup.  
2. **Immutable Configuration** – routing flag stored in a final field, never mutated.  
3. **Configuration‑on‑Boot** – system behavior fixed during component construction.

### Design Decisions & Trade‑offs  

* **Decision to cache the availability check** eliminates runtime overhead and guarantees deterministic behavior, but sacrifices adaptability to transient network failures.  
* **Using a simple boolean** keeps the implementation lightweight; however, it precludes more nuanced routing (e.g., fallback to direct mode on per‑call failure).  
* **Isolation per adapter instance** avoids global state but requires each consumer to manage its own lifecycle if different routing policies are needed.

### System Structure Insights  

* `RoutingModeInitializer` is a **leaf component** with a single responsibility: probe the remote API and expose a boolean flag.  
* The `GraphDatabaseAdapter` acts as the **facade** that hides the routing decision from callers, presenting a uniform interface regardless of the underlying mode.

### Scalability Considerations  

* Because the routing decision is static, scaling the number of adapter instances does not increase the load on `VkbApiClient.isServerAvailable()`—the check is performed only once per instance.  
* The approach scales well for high‑throughput workloads where per‑call routing checks would be a bottleneck.  
* Conversely, if the environment frequently toggles server availability, the design forces frequent restarts or re‑instantiations, which can impact scalability in dynamic cloud deployments.

### Maintainability Assessment  

* **High maintainability** – the code path is minimal (one call, one cached flag), making it easy to understand and test.  
* **Low complexity** – no branching logic beyond a single boolean check, reducing the surface for bugs.  
* **Potential technical debt** – future requirements for dynamic routing will require refactoring, as the current design deliberately blocks re‑evaluation. Documentation should clearly state this limitation to avoid surprise when operational conditions change.


## Hierarchy Context

### Parent
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter calls VkbApiClient.isServerAvailable() exactly once at initialization and caches the result as the permanent routing mode — no per-operation re-evaluation occurs


---

*Generated from 3 observations*
