# CacheManager

**Type:** SubComponent

The implementation of caching in CacheManager demonstrates a thoughtful approach to managing the complexity of LLM operations in the DockerizedServices component.

## What It Is  

CacheManager is a **sub‑component** that lives in the *LLM* domain of the code base. Its concrete implementation resides in two files under the `lib/llm` directory:

* `lib/llm/cache-manager.ts` – defines the `CacheManager` class and contains the core caching logic.  
* `lib/llm/llm-service.ts` – provides the `LLMService` class that CacheManager calls into for both caching and circuit‑breaking capabilities.

The purpose of CacheManager is to **store frequently accessed data in memory**, thereby cutting the round‑trip latency for subsequent LLM‑related requests. It does not implement caching from scratch; instead it **leverages the caching mechanism already present in `LLMService`** and also taps the circuit‑breaker feature that `LLMService` exposes. CacheManager is a child of the higher‑level **DockerizedServices** component, which treats it as the dedicated cache layer for all LLM operations.

---

## Architecture and Design  

The observations reveal a **facade‑oriented architecture**: `LLMService` acts as a high‑level façade that centralises three cross‑cutting concerns—*mode routing*, *caching*, and *circuit breaking*—for every LLM request. CacheManager is a thin, purpose‑specific wrapper that delegates to this façade rather than re‑implementing the concerns itself.  

Two classic design patterns surface from the code‑level description:

1. **Facade Pattern** – `LLMService` (in `lib/llm/llm-service.ts`) presents a simplified interface for complex LLM operations, hiding the internal details of routing, caching, and resilience. CacheManager consumes this façade, keeping its own responsibilities narrow.  

2. **Decorator/Wrapper Pattern** – Although not a full‑blown decorator class, CacheManager **wraps** the caching and circuit‑breaking capabilities of `LLMService`. By calling into `LLMService` for these concerns, CacheManager adds a layer of indirection that can be swapped or extended without touching the underlying service logic.

Interaction flow (as inferred from the observations): a consumer (e.g., one of the sibling services such as `SemanticAnalysisService`) asks CacheManager for data. CacheManager forwards the request to `LLMService`, which checks its in‑memory cache; if the entry is present, it returns it instantly. If the cache miss occurs, `LLMService` may invoke the underlying LLM model, store the result in the cache, and return it. Simultaneously, `LLMService`’s circuit‑breaker monitors health signals and can short‑circuit calls to a failing downstream LLM endpoint, protecting the rest of the system.

---

## Implementation Details  

The **core class** is `CacheManager` in `lib/llm/cache-manager.ts`. While the observation set does not enumerate individual methods, we can infer that it at least exposes:

* A **lookup** operation that checks whether a requested datum is already cached.  
* A **store** operation that writes fresh results back into the cache.  
* Possibly **invalidate** or **clear** utilities to manage cache lifecycle.

All of these operations are **implemented by delegating to `LLMService`** (found in `lib/llm/llm-service.ts`). `LLMService` itself contains the actual in‑memory data structures (e.g., a `Map` or LRU cache) and the logic for **circuit breaking**—monitoring error rates, opening the circuit, and providing fallback behaviour. CacheManager therefore does not maintain its own cache store; it acts as a **coordinator** that ensures the higher‑level service’s policies are honoured.

Because CacheManager is situated inside the DockerizedServices component, it benefits from the **Docker container boundaries** that encapsulate the entire LLM stack. This means that the in‑memory cache lives only for the lifetime of the container, providing fast access while also resetting on container restart—an implicit trade‑off between cache warm‑up time and simplicity of deployment.

---

## Integration Points  

CacheManager’s primary **dependency** is `LLMService` (`lib/llm/llm-service.ts`). It calls into this façade for both caching and circuit‑breaking, making `LLMService` the single point of integration for any LLM‑related data flow.  

The **parent component**, DockerizedServices, orchestrates the lifecycle of CacheManager alongside other sub‑components. DockerizedServices likely creates a singleton instance of CacheManager (or injects it via a DI container) so that all sibling services share the same cache view.

All **sibling services**—`SemanticAnalysisService`, `ConstraintMonitoringService`, `CodeGraphAnalysisService`, and `ModeRouter`—also depend on `LLMService`. Consequently, they indirectly share the same cache and circuit‑breaker state that CacheManager manipulates. This shared usage guarantees **consistent caching semantics** across the entire LLM domain, preventing duplicate caches and reducing memory pressure.

From an interface standpoint, CacheManager probably exposes methods such as `get(key)`, `set(key, value)`, and `clear()`. These are called by the sibling services when they need to retrieve or store LLM results. The integration is therefore **tight but purposeful**: CacheManager does not expose any unrelated APIs, keeping its contract focused on cache‑centric operations.

---

## Usage Guidelines  

1. **Prefer the CacheManager façade** over direct calls to `LLMService` for any operation that benefits from caching. This ensures that the circuit‑breaker logic is automatically applied and that cache consistency is maintained across all services.  

2. **Treat CacheManager as a shared singleton** within the DockerizedServices container. Do not instantiate multiple CacheManager objects; doing so would fragment the in‑memory cache and defeat the design’s intention of a single source of truth for cached LLM data.  

3. **Respect the cache lifecycle**: when deploying new versions of the LLM model or updating configuration, consider clearing the cache (via CacheManager’s invalidate/clear method) to avoid serving stale results.  

4. **Handle circuit‑breaker states gracefully**. When CacheManager reports that a request was short‑circuited (e.g., by throwing a specific error type from `LLMService`), callers should fall back to a safe default or retry after a back‑off period, as the underlying LLM endpoint may be temporarily unhealthy.  

5. **Avoid storing large binary blobs** in the CacheManager. Since the cache lives in memory within a Docker container, excessive memory usage can lead to OOM kills. Use size‑limiting strategies (e.g., LRU eviction) if the underlying `LLMService` supports them, or keep large payloads in an external store.  

---

### Architectural Patterns Identified  
* Facade (LLMService as a unified interface)  
* Wrapper/Decorator (CacheManager delegating to LLMService)  

### Design Decisions and Trade‑offs  
* **Centralising caching and circuit breaking** in LLMService simplifies the system but introduces tight coupling between CacheManager and LLMService.  
* **In‑memory cache** yields low latency but limits scalability to the memory available in a single Docker container.  
* **Circuit‑breaker integration** improves resilience at the cost of added complexity in error handling for callers.  

### System Structure Insights  
CacheManager is a child of DockerizedServices and a peer to other LLM‑aware services. All siblings converge on the same `LLMService` façade, creating a **shared cross‑cutting concern layer** (caching + resilience) that is orchestrated by DockerizedServices.  

### Scalability Considerations  
* The in‑memory cache scales linearly with container memory; horizontal scaling (multiple containers) would require a distributed cache if cross‑instance sharing is needed.  
* Circuit‑breaker thresholds can be tuned per deployment to balance false positives vs. protection.  

### Maintainability Assessment  
* **High maintainability** for caching logic because it resides in a single place (`LLMService`).  
* **Moderate risk** of ripple effects: changes to `LLMService`’s caching or circuit‑breaker policies automatically affect CacheManager and all sibling services, so thorough regression testing is required when modifying those mechanisms.  
* Clear separation of concerns (CacheManager as a thin wrapper) keeps the codebase readable and makes future extensions (e.g., adding a persistent cache layer) straightforward.


## Hierarchy Context

### Parent
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes the LLMService (lib/llm/llm-service.ts) as a high-level facade for all LLM operations. This design decision allows for a centralized management of mode routing, caching, and circuit breaking. For instance, the LLMService class in lib/llm/llm-service.ts handles the routing of LLM requests to different modes, such as training or inference, based on the input parameters. The caching mechanism in LLMService also ensures that frequently accessed data is stored in memory, reducing the latency of subsequent requests. Furthermore, the circuit breaking feature in LLMService prevents cascading failures by detecting and preventing requests to faulty services. The implementation of these features in LLMService demonstrates a thoughtful approach to managing the complexity of LLM operations in the DockerizedServices component.

### Siblings
- [SemanticAnalysisService](./SemanticAnalysisService.md) -- SemanticAnalysisService leverages the LLMService class in lib/llm/llm-service.ts to route semantic analysis requests to different modes, such as training or inference, based on input parameters.
- [ConstraintMonitoringService](./ConstraintMonitoringService.md) -- ConstraintMonitoringService leverages the LLMService class in lib/llm/llm-service.ts to route constraint monitoring requests to different modes, such as training or inference, based on input parameters.
- [CodeGraphAnalysisService](./CodeGraphAnalysisService.md) -- CodeGraphAnalysisService leverages the LLMService class in lib/llm/llm-service.ts to route code graph analysis requests to different modes, such as training or inference, based on input parameters.
- [ModeRouter](./ModeRouter.md) -- ModeRouter utilizes the lib/llm/llm-service.ts file to handle the routing of LLM requests to different modes.


---

*Generated from 7 observations*
