# CacheInvalidationHandler

**Type:** Detail

CacheInvalidationHandler would likely utilize the ClassificationCache class in classification_cache.py to store and retrieve classification results, implementing a mechanism to track cache validity

## What It Is  

`CacheInvalidationHandler` is the component responsible for keeping the **classification cache** fresh inside the **ClassificationCacheManager** hierarchy.  According to the observations it lives alongside the other cache‑related helpers (e.g., `CacheHitHandler`) and works directly with the `ClassificationCache` class defined in **`classification_cache.py`**.  Its core purpose is to decide when a cached classification result is no longer valid and must be removed or refreshed, thereby preventing stale data from being served to callers such as the `LLMCallCoordinator`.  The handler is expected to employ a **timestamp‑based TTL (time‑to‑live)** strategy and may also react to explicit invalidation events, giving the system a hybrid approach to cache freshness.

---

## Architecture and Design  

The design of `CacheInvalidationHandler` follows a **separation‑of‑concerns** pattern: the `ClassificationCacheManager` owns the overall cache lifecycle, while the handler isolates the *invalid‑ation* logic.  The observations point to a **hybrid invalidation architecture** that mixes **time‑based** (TTL) and **event‑driven** triggers.  This combination allows the system to reap the predictability of periodic expiration while still reacting instantly to domain events (e.g., a model update) that make existing entries obsolete.

Interaction flow (as inferred from the hierarchy):

1. **`ClassificationCacheManager`** creates or holds an instance of `CacheInvalidationHandler`.  
2. When a classification result is written to `ClassificationCache`, the handler tags the entry with a **timestamp** and a configurable TTL.  
3. **`CacheHitHandler`** queries the cache; before returning a hit it asks the invalidation handler whether the entry’s TTL has elapsed.  
4. If an entry is stale, the handler signals the **`LLMCallCoordinator`** (or another orchestrator) to recompute the classification, effectively turning a cache miss into a controlled refresh.  

No explicit design patterns beyond this functional decomposition are mentioned, so we stay within the observed “handler” and “manager” roles.

---

## Implementation Details  

Although the source code is not present, the observations give a clear picture of the internal mechanics:

* **Timestamp‑based TTL** – When a classification result is cached, `CacheInvalidationHandler` records the current time (likely via `time.time()` or `datetime.utcnow()`) together with a TTL value.  The TTL may be a constant defined in configuration or passed per‑entry, allowing flexible expiration windows.

* **Validity Check** – The handler exposes a method (e.g., `is_valid(cache_key) -> bool`) that computes `now - entry_timestamp`.  If the elapsed time exceeds the TTL, the entry is marked **invalid**.  This method is invoked by `CacheHitHandler` before a cached value is returned.

* **Event‑driven Invalidation** – The handler can also receive explicit invalidation calls (e.g., `invalidate(key)` or `invalidate_all()`).  Such calls are likely triggered by higher‑level components when a model version changes or when external signals indicate that the cached classification is no longer trustworthy.

* **Integration with `ClassificationCache`** – The handler does **not** store the data itself; it only maintains metadata (timestamps, TTLs).  The actual key‑value store lives in `ClassificationCache`.  The handler therefore needs a reference to the cache to read/write its metadata, which is why it is a child of `ClassificationCacheManager`.

* **Configuration** – The TTL duration and any thresholds for event‑driven invalidation are probably configurable through the manager’s settings, enabling operators to tune the trade‑off between freshness and performance.

---

## Integration Points  

`CacheInvalidationHandler` sits at the crossroads of three major components:

1. **`ClassificationCache` (in `classification_cache.py`)** – The handler reads and writes timestamp metadata for each cache entry.  It does not interfere with the actual classification payload, preserving the single‑responsibility principle.

2. **`CacheHitHandler`** – Before returning a cached classification, this sibling component calls into the handler to verify that the entry has not exceeded its TTL.  If the entry is invalid, `CacheHitHandler` treats the request as a miss and forwards it upstream.

3. **`LLMCallCoordinator`** – When the handler determines that an entry is stale (or when an explicit invalidation event occurs), it indirectly causes the coordinator to perform a fresh LLM inference.  The coordination may happen via a callback, a message on an internal event bus, or a direct method invocation, depending on the concrete implementation.

Because `CacheInvalidationHandler` is encapsulated within `ClassificationCacheManager`, any external module that needs to influence cache freshness does so through the manager’s public API, preserving encapsulation and reducing coupling.

---

## Usage Guidelines  

* **Never bypass the handler** – All reads and writes to `ClassificationCache` that require freshness checks should go through `CacheHitHandler` and `CacheInvalidationHandler`.  Direct manipulation of the cache without updating timestamps can lead to silent stale data.

* **Configure TTL thoughtfully** – Short TTLs improve freshness but increase the load on the `LLMCallCoordinator`.  Long TTLs reduce recomputation cost but risk serving outdated classifications.  Align TTL values with the expected rate of model updates and the volatility of the input domain.

* **Leverage event‑driven invalidation** – When a model version is deployed or a data‑drift alert fires, invoke the handler’s explicit invalidation API (e.g., `invalidate_all()` or `invalidate(key)`).  This ensures that the next request will trigger a recompute rather than waiting for the TTL to expire.

* **Monitor invalidation metrics** – Track how often entries are invalidated due to TTL expiry versus explicit events.  A high TTL‑expiry rate may indicate that the configured TTL is too aggressive, while frequent explicit invalidations could signal unstable upstream data.

* **Keep the handler stateless where possible** – Store only lightweight metadata (timestamps, TTL) to make the component easy to serialize or replace in a future distributed cache implementation.

---

### Architectural patterns identified  
* **Handler/Manager decomposition** – `CacheInvalidationHandler` isolates invalidation logic from the broader cache management performed by `ClassificationCacheManager`.  
* **Hybrid invalidation (time‑based + event‑driven)** – Combines deterministic TTL expiration with reactive invalidation signals.

### Design decisions and trade‑offs  
* **TTL vs. freshness** – Choosing a TTL balances latency (fewer LLM calls) against the risk of stale results.  
* **Event‑driven hooks** – Adding explicit invalidation improves responsiveness to model changes but introduces additional coupling to upstream events.  
* **Metadata‑only handler** – By storing only timestamps, the handler stays lightweight, but it relies on the cache to retain that metadata correctly.

### System structure insights  
* The cache subsystem is organized as a **manager** (`ClassificationCacheManager`) that owns a **cache store** (`ClassificationCache`) and two cooperating **handlers** (`CacheHitHandler`, `CacheInvalidationHandler`).  
* Sibling components share the same underlying cache but address different concerns: retrieval (`CacheHitHandler`) vs. freshness (`CacheInvalidationHandler`).  
* Upstream orchestration (`LLMCallCoordinator`) is decoupled from cache details; it only reacts when the handler signals that a recomputation is required.

### Scalability considerations  
* **TTL‑driven expiration** scales well because it requires only a timestamp comparison per lookup—constant‑time work regardless of cache size.  
* **Event‑driven invalidation** can cause spikes in recomputation if a bulk invalidation is issued; throttling or batched invalidations may be needed for large caches.  
* The lightweight metadata model allows the handler to be moved to a distributed cache (e.g., Redis) without major redesign, provided the timestamp fields are persisted alongside the cached value.

### Maintainability assessment  
* The clear separation of concerns makes the codebase easy to navigate: changes to invalidation policy stay within `CacheInvalidationHandler`, while cache storage tweaks remain in `ClassificationCache`.  
* Because the handler does not embed business logic beyond TTL checks, unit testing is straightforward—mock timestamps and verify validity outcomes.  
* The only maintenance risk is **configuration drift**: if TTL values are changed in one part of the system but not reflected in the handler’s defaults, inconsistencies may arise.  Centralizing TTL configuration in `ClassificationCacheManager` mitigates this risk.

## Hierarchy Context

### Parent
- [ClassificationCacheManager](./ClassificationCacheManager.md) -- ClassificationCacheManager uses the ClassificationCache class in classification_cache.py to store and retrieve classification results.

### Siblings
- [LLMCallCoordinator](./LLMCallCoordinator.md) -- LLMCallCoordinator would need to interact with the ClassificationCache class to determine when cache entries are invalid and require an LLM call, potentially using a callback mechanism to trigger the call
- [CacheHitHandler](./CacheHitHandler.md) -- CacheHitHandler would work closely with the ClassificationCache class to retrieve cached results, using a cache key to identify and fetch the relevant entry

---

*Generated from 3 observations*
