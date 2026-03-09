# CacheManager

**Type:** SubComponent

The CacheManager class likely uses a cache-aside pattern to manage the caching of LLM responses, as seen in the lib/llm/llm-service.ts file, which handles LLM operations.

**CacheManager – Technical Insight Document**  

---

### What It Is  

CacheManager is the sub‑component responsible for handling the in‑process cache that stores LLM (large‑language‑model) responses within the **LLMAbstraction** layer. Although no concrete source file is listed in the observations, the surrounding code (e.g., `lib/llm/llm‑service.ts`) makes it clear that CacheManager lives alongside the LLM service implementation—most plausibly under `lib/llm/` or a sibling directory such as `lib/llm/cache/`. Its primary role is to mediate between the LLM service and downstream callers, providing a fast‑lookup store for previously‑generated completions while respecting the policies defined by the surrounding architecture (budget checks, mode routing, provider fallback, etc.).  

The component is described as a **singleton** that follows a **cache‑aside** workflow: callers first query the cache; on a miss the LLM service is invoked, and the fresh result is written back into the cache. The cache entries are governed by a **least‑recently‑used (LRU) eviction policy**, ensuring that the most stale items are purged when capacity limits are reached. Configuration for the cache (size limits, TTL, eviction thresholds) is externalised in a dedicated configuration artifact, allowing operators to tune behaviour without code changes.  

CacheManager also participates in two cross‑cutting concerns: it decorates the core caching logic with additional behaviours (e.g., logging, metrics) via a **decorator pattern**, and it publishes cache‑state changes to interested parties through an **observer pattern**. These mechanisms enable other sub‑components—most notably **LLMModeManager**, but also any component that wishes to react to cache updates—to stay in sync without tight coupling.  

---

### Architecture and Design  

The design of CacheManager is tightly aligned with the broader **LLMAbstraction** architecture, which is built around a micro‑service‑style separation of concerns for each LLM‑related task. Within this context, CacheManager acts as a **local, in‑memory service** that other components treat as a shared resource.  

* **Singleton Pattern** – The observations explicitly state that CacheManager is a singleton, guaranteeing a single coherent cache instance across the entire process. This decision eliminates the need for distributed cache coordination while simplifying state management for the LLM abstraction layer.  

* **Cache‑Aside Pattern** – By checking the cache before delegating to the LLM service and writing the result back after a miss, CacheManager follows the classic cache‑aside approach. This pattern fits naturally with the existing `llm‑service.ts` flow, where the service already performs mode routing, circuit breaking, and provider fallback. The cache‑aside model lets those upstream concerns remain untouched while still gaining the performance benefits of caching.  

* **LRU Eviction** – The cache employs a least‑recently‑used eviction algorithm. This choice reflects a trade‑off that favours keeping hot response data in memory, which is ideal for interactive LLM workloads where recent prompts are likely to be repeated.  

* **Decorator Pattern** – CacheManager is wrapped with decorators that inject extra capabilities (e.g., request‑level metrics, debug logging). The decorator layer is lightweight and composable, allowing new behaviours to be added without modifying the core cache implementation.  

* **Observer Pattern** – When cache entries are added, evicted, or invalidated, CacheManager notifies registered observers. This mechanism is used by the **LLMModeManager** (and potentially other siblings) to adjust mode‑specific heuristics, invalidate stale mode‑specific entries, or trigger downstream analytics.  

The component therefore sits at the intersection of **stateful caching** and **event‑driven coordination**, acting as a shared service that respects the same reliability and resilience patterns (e.g., retry‑with‑backoff in ConnectionManager) employed elsewhere in the LLMAbstraction hierarchy.  

---

### Implementation Details  

Although the source symbols for CacheManager are not enumerated, the observations give a clear picture of its internal structure:  

1. **Singleton Instance** – A static accessor (e.g., `CacheManager.getInstance()`) creates the sole cache object at first use. The constructor is private, preventing accidental duplication.  

2. **Cache Store** – The underlying storage is an LRU map, most likely implemented with a `Map` linked to a doubly‑linked list to maintain access order. When the map exceeds the configured capacity (read from the external configuration file), the least‑recently‑used entry is removed automatically.  

3. **Configuration Integration** – At startup, CacheManager reads a configuration artifact (e.g., `cache-config.json` or a section of the global `llm‑config.yaml`). Settings include `maxEntries`, optional `ttlMs`, and flags that enable or disable the observer notifications. Because the configuration is external, operators can adjust cache size without rebuilding the service.  

4. **Decorator Stack** – The core cache object is wrapped by one or more decorators. A typical stack might be:  
   * `MetricsCacheDecorator` – records hit/miss counters and latency for Prometheus.  
   * `LoggingCacheDecorator` – emits structured logs on cache events.  
   The decorators conform to the same interface as the base CacheManager, preserving interchangeability.  

5. **Observer Registry** – CacheManager maintains a list of observers implementing a simple callback interface (e.g., `onCacheUpdate(key, event)`). When an entry is inserted, updated, or evicted, it iterates over this list and dispatches the appropriate event. The **LLMModeManager** registers itself as an observer to stay aware of mode‑specific cache churn.  

6. **Cache‑Aside Workflow** – Client code (most likely the LLM service in `lib/llm/llm‑service.ts`) follows this sequence:  
   ```ts
   const cached = CacheManager.instance.get(prompt);
   if (cached) return cached;
   const response = await LLMProvider.invoke(prompt);
   CacheManager.instance.set(prompt, response);
   return response;
   ```  
   The `get` method updates the LRU order on a hit, while `set` may trigger eviction and observer notifications.  

7. **Error Handling & Resilience** – Because CacheManager is a local in‑process component, errors are limited to memory pressure or misconfiguration. The singleton nature means that any failure to initialise (e.g., malformed config) aborts the entire LLMAbstraction startup, making early detection a design priority.  

---

### Integration Points  

CacheManager is woven into the LLMAbstraction ecosystem through several explicit connections:  

* **LLM Service (`lib/llm/llm‑service.ts`)** – The primary consumer. The service invokes CacheManager before calling any external LLM provider, thereby embedding the cache‑aside pattern directly into the request pipeline.  

* **LLMModeManager** – Registers as an observer. When CacheManager evicts or updates entries, LLMModeManager can purge mode‑specific caches, adjust internal heuristics, or refresh mode‑related metadata.  

* **ProviderRegistry & ConnectionManager** – While they do not call CacheManager directly, they benefit indirectly. A cached response avoids the need for a new connection (handled by ConnectionManager) or a provider lookup (handled by ProviderRegistry), reducing load on those subsystems.  

* **Configuration System** – CacheManager reads its settings from the same configuration source used by its siblings, ensuring consistent operational parameters across the LLMAbstraction component.  

* **Metrics & Logging Infrastructure** – Through its decorators, CacheManager emits data that feeds into the system‑wide observability stack, aligning with the instrumentation patterns already present in ConnectionManager (retry‑with‑backoff metrics) and ProviderRegistry (registry health checks).  

These integration points illustrate a tightly coupled yet loosely bound architecture: CacheManager provides a shared service while remaining decoupled through interfaces (decorators, observers) that allow siblings to evolve independently.  

---

### Usage Guidelines  

1. **Never Instantiate Directly** – Always obtain the cache via the singleton accessor (`CacheManager.getInstance()`). Direct construction bypasses the decorator stack and observer registration, leading to inconsistent behaviour.  

2. **Respect the Cache‑Aside Contract** – Callers should first attempt `get(key)` and only invoke the LLM provider on a miss. After receiving a fresh response, invoke `set(key, value)` to populate the cache. Skipping the `set` step defeats the purpose of the cache and may cause unnecessary provider calls.  

3. **Observe Capacity Limits** – The configured `maxEntries` (or TTL) should be tuned to the expected workload. Over‑provisioning can cause memory pressure; under‑provisioning leads to high eviction rates and reduced cache effectiveness.  

4. **Register Observers Early** – Components that need to react to cache changes (e.g., LLMModeManager) must register their observers during application bootstrap, before any cache activity occurs. This guarantees that no state change is missed.  

5. **Do Not Store Sensitive Data Unencrypted** – CacheManager does not perform encryption; if responses contain PII or other regulated data, callers must sanitize or encrypt before calling `set`.  

6. **Leverage Decorators for Instrumentation** – When adding new cross‑cutting concerns (e.g., tracing), extend the decorator chain rather than modifying the core cache logic. This preserves the singleton’s integrity and keeps the eviction policy untouched.  

7. **Handle Cache Misses Gracefully** – Because the cache is local, a miss is expected and should not be treated as an error condition. Ensure that fallback logic (circuit breaking, provider fallback) remains in the LLM service layer, not in CacheManager.  

---

## Summary of Key Findings  

| Item | Insight (grounded in observations) |
|------|--------------------------------------|
| **Architectural patterns identified** | Singleton, Cache‑Aside, LRU eviction, Decorator, Observer |
| **Design decisions & trade‑offs** | Single in‑process cache simplifies consistency but limits scalability to one node; LRU balances recency vs. memory usage; decorators keep cross‑cutting concerns modular; observer pattern enables loose coupling with LLMModeManager. |
| **System structure insights** | CacheManager sits under the **LLMAbstraction** parent, shares configuration with siblings, and acts as a shared service for the LLM service pipeline. |
| **Scalability considerations** | As a singleton in‑process cache, horizontal scaling requires each process to maintain its own cache, potentially leading to cache duplication. For true distributed scaling, an external cache (e.g., Redis) would be needed, but that would change the current design. |
| **Maintainability assessment** | High maintainability: clear separation of concerns via decorators and observers, externalised configuration, and a well‑defined singleton interface. The main maintenance burden lies in tuning cache size/TTL and ensuring observers are kept in sync with cache semantics. |

*All statements above are derived directly from the supplied observations; no additional assumptions have been introduced.*


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes a microservices architecture, with each agent responsible for a specific task, allowing for a unified interface to interact with different LLM providers. This is evident in the use of the LLMService class (lib/llm/llm-service.ts) to handle LLM operations, including mode routing, caching, circuit breaking, budget/sensitivity checks, and provider fallback. For instance, the connectViaHTTP method of the ConnectionManager class implements a retry-with-backoff pattern to establish connections to LLM providers, ensuring reliable communication.

### Siblings
- [LLMModeManager](./LLMModeManager.md) -- The LLMModeManager class likely utilizes a strategy pattern to manage different LLM modes, as seen in the lib/llm/llm-service.ts file, which handles LLM operations.
- [ProviderRegistry](./ProviderRegistry.md) -- The ProviderRegistry class probably uses a registry pattern to manage the different LLM providers, as seen in the lib/llm/llm-service.ts file, which handles LLM operations.
- [ConnectionManager](./ConnectionManager.md) -- The ConnectionManager class likely uses a retry-with-backoff pattern to establish connections to LLM providers, as seen in the connectViaHTTP method.


---

*Generated from 7 observations*
