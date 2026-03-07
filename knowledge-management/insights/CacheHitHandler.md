# CacheHitHandler

**Type:** Detail

The handler might implement a caching strategy that prioritizes recently accessed entries, ensuring that frequently used results are retained in the cache for faster access

## What It Is  

`CacheHitHandler` is a dedicated component that lives inside the **ClassificationCacheManager** package (the exact file path is not enumerated in the observations, but it is referenced as a child of `ClassificationCacheManager`). Its sole responsibility is to mediate every request for a cached classification result. It does this by consulting the **ClassificationCache** class—found in `classification_cache.py`—using a deterministic cache‑key that uniquely identifies a classification query. When a request arrives, `CacheHitHandler` looks up the key, returns the stored result if it is still valid, and otherwise signals that a fresh computation (typically an LLM call) is required.

The handler is also charged with enforcing a simple cache‑maintenance policy: it favours recently accessed entries, keeping them resident for faster subsequent reads, and it applies an expiration rule that evicts stale data. In this way, `CacheHitHandler` acts as the “gatekeeper” that ensures the cache remains both performant and semantically correct.

## Architecture and Design  

The observations reveal a **layered caching architecture** in which `ClassificationCacheManager` orchestrates three sibling collaborators:

1. **CacheHitHandler** – reads from the cache and decides whether a hit is usable.  
2. **CacheInvalidationHandler** – tracks validity and removes entries that have become obsolete.  
3. **LLMCallCoordinator** – invokes the large‑language‑model service when a cache miss (or an invalidated entry) occurs.

`CacheHitHandler` therefore occupies the “read‑through” layer of the cache. It does not write directly; instead it relies on the cache‑write responsibilities of the other components (e.g., `CacheInvalidationHandler` may purge, and `LLMCallCoordinator` may populate). This separation of concerns mirrors a **Strategy‑oriented design**: the handler encapsulates the *read* strategy (including recency‑based prioritisation and expiration checks), while the sibling components implement complementary strategies (invalidation, population).

Interaction flow (as inferred from the observations):

* A consumer asks `ClassificationCacheManager` for a classification.  
* `ClassificationCacheManager` forwards the request to `CacheHitHandler`.  
* `CacheHitHandler` builds the cache key, queries `ClassificationCache` (`classification_cache.py`), and evaluates the entry’s freshness based on the expiration policy.  
* If the entry is fresh, the result is returned immediately.  
* If the entry is missing or expired, `CacheHitHandler` signals the need for a recomputation; `LLMCallCoordinator` is then engaged, and once the new result arrives, `CacheInvalidationHandler` (or the manager itself) writes it back into `ClassificationCache`.

No explicit design patterns beyond this implicit **Strategy/Responsibility‑Segregation** are mentioned, and we avoid inventing patterns such as micro‑services or event‑driven pipelines because they are not present in the source observations.

## Implementation Details  

The core mechanics of `CacheHitHandler` revolve around three logical steps:

1. **Cache‑Key Generation** – The handler derives a deterministic identifier from the classification request (e.g., a hash of the input text and model version). This key is the primary lookup token used with `ClassificationCache`.  
2. **Recency‑Based Prioritisation** – While the observations do not enumerate a concrete data structure, the wording “prioritizes recently accessed entries” implies that `ClassificationCache` likely maintains metadata such as a last‑access timestamp or an LRU counter. `CacheHitHandler` reads this metadata to decide whether an entry should be considered a strong candidate for a hit.  
3. **Expiration Policy Enforcement** – Each cached entry carries a time‑to‑live (TTL) or a version tag. `CacheHitHandler` checks the stored timestamp against the current time; if the entry exceeds its TTL, it is treated as stale and excluded from the hit path. The handler may also invoke `CacheInvalidationHandler` to physically remove the stale entry, though the exact hand‑off is not detailed.

Because no concrete code symbols were discovered, the implementation is inferred to be lightweight: a class (likely named `CacheHitHandler`) with a public method such as `handle(request)` that returns either a cached result or a miss indicator. Internally it would call `ClassificationCache.get(key)` and evaluate the returned object’s metadata.

## Integration Points  

`CacheHitHandler` sits at the intersection of three major system modules:

* **ClassificationCache** (`classification_cache.py`) – The storage backend that actually holds the serialized classification results. All reads performed by `CacheHitHandler` go through this class’s `get` method.  
* **ClassificationCacheManager** – The parent orchestrator that owns an instance of `CacheHitHandler`. The manager routes incoming classification queries to the handler and interprets the handler’s outcome (hit vs. miss).  
* **CacheInvalidationHandler** – A sibling that may be invoked when `CacheHitHandler` determines an entry is expired. The invalidation component is responsible for safely deleting or marking the entry as unusable.  
* **LLMCallCoordinator** – Another sibling that is triggered when `CacheHitHandler` reports a miss. The coordinator performs the expensive LLM inference and eventually writes the fresh result back into `ClassificationCache`.

These integration points are all mediated through well‑defined method calls (e.g., `CacheHitHandler.check(key)`, `CacheInvalidationHandler.evict(key)`, `LLMCallCoordinator.fetch(request)`). No external services or databases are referenced, indicating that the cache lives entirely in‑process.

## Usage Guidelines  

1. **Never bypass `CacheHitHandler`** when you need a classification result. All reads should be funneled through `ClassificationCacheManager`, which delegates to the handler. Direct access to `ClassificationCache` risks inconsistency with the expiration and recency policies.  
2. **Respect the cache‑key contract** – When constructing a request that will be processed by the manager, ensure that the input fields that contribute to the cache key (e.g., raw text, model identifier, feature flags) remain stable. Changing any of these without updating the key will lead to unnecessary cache misses.  
3. **Do not manually mutate cache metadata**. The recency counters and timestamps are managed internally by `CacheHitHandler` (and the underlying `ClassificationCache`). Altering them can break the prioritisation logic and cause stale data to be served.  
4. **When extending the cache strategy**, keep the separation of concerns clear: any new eviction logic belongs in `CacheInvalidationHandler`, while any new read‑side heuristics belong in `CacheHitHandler`. This preserves the maintainable division of responsibilities observed in the current design.  
5. **Testing** – Unit tests for `CacheHitHandler` should mock `ClassificationCache` to verify that a fresh entry is returned when the TTL has not elapsed, and that a miss is correctly signalled when the entry is expired. Integration tests should involve the full manager flow to ensure that `LLMCallCoordinator` is invoked only on genuine misses.

---

### 1. Architectural patterns identified  
* **Strategy / Responsibility Segregation** – distinct components (`CacheHitHandler`, `CacheInvalidationHandler`, `LLMCallCoordinator`) each own a specific caching concern (read, invalidate, populate).  
* **Layered caching** – a read‑through layer (`CacheHitHandler`) sits above a storage layer (`ClassificationCache`).

### 2. Design decisions and trade‑offs  
* **Recency‑first prioritisation** improves latency for hot queries but may increase churn for long‑tail requests.  
* **TTL‑based expiration** guarantees freshness at the cost of occasional recomputation; the trade‑off is predictable memory usage versus stale data risk.  
* **Separate invalidation handler** isolates removal logic, making it easier to evolve eviction policies without touching read logic.

### 3. System structure insights  
* `ClassificationCacheManager` is the parent orchestrator, containing the three sibling handlers.  
* All cache interactions funnel through `ClassificationCache` located in `classification_cache.py`.  
* The sibling handlers collaborate implicitly: a miss from `CacheHitHandler` triggers `LLMCallCoordinator`; an expired entry may cause `CacheInvalidationHandler` to clean up.

### 4. Scalability considerations  
* Because the cache lives in‑process, scalability is bounded by the host process’s memory. The recency‑based strategy (likely LRU) helps keep the most valuable entries in memory, supporting high read throughput for popular queries.  
* If the classification workload grows beyond a single node’s capacity, the current design would need to be extended with a distributed cache layer; however, such an extension is not present in the existing observations.

### 5. Maintainability assessment  
* The clear separation of read, invalidation, and population responsibilities yields high maintainability: each class can be modified, tested, and replaced independently.  
* Absence of tightly coupled logic (e.g., no direct writes from `CacheHitHandler`) reduces the risk of side‑effects.  
* The reliance on simple TTL and recency heuristics keeps the implementation straightforward, lowering the learning curve for new developers.


## Hierarchy Context

### Parent
- [ClassificationCacheManager](./ClassificationCacheManager.md) -- ClassificationCacheManager uses the ClassificationCache class in classification_cache.py to store and retrieve classification results.

### Siblings
- [CacheInvalidationHandler](./CacheInvalidationHandler.md) -- CacheInvalidationHandler would likely utilize the ClassificationCache class in classification_cache.py to store and retrieve classification results, implementing a mechanism to track cache validity
- [LLMCallCoordinator](./LLMCallCoordinator.md) -- LLMCallCoordinator would need to interact with the ClassificationCache class to determine when cache entries are invalid and require an LLM call, potentially using a callback mechanism to trigger the call


---

*Generated from 3 observations*
