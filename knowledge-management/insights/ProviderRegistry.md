# ProviderRegistry

**Type:** SubComponent

The ProviderRegistry uses the CircuitBreaker class to prevent cascading failures by detecting when a provider is not responding and preventing further requests, as seen in the CircuitBreaker class (lib/llm/circuit-breaker.ts)

## What It Is  

**ProviderRegistry** is the concrete class that lives in `lib/llm/provider-registry.ts`.  Its sole responsibility is to act as the central catalogue for all Large‑Language‑Model (LLM) providers that the application can use.  The registry knows how to **register**, **un‑register**, and **enumerate** providers, and it exposes a simple API that other parts of the system (most notably `LLMService` in `lib/llm/llm-service.ts`) can call to obtain a ready‑to‑use provider instance.  Because the registry is a child of the broader **LLMAbstraction** component, it is the “source of truth” for provider availability throughout the LLM stack.

---

## Architecture and Design  

The design of **ProviderRegistry** follows a **registry pattern** combined with **dependency‑injection (DI)**.  `LLMService` constructs the registry (or receives it via its constructor) and then injects concrete provider implementations into the registry.  This DI approach, highlighted in the observation that “the ProviderRegistry uses a dependency injection approach to allow for the addition of new providers” (see `lib/llm/llm-service.ts`), decouples the service logic from any specific provider class, making the system highly extensible and test‑friendly.

Resilience is built in through the **CircuitBreaker** collaboration.  The registry does not call providers directly; instead, when a provider is retrieved, the calling code (e.g., `LLMService`) wraps the request with the `CircuitBreaker` class (`lib/llm/circuit-breaker.ts`).  This protects the overall flow from cascading failures when a particular provider becomes unresponsive.  The registry also contributes to performance by **caching** provider metadata or client instances, as noted in the observation that “the ProviderRegistry uses a cache to improve performance and reduce the number of requests made to the providers” (again visible from `LLMService`).  Together, these choices form a **modular, resilient, and performant** subsystem within the LLM abstraction layer.

Interaction with sibling components is straightforward: `LLMController` (also an `EventEmitter` in `lib/llm/llm-service.ts`) receives high‑level commands, forwards them to `LLMService`, which in turn queries the `ProviderRegistry` for the appropriate provider.  The `BudgetTracker` sibling monitors cost but does not interfere with registration logic, keeping concerns cleanly separated.

---

## Implementation Details  

1. **Core API (lib/llm/provider-registry.ts)**  
   - **`register(providerId: string, providerFactory: () => Provider)`** – stores a factory function (or concrete instance) keyed by a unique identifier.  
   - **`unregister(providerId: string)`** – removes the entry, allowing hot‑swap or de‑provisioning of providers.  
   - **`getAvailableProviders(): string[]`** – returns the list of registered IDs, enabling UI or diagnostic components to enumerate options.  
   - **`getProvider(providerId: string): Provider`** – fetches (and possibly caches) the concrete provider instance.  The cache is internal to the registry; subsequent calls for the same ID return the cached object unless it has been invalidated.

2. **Dependency Injection (lib/llm/llm-service.ts)**  
   `LLMService` receives an instance of `ProviderRegistry` in its constructor.  When the service starts, it calls `registry.register(...)` for each built‑in provider (e.g., OpenAI, Anthropic) and also exposes a public method for external modules to add custom providers.  Because the registry holds only factories, the actual provider objects are lazily instantiated, reducing startup overhead.

3. **Caching Strategy**  
   The cache lives inside the registry; it stores the instantiated provider after the first `getProvider` call.  This reduces the number of network‑handshakes or SDK initializations, which is especially valuable when providers require expensive authentication steps.  The cache is cleared when `unregister` is called, ensuring stale instances do not linger.

4. **Error Handling**  
   All registry operations are wrapped in try/catch blocks.  When a registration fails (e.g., the factory throws), `LLMService` captures the exception and surfaces a meaningful error to callers.  Retrieval errors are also caught; if a provider cannot be instantiated, the registry logs the failure and returns `null` (or throws a domain‑specific error), allowing the caller to fall back to another provider or abort gracefully.

5. **CircuitBreaker Integration (lib/llm/circuit-breaker.ts)**  
   While the registry itself does not contain circuit‑breaker logic, its public `getProvider` method is typically used inside a `CircuitBreaker.execute(() => provider.call(...))` pattern.  The breaker tracks failure counts per provider ID; once a threshold is breached, the breaker trips and `LLMService` stops routing requests to that provider until it recovers.

---

## Integration Points  

- **Parent – LLMAbstraction**: The abstraction layer aggregates `ProviderRegistry`, `LLMService`, `LLMController`, `CircuitBreaker`, and `BudgetTracker`.  The registry is the authoritative source for which providers the abstraction can address.  Any new provider added to the system must be registered here before `LLMService` can use it.

- **Sibling – LLMController**: `LLMController` listens for external events (e.g., API requests) and forwards them to `LLMService`.  When a request specifies a particular provider, the service queries the registry to resolve the concrete implementation.

- **Sibling – CircuitBreaker**: The breaker consumes provider identifiers supplied by the registry to maintain per‑provider health state.  This tight coupling ensures that a failing provider is isolated without affecting the registry’s internal state.

- **Sibling – BudgetTracker**: Although not directly coupled, `BudgetTracker` may query the registry to understand which providers are active, allowing it to attribute costs correctly.

- **External Modules**: Third‑party code can extend the LLM stack by importing `ProviderRegistry` from `lib/llm/provider-registry.ts` and invoking `register` with a custom factory.  Because the registry follows DI, no changes to `LLMService` or other core classes are required.

---

## Usage Guidelines  

1. **Register Early, Unregister Sparingly** – Register all built‑in providers during application bootstrap (typically in the `LLMService` constructor).  Unregister only when a provider is permanently deprecated or when you need to replace it with a newer version; doing so clears the internal cache and prevents stale connections.

2. **Prefer Factories Over Direct Instances** – Pass a factory function to `register` rather than a pre‑instantiated provider.  This defers heavy initialization until the first request, keeping start‑up latency low and allowing the cache to manage lifecycle automatically.

3. **Handle Retrieval Errors** – Always wrap `registry.getProvider(id)` calls in try/catch or use the `CircuitBreaker` helper.  Providers may fail to instantiate (missing credentials, network outage), and the registry will surface those errors.

4. **Leverage the Cache** – Do not manually instantiate providers outside the registry; doing so bypasses the cache and defeats the performance optimization.  If you need a fresh instance (e.g., after credential rotation), first `unregister` the old ID and then `register` a new factory.

5. **Observe CircuitBreaker State** – Before sending a request, query the breaker’s health for the target provider.  If the breaker is open, fallback to an alternative provider or return a graceful error to the caller.

6. **Testing** – In unit tests, replace the real `ProviderRegistry` with a mock that registers stub factories.  Because the registry follows DI, the rest of the system (e.g., `LLMService`) can be exercised without contacting external LLM APIs.

---

### Summary of Key Insights  

1. **Architectural patterns identified** – Registry pattern, Dependency Injection, Cache‑as‑a‑service, and resilience via CircuitBreaker.  
2. **Design decisions and trade‑offs** – DI gives flexibility and testability at the cost of added indirection; caching improves latency but introduces cache‑invalidation considerations; circuit‑breaker adds robustness but requires tuning of thresholds.  
3. **System structure insights** – `ProviderRegistry` sits under the `LLMAbstraction` parent, serving as the single source of truth for providers; it collaborates closely with `LLMService`, `LLMController`, `CircuitBreaker`, and `BudgetTracker`, each handling a distinct cross‑cutting concern (service orchestration, event handling, resiliency, and cost tracking).  
4. **Scalability considerations** – Adding new providers is a matter of registering a factory; the cache scales linearly with the number of distinct providers, and the circuit‑breaker isolates failures, allowing the system to continue operating even when many providers are degraded.  
5. **Maintainability assessment** – The clear separation of concerns (registration vs. usage vs. resilience) and the reliance on DI make the registry easy to extend and test.  The primary maintenance burden lies in keeping the cache coherent and ensuring circuit‑breaker thresholds remain appropriate as provider performance characteristics evolve.

## Diagrams

### Relationship

![ProviderRegistry Relationship](images/provider-registry-relationship.png)



## Architecture Diagrams

![relationship](../../.data/knowledge-graph/insights/images/provider-registry-relationship.png)


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component's architecture is designed with dependency injection in mind, as seen in the LLMService class (lib/llm/llm-service.ts), which allows for the incorporation of various trackers and classifiers. This design decision enables a high degree of flexibility and testability, as different components can be easily swapped out or mocked. For instance, the budget tracker and sensitivity classifier can be replaced with mock implementations for testing purposes. The use of dependency injection also facilitates the addition of new providers, as the core service logic remains unchanged. The LLMService class extends EventEmitter, which provides a way to handle initialization, mode resolution, and completion requests in an event-driven manner.

### Siblings
- [LLMController](./LLMController.md) -- The LLMController class extends EventEmitter, which provides a way to handle initialization, mode resolution, and completion requests in an event-driven manner, as seen in the LLMService class (lib/llm/llm-service.ts)
- [CircuitBreaker](./CircuitBreaker.md) -- The CircuitBreaker class is responsible for detecting when a provider is not responding and preventing further requests, as seen in the CircuitBreaker class (lib/llm/circuit-breaker.ts)
- [BudgetTracker](./BudgetTracker.md) -- The BudgetTracker class is responsible for managing the budget and tracking the costs associated with the LLM requests, as seen in the LLMService class (lib/llm/llm-service.ts)


---

*Generated from 7 observations*
