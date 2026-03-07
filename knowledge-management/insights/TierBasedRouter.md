# TierBasedRouter

**Type:** SubComponent

The LLMService class injects the budget tracker into the TierBasedRouter, enabling the component to track and manage budgets effectively

## What It Is  

**TierBasedRouter** is a sub‑component that lives inside the **LLMAbstraction** hierarchy.  The concrete implementation can be found in the files that power the routing layer of the LLM service stack:

* `lib/llm/llm-service.ts` – hosts the `LLMService` class and the `routeRequest` function that embodies the tier‑based routing logic.  
* `lib/llm/provider‑registry.js` – maintains the catalogue of concrete LLM providers that the router can dispatch to.

The router’s responsibility is to examine each incoming completion request, determine the appropriate *tier* (e.g., free, paid, premium) and then forward the request to the correct provider.  It does so while coordinating with the **BudgetTracker** (to enforce spending limits) and the **CachingMechanism** (to avoid redundant calls).  The component is deliberately modular, making it straightforward to plug in new providers, tiers, or routing heuristics.

---

## Architecture and Design  

The observations reveal a **modular, dependency‑injected architecture**.  At the top level, **LLMAbstraction** acts as a façade that aggregates several sub‑components (TierBasedRouter, CachingMechanism, BudgetTracker, SensitivityClassifier).  Within this ecosystem:

* **Facade Pattern** – `LLMService` in `lib/llm/llm-service.ts` serves as the high‑level entry point for all LLM operations, shielding callers from the details of provider selection and budget handling.  
* **Registry Pattern** – `provider‑registry.js` is a classic registry that stores the available LLM providers and exposes lookup capabilities to the router.  
* **Dependency Injection (DI)** – The router’s `routeRequest` function receives injected collaborators (budget tracker, caching layer, possibly a sensitivity classifier).  This DI point is explicitly mentioned in observation 6, allowing the routing logic to be swapped or extended without touching the core function.  
* **Strategy‑like Routing** – Although not named, the fact that `routeRequest` “takes into account the request’s tier and other factors” and can be customized via DI suggests a strategy‑style separation of the decision algorithm from the routing executor.

The design emphasizes **extensibility** (new providers can be added to the registry), **customizability** (routing behavior can be altered by providing alternative DI objects), and **separation of concerns** (budget tracking, caching, and sensitivity classification live in sibling components).

---

## Implementation Details  

1. **LLMService (`lib/llm/llm-service.ts`)** – This class is the primary consumer of the router.  It injects the **BudgetTracker** (observation 4) and calls `routeRequest` for each completion request.  The class also likely exposes higher‑level methods such as `generateCompletion` that hide the routing mechanics from callers.  

2. **routeRequest Function** – Implemented in the same file, `routeRequest` is the heart of TierBasedRouter.  It receives a request object, extracts the *tier* field, and evaluates additional criteria (e.g., budget availability, sensitivity flags).  Based on this evaluation it selects a provider from the **provider‑registry** and forwards the request.  Because the function uses DI (observation 6), callers can supply alternative decision modules, making the routing algorithm replaceable at runtime.  

3. **Provider Registry (`lib/llm/provider‑registry.js`)** – This module maintains a map of provider identifiers to concrete provider instances (e.g., OpenAI, Anthropic).  TierBasedRouter queries the registry to resolve the provider that matches the tier determined by `routeRequest`.  The registry’s modular nature means new providers can be registered without modifying the router’s core code.  

4. **Budget Tracker Integration** – The **BudgetTracker** sub‑component also uses `LLMService` (observation 4) to monitor spend per tier.  The router receives the tracker via DI, enabling it to abort or downgrade a request when the budget is exhausted.  

5. **Caching Mechanism Collaboration** – TierBasedRouter works with **CachingMechanism** (observation 7) to cache results of expensive completions.  The router can check the cache before invoking a provider, and store successful responses after a provider call, reducing latency and cost.  

All of these pieces are wired together through constructor‑style or setter‑style injection, ensuring that the router remains agnostic of concrete implementations while still having access to the necessary services.

---

## Integration Points  

* **Parent – LLMAbstraction** – TierBasedRouter is a child of LLMAbstraction, which orchestrates the overall LLM workflow.  The parent component relies on the router to decide *where* a request should be sent, while it may also coordinate higher‑level concerns such as request validation and response aggregation.  

* **Sibling – BudgetTracker** – The router receives an instance of BudgetTracker via DI.  This enables real‑time budget checks and updates as part of the routing decision.  The BudgetTracker itself also consumes `LLMService`, forming a bidirectional relationship that keeps budget state consistent across the system.  

* **Sibling – SensitivityClassifier** – Although not directly mentioned as a collaborator of the router, the classifier also uses `LLMService`.  In practice, the router could be extended (through DI) to factor sensitivity scores into its tier decision, illustrating the shared dependency on the same service façade.  

* **Sibling – CachingMechanism** – The router queries the cache before contacting a provider and writes back successful completions.  This tight coupling improves performance without altering the provider‑selection logic.  

* **External – Provider Registry** – All provider instances are sourced from `provider‑registry.js`.  Adding, removing, or updating a provider is a matter of editing the registry, after which the router automatically gains visibility of the new options.  

The integration model is deliberately **loose**: each component communicates through well‑defined interfaces (e.g., a `trackBudget` method on the tracker, a `getProvider(tier)` call on the registry), making substitution and testing straightforward.

---

## Usage Guidelines  

1. **Inject Dependencies Explicitly** – When constructing or configuring TierBasedRouter (or the higher‑level `LLMService` that uses it), always provide concrete instances of the BudgetTracker, CachingMechanism, and any custom routing strategies.  This ensures the router can enforce budgets and leverage caching.  

2. **Register Providers Before Routing** – Populate `provider‑registry.js` with all supported LLM providers during application startup.  Each provider should be associated with the tier(s) it serves; the router will rely on this mapping to make decisions.  

3. **Prefer Tier‑Based Requests** – Callers should include a `tier` attribute in the request payload.  The router’s `routeRequest` function expects this field to decide the appropriate provider.  Omitting the tier may result in default routing or an error, depending on the implementation.  

4. **Leverage Caching for Repeated Prompts** – When the same prompt is likely to be issued multiple times, ensure the CachingMechanism is active.  The router will automatically check the cache, reducing latency and cost.  

5. **Monitor Budget Alerts** – Because the router aborts or de‑grades requests when the BudgetTracker signals exhaustion, developers should expose budget‑exhaustion events to the UI or monitoring layer.  This avoids surprise failures and lets operators adjust limits or tier allocations.  

6. **Extend Routing Logic via DI** – If a new routing criterion (e.g., geographic latency, user‑level SLA) is required, implement a custom decision module and inject it into `routeRequest`.  The existing DI hook makes this extension painless without modifying core router code.  

---

### Architectural Patterns Identified  

1. **Facade (LLMService)** – Provides a unified API for LLM operations.  
2. **Registry (provider‑registry.js)** – Central catalogue of LLM providers.  
3. **Dependency Injection** – Used for budget tracker, caching, and routing strategy customization.  
4. **Modular Architecture** – Separate, interchangeable sub‑components (router, cache, tracker, classifier).  

### Design Decisions and Trade‑offs  

* **Modularity vs. Complexity** – By splitting responsibilities (routing, budgeting, caching), the system is easier to extend but introduces more moving parts that must be wired correctly.  
* **DI for Extensibility** – Allows swapping of routing logic or trackers without code changes, at the cost of requiring explicit configuration and potential runtime errors if dependencies are missing.  
* **Provider Registry Centralization** – Simplifies provider management but creates a single point of failure; the registry must be kept in sync with actual provider capabilities.  
* **Tier‑Based Routing** – Guarantees that requests respect business tiers, yet adds decision‑making overhead on each request.  

### System Structure Insights  

The overall LLM stack follows a **layered composition**: the top‑level **LLMAbstraction** aggregates sub‑components; `LLMService` acts as the façade; TierBasedRouter implements the routing layer; sibling components (BudgetTracker, CachingMechanism, SensitivityClassifier) provide orthogonal cross‑cutting concerns.  This hierarchy promotes clear separation of concerns and enables independent evolution of each layer.

### Scalability Considerations  

* **Horizontal Scaling of Providers** – Since providers are resolved via the registry, additional provider instances (e.g., more OpenAI nodes) can be added without touching routing code.  
* **Cache Sharding** – The CachingMechanism can be scaled out (e.g., distributed cache) to handle higher request volumes, reducing load on downstream providers.  
* **Budget Partitioning** – BudgetTracker can be partitioned per tenant or tier, allowing the router to make decisions at scale without a global bottleneck.  
* **Routing Performance** – The DI‑based `routeRequest` adds minimal overhead; however, heavy custom strategies should be profiled to ensure they do not become a latency hotspot.  

### Maintainability Assessment  

The component scores high on maintainability due to:

* **Clear Separation** – Routing, budgeting, and caching are isolated, making unit testing straightforward.  
* **DI‑Driven Extensibility** – New strategies or trackers can be introduced without modifying existing files, reducing regression risk.  
* **Explicit Registry** – Adding or retiring providers is a single‑file change, limiting the surface area for bugs.  

Potential maintenance challenges include:

* **Configuration Drift** – If the provider registry and tier definitions become out‑of‑sync, routing errors may arise.  
* **Dependency Wiring** – Incorrect DI setup can cause runtime failures; developers need robust startup validation.  

Overall, the design choices reflected in the observations create a flexible, extensible router that integrates cleanly with its parent abstraction and sibling services while remaining approachable for future enhancements.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes a modular architecture, as seen in the lib/llm/llm-service.ts file, where the LLMService class acts as a high-level facade for all LLM operations. This allows for easy extension and customization of the component. The use of dependency injection for various trackers and classifiers, such as the budget tracker and sensitivity classifier, enables customization and extensibility. For instance, the budget tracker is injected into the LLMService class, enabling the component to track and manage budgets effectively. The lib/llm/provider-registry.js file, which manages different LLM providers, further demonstrates the component's modular design.

### Siblings
- [CachingMechanism](./CachingMechanism.md) -- CachingMechanism uses a cache store to store the results of expensive computations, reducing the need for redundant calculations
- [BudgetTracker](./BudgetTracker.md) -- BudgetTracker uses the LLMService class in lib/llm/llm-service.ts to track and manage budgets
- [SensitivityClassifier](./SensitivityClassifier.md) -- SensitivityClassifier uses the LLMService class in lib/llm/llm-service.ts to classify the sensitivity of each request


---

*Generated from 7 observations*
