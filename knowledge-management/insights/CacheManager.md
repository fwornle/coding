# CacheManager

**Type:** Detail

The CacheManager (in CacheManager.ts:21) implements a least-recently-used (LRU) eviction policy to ensure that the most frequently accessed services remain in memory.

## What It Is  

The **CacheManager** is a concrete TypeScript class defined in `CacheManager.ts` (see line 21) that provides an in‑memory caching layer for LLM service calls. It implements a **least‑recently‑used (LRU) eviction policy**, ensuring that the most frequently accessed service responses stay resident while older, less‑used entries are evicted when the cache reaches its configured capacity. The cache’s size limit and entry‑expiration rules are externalised in `CacheConfig.ts`, allowing developers to tune the behaviour for different workloads. Within the overall system, the CacheManager lives under the **LLMServiceManager** component, which owns it and coordinates its use alongside sibling components such as **LLMRouter** and **CircuitBreaker**.

## Architecture and Design  

The design of CacheManager follows a classic **cache‑as‑a‑service** pattern. By encapsulating the LRU logic inside a dedicated class, the system separates concerns: the routing logic in `LLMRouter.ts` (line 51) focuses on directing requests, while CacheManager concentrates on storage, eviction, and expiry. The interaction between CacheManager and LLMRouter is a **collaborative composition** – LLMRouter queries the cache before invoking downstream LLM services, and writes back successful results to the cache. This reduces redundant network calls and lowers latency for hot request patterns.

The configurability exposed through `CacheConfig.ts` reflects a **strategy‑oriented configuration** approach. Rather than hard‑coding limits, the cache reads its maximum entry count and TTL (time‑to‑live) values at construction time, making the component adaptable to diverse performance requirements (e.g., small caches for low‑memory environments versus large caches for high‑throughput workloads). The LRU algorithm itself is an **internal data‑structure strategy** (typically a doubly‑linked list paired with a hash map) that guarantees O(1) access and eviction operations, though the exact implementation details are not enumerated in the observations.

## Implementation Details  

At its core, CacheManager maintains a map of cache keys to cached payloads together with metadata required for LRU ordering (e.g., a linked list of usage timestamps). When a new entry is added, the manager checks the current count against the **maximum size** defined in `CacheConfig.ts`. If the limit would be exceeded, the least‑recently‑used entry—identified by the tail of the usage list—is removed before the new entry is inserted at the head of the list, marking it as most recently used.

Expiration is handled by attaching a **timestamp** (or deadline) to each cached item when it is stored. On every lookup, CacheManager validates that the current time is still within the configured TTL; stale entries are purged on‑the‑fly, ensuring that callers never receive outdated data. Because the eviction and expiration logic are centralized, the rest of the system (including LLMRouter) can treat the cache as a simple key/value store without needing to manage lifecycle concerns.

The CacheManager is instantiated by **LLMServiceManager**, which likely passes a populated `CacheConfig` object during construction. This dependency injection pattern keeps the cache decoupled from hard‑coded settings and enables unit testing with mock configurations. The manager also exposes a minimal public API—typically `get(key)`, `set(key, value)`, and possibly `clear()`—that LLMRouter consumes at the call site shown in `LLMRouter.ts:51`.

## Integration Points  

- **LLMRouter** (`LLMRouter.ts:51`): Before routing a request to a concrete LLM service, LLMRouter invokes `CacheManager.get(requestHash)`. If a cached response exists and is still valid, LLMRouter returns it immediately, bypassing external service calls. After a successful service response, LLMRouter calls `CacheManager.set(requestHash, response)` to populate the cache for future reuse. This tight coupling is intentional; it centralises request deduplication and reduces overall latency.

- **LLMServiceManager** (parent): Owns the CacheManager instance and is responsible for supplying the `CacheConfig`. It may also expose higher‑level cache‑aware methods that wrap the raw router calls, offering a unified façade for downstream consumers.

- **CircuitBreaker** (`CircuitBreaker.ts:31`): While not directly interacting with the cache, CircuitBreaker shares the same parent (LLMServiceManager) and therefore operates in the same request pipeline. A typical flow would be: LLMRouter checks the cache → if miss, CircuitBreaker evaluates service health → if circuit is closed, the request proceeds; otherwise, the request is rejected early. This sibling relationship ensures that caching and resilience mechanisms complement each other without overlapping responsibilities.

- **CacheConfig.ts**: Provides the configurable parameters (`maxSize`, `ttl`, possibly `evictionInterval`). Any component that wishes to adjust caching behaviour (e.g., during testing or for a particular deployment) edits this file, and the changes propagate automatically to CacheManager via the parent’s injection.

## Usage Guidelines  

1. **Key Generation** – Use a deterministic, collision‑free identifier (such as a hash of the request payload and target service name) when calling `CacheManager.get` and `set`. This guarantees that identical logical requests map to the same cache entry, maximising hit rates.

2. **Respect Expiration** – Do not rely on manual cleanup; let CacheManager purge stale entries on access. If you need proactive eviction (e.g., to free memory ahead of a known load spike), invoke the manager’s `clear()` method or design a background job that calls it, but keep such usage rare to avoid unnecessary cache churn.

3. **Configure Appropriately** – Adjust `CacheConfig.ts` based on observed traffic patterns. A small `maxSize` reduces memory pressure but may increase miss rates; a longer TTL improves hit probability for idempotent calls but risks serving outdated data. Perform load testing to find the sweet spot.

4. **Avoid Storing Sensitive Data** – Since the cache lives in process memory, it is not encrypted. Do not cache personally identifiable information (PII) unless the runtime environment guarantees appropriate isolation.

5. **Testing** – When writing unit tests for components that depend on CacheManager (e.g., LLMRouter), inject a mock `CacheConfig` with a tiny `maxSize` and short TTL to simulate eviction scenarios and verify that fallback logic (such as re‑routing to the service) works correctly.

---

### Architectural Patterns Identified
- **LRU Cache (Eviction Strategy)**
- **Configuration‑Driven Strategy** (via `CacheConfig.ts`)
- **Composition / Collaboration** (CacheManager ↔ LLMRouter)
- **Dependency Injection** (parent LLMServiceManager supplies config)

### Design Decisions and Trade‑offs
- **In‑process LRU cache** provides fast O(1) lookups but limits scalability to a single node; distributed caching would be required for multi‑instance deployments.
- **Configurable size/TTL** offers flexibility but adds runtime complexity; developers must tune parameters to avoid excessive eviction or memory bloat.
- **Coupling with LLMRouter** simplifies request flow but introduces a hard dependency; any change to the cache API may ripple to the router.

### System Structure Insights
- CacheManager sits as a child of **LLMServiceManager**, alongside siblings **LLMRouter** and **CircuitBreaker**, forming a cohesive request‑handling pipeline: cache → routing → resilience.
- The cache is the first line of defence against redundant external calls, while CircuitBreaker provides fault tolerance; together they improve both performance and reliability.

### Scalability Considerations
- The current design is optimal for single‑process workloads; scaling horizontally would require a shared cache layer (e.g., Redis) or a sharding strategy.
- LRU eviction remains efficient under high load, but the absolute memory footprint is bounded by `maxSize`, making it predictable for capacity planning.

### Maintainability Assessment
- Clear separation of concerns (caching vs routing vs circuit breaking) promotes easy maintenance; each component can be updated independently.
- Centralising configuration in `CacheConfig.ts` simplifies tuning but mandates careful version control to avoid configuration drift across environments.
- Lack of exposed public symbols in the observations suggests a minimal public API, which reduces surface area for bugs but may limit extensibility; future enhancements should preserve the simple `get/set` contract.


## Hierarchy Context

### Parent
- [LLMServiceManager](./LLMServiceManager.md) -- LLMServiceManager uses a routing mechanism in its LLMRouter class to direct incoming requests to the appropriate LLM service

### Siblings
- [LLMRouter](./LLMRouter.md) -- The LLMRouter class (in LLMRouter.ts) utilizes a mapping configuration to determine the target service for each incoming request, allowing for flexible and dynamic routing.
- [CircuitBreaker](./CircuitBreaker.md) -- The CircuitBreaker (in CircuitBreaker.ts:31) uses a threshold-based approach to detect service failures, triggering a circuit open state when the failure rate exceeds a predefined threshold.


---

*Generated from 3 observations*
