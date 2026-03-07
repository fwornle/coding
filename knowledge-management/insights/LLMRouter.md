# LLMRouter

**Type:** Detail

The LLMRouter class (in LLMRouter.ts) utilizes a mapping configuration to determine the target service for each incoming request, allowing for flexible and dynamic routing.

## What It Is  

`LLMRouter` is the core routing component of the LLM serving stack, defined in **`LLMRouter.ts`**.  It receives every inbound request that originates from the **`LLMServiceManager`** (its parent) and, based on a declarative mapping configuration, decides which downstream LLM service instance should handle the request.  The router is not a static switch; it actively evaluates service health and current load before forwarding traffic, thereby providing both flexibility (the mapping can be altered without code changes) and resilience (unavailable or overloaded services are bypassed).  In addition, `LLMRouter` works hand‑in‑hand with the **`CacheManager`** (implemented in **`CacheManager.ts`**) to keep hot‑path routing decisions and frequently accessed service responses in memory, reducing latency for repeat calls.

---

## Architecture and Design  

The observations reveal a **configuration‑driven routing** architecture.  The mapping configuration lives inside `LLMRouter.ts` and acts as a lookup table that ties request attributes (e.g., model name, request type) to concrete service endpoints.  This design mirrors the **Strategy pattern**: the router selects a routing “strategy” at runtime based on the current configuration, service availability, and load metrics.  

`LLMRouter` also incorporates **load‑balancing logic** (see line 42 of `LLMRouter.ts`).  Rather than a simple round‑robin, the router checks each candidate service’s availability flag and current load counters, choosing the healthiest node.  This creates a **self‑optimizing** layer that spreads traffic evenly and prevents hot spots.  

The router’s interaction with `CacheManager` introduces a **Cache‑Aside pattern**: before performing the full routing computation, the router queries the cache for a recent routing decision or cached response.  If a hit occurs, the request can be satisfied immediately; otherwise, the router proceeds with its full decision flow and subsequently populates the cache.  The sibling `CircuitBreaker` (in `CircuitBreaker.ts`) complements this design by guarding the routing path against cascading failures—if a service repeatedly fails, the circuit breaker opens, and `LLMRouter` will automatically exclude that service from its selection pool.  

Overall, the architecture is a **layered composition**:  
1. **Parent layer** – `LLMServiceManager` delegates request handling to `LLMRouter`.  
2. **Routing layer** – `LLMRouter` decides the target service using configuration, health checks, and load metrics.  
3. **Resilience layer** – `CircuitBreaker` supplies failure detection; `CacheManager` supplies fast‑path memory caching.  

No explicit micro‑service or event‑driven constructs are mentioned; the design stays within a **modular, in‑process** composition that can be extended by swapping out the configuration or plugging additional siblings (e.g., a future `RateLimiter`).

---

## Implementation Details  

The **mapping configuration** lives within `LLMRouter.ts`.  It is likely a plain object or JSON structure keyed by request signatures (e.g., `{ "gpt‑4": "serviceA", "bert‑base": "serviceB" }`).  The router reads this map at startup and may watch the file for hot‑reloading, enabling dynamic updates without redeployment.  

At **line 42 of `LLMRouter.ts`**, the routing algorithm performs three checks:  

1. **Service Availability** – each candidate service reports an `isAvailable` flag, probably set by the `CircuitBreaker` when a circuit opens.  
2. **Load Balancing** – the router queries a per‑service load counter (e.g., active request count or recent latency) and selects the least‑loaded node.  
3. **Fallback** – if no service passes the first two checks, the router may return an error or route to a default “degraded‑mode” service.  

The **interaction with `CacheManager`** is two‑fold. First, before computing the routing decision, `LLMRouter` calls `CacheManager.get(key)` where the key encodes the request fingerprint.  If a cached routing result exists, the router short‑circuits the decision process.  Second, after a successful routing and response, `LLMRouter` invokes `CacheManager.set(key, response, ttl)` to store the result, leveraging the **LRU eviction policy** defined in `CacheManager.ts:21`.  This policy ensures that the most frequently accessed services stay resident in memory, while stale entries are evicted automatically, keeping memory usage bounded.  

The **circuit‑breaker integration** is implicit but critical.  When `CircuitBreaker` (line 31 of `CircuitBreaker.ts`) detects a failure rate above its threshold, it flips the circuit to an open state and signals `LLMRouter`—likely via an event emitter or a shared status object—so that the failing service is excluded from the routing pool.  When the circuit resets, the service becomes eligible again.  

All three components—router, cache, circuit breaker—are **loosely coupled** through well‑defined interfaces (`IRouter`, `ICache`, `ICircuitBreaker`‑like contracts are implied by the file naming), which simplifies unit testing and future replacement.

---

## Integration Points  

- **Parent: `LLMServiceManager`** – The manager instantiates `LLMRouter` and forwards every external request to it.  The manager may also provide higher‑level concerns such as authentication or request transformation before handing off to the router.  
- **Sibling: `CacheManager`** – Exposed via import from `CacheManager.ts`.  The router calls `CacheManager.get` and `CacheManager.set` directly; the cache’s LRU policy (line 21) ensures that routing decisions for hot services are cached efficiently.  
- **Sibling: `CircuitBreaker`** – Imported from `CircuitBreaker.ts`.  The router reads the circuit state (open/closed) for each service before selection.  The circuit breaker updates its state based on failure metrics, which are fed back into the router’s availability check.  
- **External Services** – The actual LLM service instances (e.g., model servers) are not described in the observations, but they are the ultimate targets of the routing decision.  Each service likely implements a health‑check endpoint that the router polls to maintain the `isAvailable` flag.  

The router’s public API probably includes a method such as `route(request): Promise<Response>` that returns a promise resolved with the selected service’s response.  Because the router is a pure TypeScript class, it can be imported into any Node.js runtime that the rest of the LLM stack uses.

---

## Usage Guidelines  

1. **Configure Mapping Early** – Populate the mapping configuration in `LLMRouter.ts` before the application starts.  Keep the keys stable (e.g., model identifiers) to avoid cache misses caused by frequent key churn.  
2. **Monitor Service Health** – Ensure each downstream LLM service exposes a health endpoint that `LLMRouter` (or the underlying health‑check subsystem) can query.  Accurate health signals keep the router’s availability filter reliable.  
3. **Tune Cache TTL and Size** – The `CacheManager` LRU policy works best when the TTL aligns with the expected request pattern.  For highly dynamic models, use a shorter TTL; for stable, frequently requested models, a longer TTL reduces latency.  
4. **Set CircuitBreaker Thresholds Wisely** – The threshold in `CircuitBreaker.ts:31` should balance false positives (opening circuits on transient spikes) against true failure protection.  Adjust based on observed latency and error rates of each LLM service.  
5. **Avoid Direct Service Calls Bypassing the Router** – All internal modules that need to invoke an LLM service should go through `LLMServiceManager` → `LLMRouter`.  This guarantees that load‑balancing, caching, and circuit‑breaker logic are consistently applied.  

---

### Architectural Patterns Identified  

1. **Configuration‑Driven Routing (Strategy‑like)** – Mapping configuration determines routing logic at runtime.  
2. **Load Balancing with Health Checks** – Dynamic selection based on service availability and load counters.  
3. **Cache‑Aside (Lazy Caching)** – `LLMRouter` queries `CacheManager` before computing routing decisions and populates the cache afterward.  
4. **Circuit Breaker** – Failure detection and isolation via `CircuitBreaker`.  

### Design Decisions and Trade‑offs  

- **Flexibility vs. Complexity** – Using a mapping configuration provides high flexibility (routes can be changed without code changes) but introduces the need for robust validation and hot‑reload handling.  
- **In‑Process Routing vs. External Proxy** – Keeping routing logic inside the same process (as a TypeScript class) reduces network hops but ties the router’s scalability to the host process’s resources.  
- **Cache‑Aside vs. Write‑Through** – The chosen cache‑aside approach avoids unnecessary cache writes on every request, but it may result in a short window where a hot request is not cached.  

### System Structure Insights  

- **Hierarchical Composition** – `LLMServiceManager` (parent) → `LLMRouter` (core) → siblings (`CacheManager`, `CircuitBreaker`).  
- **Loose Coupling via Interfaces** – Each component interacts through clearly defined methods (`route`, `get/set`, `isOpen`), enabling independent evolution.  
- **Shared State via Service Health Objects** – Availability flags are shared between `CircuitBreaker` and `LLMRouter`, providing a single source of truth for service health.  

### Scalability Considerations  

- **Horizontal Scaling** – Since routing is performed in‑process, scaling out requires spawning additional instances of the host service (e.g., multiple Node.js workers).  The mapping configuration is static across instances, so consistency must be ensured (e.g., via a shared config store).  
- **Cache Size Management** – The LRU policy in `CacheManager` automatically caps memory usage, allowing the router to scale with request volume without unbounded memory growth.  
- **Load‑Balancing Granularity** – The router’s load metrics (active request count, latency) must be updated atomically to avoid race conditions in high‑concurrency scenarios; otherwise, uneven distribution could emerge.  

### Maintainability Assessment  

The design’s reliance on **explicit, named files** (`LLMRouter.ts`, `CacheManager.ts`, `CircuitBreaker.ts`) and **clear separation of concerns** makes the codebase approachable for new developers.  The configuration‑driven approach reduces the need for code changes when routing policies evolve, enhancing maintainability.  However, the tight coupling of health status between `CircuitBreaker` and `LLMRouter` requires careful documentation to prevent accidental state inconsistencies.  Adding new routing criteria (e.g., geographic locality) will involve extending the mapping configuration and possibly the routing algorithm, but the existing modular interfaces support such extensions with minimal ripple effects.


## Hierarchy Context

### Parent
- [LLMServiceManager](./LLMServiceManager.md) -- LLMServiceManager uses a routing mechanism in its LLMRouter class to direct incoming requests to the appropriate LLM service

### Siblings
- [CacheManager](./CacheManager.md) -- The CacheManager (in CacheManager.ts:21) implements a least-recently-used (LRU) eviction policy to ensure that the most frequently accessed services remain in memory.
- [CircuitBreaker](./CircuitBreaker.md) -- The CircuitBreaker (in CircuitBreaker.ts:31) uses a threshold-based approach to detect service failures, triggering a circuit open state when the failure rate exceeds a predefined threshold.


---

*Generated from 3 observations*
