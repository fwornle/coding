# ModeResolver

**Type:** SubComponent

ModeResolver likely uses a decision-making process, possibly implemented in a function like determineMode(), to select the appropriate LLM mode.

## What It Is  

**ModeResolver** is a sub‑component that lives inside the **LLMAbstraction** layer. Although the exact source file is not listed, the observations make it clear that the resolver is tightly coupled with the unified LLM façade located at `lib/llm/llm‑service.ts`. Its primary responsibility is to decide which *LLM mode* (e.g., “standard”, “high‑accuracy”, “low‑cost”, etc.) should be used for a given request. The decision is driven by a combination of static configuration (files or a database), runtime context such as the sensitivity of the incoming payload, and possibly budget constraints. Errors that arise during this decision‑making—such as missing agent identifiers or malformed configuration—are caught and reported by the resolver itself.

---

## Architecture and Design  

The design of **ModeResolver** follows a **decision‑router** pattern: a thin, purpose‑built class that receives a request, gathers the necessary inputs, runs a deterministic algorithm (suggested by a function like `determineMode()`), and returns the chosen mode to the caller. This router does **not** implement the LLM calls directly; instead, it hands the selected mode to the **LLMService** (`lib/llm/llm‑service.ts`), which is the single public entry point for all LLM operations.  

Because the resolver must consult external data (configuration files or a database) and may need to evaluate the sensitivity of the input, it collaborates with two sibling components:  

* **SensitivityClassifier** – provides a classification of the request’s data sensitivity, which the resolver incorporates into its mode‑selection logic.  
* **CachingMechanism** – supplies a cache store (likely a `CacheStore` class) that the resolver uses to remember recent mode‑lookup results, reducing repeated configuration reads.  

The presence of error handling for “invalid agent IDs or configuration issues” indicates that the resolver is defensive: it validates inputs before delegating to downstream services. The overall architecture therefore consists of a **chain of responsibility** where ModeResolver is the first link, followed by LLMService (which itself incorporates circuit‑breaking via `lib/llm/circuit‑breaker.js`), and finally the concrete LLM provider managed by **LLMProviderManager**.

---

## Implementation Details  

1. **Decision Function – `determineMode()`**  
   The core of the resolver is presumed to be a method named `determineMode()`. This method likely receives a request context (agent ID, payload, budget hints) and executes a series of conditional checks:  
   * Look up static configuration (file or DB) keyed by agent ID.  
   * Query **SensitivityClassifier** to obtain a sensitivity score or label.  
   * Optionally consult **BudgetTracker** (a sibling) to ensure the chosen mode stays within cost limits.  

2. **Configuration Access**  
   Observations note that the resolver “may consult configuration files or databases.” The implementation probably abstracts this behind a small helper (e.g., `ConfigProvider`) that reads JSON/YAML files or runs a lightweight DB query. The result is cached for fast reuse.

3. **Caching Integration**  
   The resolver “possibly employs a caching mechanism” and “could leverage the CachingMechanism component.” A typical flow would be:  
   * Generate a cache key from the request’s salient attributes (agent ID + sensitivity).  
   * Check `CacheStore` for an existing mode entry.  
   * If a hit occurs, return the cached mode; otherwise, compute via `determineMode()` and write the result back to the cache.  

4. **Error Handling**  
   The resolver “may handle errors and exceptions related to mode determination.” This likely manifests as try/catch blocks around configuration reads and classifier calls, converting low‑level exceptions into domain‑specific errors (e.g., `ModeResolutionError`) that the calling **LLMService** can surface to callers or trigger fallback logic.

5. **Interaction with LLMService**  
   Once a mode is resolved, the resolver hands the result to `lib/llm/llm‑service.ts`. That service then routes the request to the appropriate provider via **LLMProviderManager**, applying any circuit‑breaker logic defined in `lib/llm/circuit‑breaker.js`. This separation keeps mode logic independent of provider specifics.

---

## Integration Points  

* **Parent – LLMAbstraction**: ModeResolver is a child of LLMAbstraction, meaning it is invoked whenever the abstraction layer needs to decide how to talk to an LLM. The parent delegates mode‑selection to the resolver before passing control to LLMService.  

* **Sibling – SensitivityClassifier**: The resolver calls into SensitivityClassifier to obtain a sensitivity label. This interaction is likely a simple method call (e.g., `classify(payload)`) that returns a enum or confidence score.  

* **Sibling – CachingMechanism**: ModeResolver uses the cache store exposed by CachingMechanism. The cache may be a shared in‑memory store or a distributed cache (Redis, etc.), but the resolver only needs the `get(key)` and `set(key, value, ttl)` APIs.  

* **Sibling – BudgetTracker** (indirect): While not explicitly mentioned, the resolver could query BudgetTracker to respect cost caps when choosing a mode.  

* **Sibling – LLMProviderManager**: After the mode is chosen, LLMService forwards the request to LLMProviderManager, which selects the concrete provider (OpenAI, Anthropic, etc.) based on the mode.  

* **External – Configuration Store**: The resolver reads static configuration, which may be located in a `config/` directory or a small relational/NoSQL store. The exact path isn’t given, but the resolver abstracts the source behind a provider interface.

---

## Usage Guidelines  

1. **Do not bypass the resolver** – All code that needs to invoke an LLM should call through the LLMAbstraction façade. Directly selecting a mode elsewhere defeats the centralised decision logic and can cause inconsistency.  

2. **Provide a valid agent identifier** – The resolver expects an identifier that maps to configuration entries. Supplying an unknown or malformed ID will trigger a `ModeResolutionError`.  

3. **Ensure payloads are classified** – If a new sensitivity category is introduced, update the **SensitivityClassifier** accordingly; otherwise the resolver may fall back to a default (potentially unsafe) mode.  

4. **Leverage caching** – For high‑throughput scenarios, rely on the built‑in caching. Avoid manually caching mode results outside the resolver, as this can lead to stale or conflicting entries.  

5. **Handle resolution errors gracefully** – Callers should catch `ModeResolutionError` and decide whether to retry with a fallback mode, abort the request, or surface a user‑friendly message.  

6. **Respect configuration changes** – When configuration files or DB entries are updated, the cache TTL should be short enough to pick up changes promptly, or an explicit cache invalidation call should be made via the CachingMechanism API.

---

### Architectural Patterns Identified  

* **Decision‑Router / Strategy Selector** – ModeResolver isolates the “which mode” decision from execution.  
* **Cache‑Aside** – The resolver checks the cache first, computes on miss, then writes back.  
* **Defensive Programming** – Explicit validation and error translation for configuration and input issues.  
* **Chain of Responsibility** – Resolver → LLMService → LLMProviderManager, each handling a distinct concern.

### Design Decisions and Trade‑offs  

* **Centralised Mode Logic** – Improves consistency but creates a single point of failure; mitigated by caching and error handling.  
* **External Configuration** – Allows runtime changes without code redeploy, at the cost of added I/O and the need for cache invalidation.  
* **Sensitivity‑Aware Routing** – Enhances security/compliance, but introduces coupling to the SensitivityClassifier and may increase latency for classification.  

### System Structure Insights  

* The system is layered: **LLMAbstraction** (high‑level façade) → **ModeResolver** (decision layer) → **LLMService** (routing & resilience) → **LLMProviderManager** (provider specifics).  
* Sibling components each own an orthogonal concern (caching, budgeting, sensitivity), enabling focused responsibilities and easier testing.  

### Scalability Considerations  

* **CachingMechanism** reduces repeated configuration reads, allowing the resolver to scale horizontally under heavy load.  
* The resolver’s logic is stateless aside from the cache, so multiple instances can run behind a load balancer.  
* If configuration resides in a database, read‑replica scaling or moving to a distributed key‑value store would be advisable.  

### Maintainability Assessment  

* The clear separation of concerns (mode decision, caching, sensitivity classification, provider routing) promotes maintainability.  
* Because the resolver’s core algorithm (`determineMode()`) is likely encapsulated in a single method, updates to routing rules are localized.  
* However, heavy reliance on external configuration means that schema changes must be coordinated across the resolver, CachingMechanism, and any admin tools that edit the config files. Proper documentation of the config schema mitigates this risk.  

---  

*All statements above are directly grounded in the supplied observations and the documented hierarchy of components.*

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes the LLMService class (lib/llm/llm-service.ts) as its single public entry point for all LLM operations, which handles mode routing, caching, and circuit breaking. This design decision enables a unified interface for interacting with various LLM providers, promoting flexibility and maintainability. For instance, the LLMService class employs the CircuitBreaker class (lib/llm/circuit-breaker.js) to prevent cascading failures by detecting when a service is not responding and preventing further requests until it becomes available again. This is particularly useful in preventing service overload and ensuring the overall reliability of the system.

### Siblings
- [LLMProviderManager](./LLMProviderManager.md) -- LLMProviderManager utilizes the LLMService class in lib/llm/llm-service.ts to handle provider interactions.
- [CachingMechanism](./CachingMechanism.md) -- CachingMechanism likely uses a cache storage system, possibly implemented in a class like CacheStore, to store cached responses.
- [BudgetTracker](./BudgetTracker.md) -- BudgetTracker likely uses a budgeting system, possibly implemented in a class like BudgetManager, to track and manage costs.
- [SensitivityClassifier](./SensitivityClassifier.md) -- SensitivityClassifier likely uses a classification system, possibly implemented in a class like Classifier, to classify input data sensitivity.

---

*Generated from 7 observations*
