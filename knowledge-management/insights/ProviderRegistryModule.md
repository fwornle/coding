# ProviderRegistryModule

**Type:** SubComponent

The ProviderRegistryModule uses a factory pattern in lib/llm/provider-registry-module.ts to create instances of different LLM providers, such as the DMRProviderModule and MockServiceModule.

## What It Is  

The **ProviderRegistryModule** lives in the *lib/llm* package of the code‑base. Its core files are  

* `lib/llm/provider-registry-module.ts` – the entry point that wires the module together.  
* `lib/llm/provider-registry.ts` – the in‑memory catalogue of all available LLM providers.  
* `lib/llm/provider-factory.ts` (exposed through the child **ProviderFactory**) – the factory that knows how to instantiate each concrete provider such as `DMRProviderModule` (`lib/llm/dmr-provider-module.ts`) and `MockServiceModule` (`integrations/mcp‑server‑semantic‑analysis/src/mock/llm‑mock‑service.ts`).  
* Supporting cross‑cutting concerns are implemented in `lib/llm/provider-cache.ts`, `lib/llm/provider-fallback.ts`, `lib/llm/provider-circuit-breaker.ts`, and `lib/llm/provider-logger.ts`.  

Together these files give the LLM abstraction layer a pluggable, resilient way to select and use a concrete language‑model provider. The module is a direct child of **LLMAbstraction** and is consumed by the higher‑level façade **LLMService** (`lib/llm/llm-service.ts`), which itself is a sibling of the concrete provider modules (MockServiceModule, DMRProviderModule, LLMServiceModule).

---

## Architecture and Design  

The ProviderRegistryModule follows a **modular, plug‑in architecture** built around several well‑known design patterns:

| Pattern | Where it appears | Purpose |
|---------|------------------|---------|
| **Factory** | `lib/llm/provider-registry-module.ts` (via **ProviderFactory**) | Centralises creation of concrete provider instances (e.g., `DMRProviderModule`, `MockServiceModule`). This isolates construction logic from the rest of the system and makes adding a new provider a matter of extending the factory. |
| **Dependency Injection (DI)** | `lib/llm/llm-service.ts` (injects the current provider) | Allows the LLM façade to obtain the appropriate provider at runtime without hard‑coding a concrete class. The DI hook resolves the provider based on the mode returned by a function such as `getLLMMode` (found in the mock service). |
| **Registry** | `lib/llm/provider-registry.ts` | Holds a map of provider identifiers to their factory descriptors. The registry is the single source of truth for “what is available”, enabling dynamic addition/removal of providers without touching the consumer code. |
| **Cache** | `lib/llm/provider-cache.ts` | Stores the result of expensive provider‑initialisation steps (e.g., establishing Docker API connections for DMR). Subsequent requests reuse the cached instance, reducing latency and load. |
| **Fallback** | `lib/llm/provider-fallback.ts` | Provides a graceful degradation path when the preferred provider cannot be resolved (e.g., network outage). The fallback typically selects an alternative provider from the registry or a lightweight mock. |
| **Circuit Breaker** | `lib/llm/provider-circuit-breaker.ts` | Monitors provider health and temporarily disables a failing provider to prevent cascading failures across the LLM pipeline. |
| **Logging/Auditing** | `lib/llm/provider-logger.ts` | Emits structured events for registration, initialization, and error conditions, supporting observability and debugging. |

Interaction flow (simplified): **LLMService** asks the DI container for a provider; the container consults **ProviderRegistry** → **ProviderFactory** → creates (or fetches from **ProviderCache**) an instance; if creation fails, **ProviderFallback** selects an alternative; all steps are wrapped by **ProviderCircuitBreaker** and logged via **ProviderLogger**.

---

## Implementation Details  

### Registry (`lib/llm/provider-registry.ts`)  
The registry is a plain TypeScript object (or `Map`) keyed by a provider name (e.g., `"dmr"`, `"mock"`). Each entry contains metadata such as the factory function, health check hooks, and optional priority for fallback ordering. The module exposes `registerProvider(name, descriptor)` and `unregisterProvider(name)` APIs, enabling runtime extensibility.

### Factory (`lib/llm/provider-registry-module.ts` → **ProviderFactory**)  
The factory reads the descriptor from the registry and invokes the concrete constructor. For the DMR provider, it calls `new DMRProviderModule(dockerClient, config)`. For the mock provider, it creates an instance of the mock service defined in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`. The factory also respects configuration flags (e.g., a global “useMock” switch) passed down from **LLMService**.

### Caching (`lib/llm/provider-cache.ts`)  
A singleton cache stores provider instances keyed by the same identifier used in the registry. The cache implements a lazy‑initialisation pattern: the first request for a provider triggers factory creation; subsequent requests return the cached instance. Cache eviction policies are not described in the observations, so the current implementation likely retains the instance for the lifetime of the process.

### Fallback (`lib/llm/provider-fallback.ts`)  
When the factory throws or the circuit breaker reports an open state, the fallback module walks the registry in priority order and attempts to instantiate the next viable provider. If none are healthy, it may fall back to the `MockServiceModule` as a last‑resort, ensuring the system never completely blocks LLM calls.

### Circuit Breaker (`lib/llm/provider-circuit-breaker.ts`)  
A per‑provider circuit breaker tracks consecutive failures and opens after a configurable threshold. While open, any request to that provider short‑circuits to the fallback path. The breaker also implements a cooldown timer after which it attempts a “half‑open” probe to see if the provider has recovered.

### Logging (`lib/llm/provider-logger.ts`)  
All registration (`registerProvider`), initialization (`factory.create`), cache hits/misses, fallback decisions, and circuit‑breaker state changes are emitted through a logger abstraction (likely a wrapper around `console` or a structured logging library). This gives operators visibility into provider health and configuration drift.

### Dependency Injection (`lib/llm/llm-service.ts`)  
`LLMService` receives a resolver function (e.g., `getLLMMode`) that decides which provider name to request. This resolver can incorporate global configuration, per‑agent overrides, or legacy mock flags, as illustrated by the mock service’s `getLLMMode` implementation. The DI container then hands the resolved name to the ProviderRegistryModule, which returns the ready‑to‑use provider instance.

---

## Integration Points  

1. **Parent – LLMAbstraction**  
   The ProviderRegistryModule is a child component of **LLMAbstraction**. The abstraction layer treats the registry as the source of truth for “available LLM back‑ends”. Any higher‑level orchestration (budget checks, sensitivity filters) performed by LLMAbstraction ultimately delegates to the concrete provider returned by the registry.

2. **Sibling – MockServiceModule & DMRProviderModule**  
   Both sibling modules expose concrete implementations that the factory can instantiate. They share the same registration API (`ProviderRegistry.registerProvider`) and therefore are interchangeable from the perspective of **LLMService**. The mock module is primarily used for testing or as a fallback, while the DMR module talks to a Docker‑based model runner.

3. **Sibling – LLMServiceModule**  
   The LLM service façade (`lib/llm/llm-service.ts`) relies on the registry for provider resolution. It also injects the resolver function that decides the active mode, making the service agnostic of which concrete provider is active at any moment.

4. **Child – ProviderFactory**  
   All creation logic is encapsulated in the **ProviderFactory**. It is the only piece that knows the concrete constructor signatures of the providers, keeping the rest of the system decoupled from provider‑specific details.

5. **External Consumers**  
   Any component that needs to issue LLM calls (e.g., semantic‑analysis pipelines) imports `LLMService` and therefore indirectly uses the ProviderRegistryModule. The contract exposed to callers is a simple `generate(prompt, options)` method on the provider interface; the underlying provider could be a real model runner, a mock, or any future addition.

---

## Usage Guidelines  

* **Register Early, Unregister Sparingly** – Providers should be registered during application bootstrap (e.g., in `main.ts`). Removing a provider at runtime is supported but may cause in‑flight requests to fail if the provider is currently cached.  

* **Prefer Configuration‑Driven Mode Selection** – Use the `getLLMMode` resolver pattern demonstrated in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`. Centralising mode logic ensures that fallback and circuit‑breaker behaviours are consistently applied.  

* **Leverage the Cache** – The caching layer is transparent; however, if a provider’s internal state must be refreshed (e.g., after a Docker container restart), explicitly clear the cache via `ProviderCache.clear(name)` before the next request.  

* **Monitor Circuit‑Breaker Metrics** – The circuit‑breaker emits logs through `ProviderLogger`. Production operators should watch for “open” events and be prepared to adjust thresholds or investigate provider health.  

* **Add New Providers via the Registry** – To introduce a new LLM back‑end, implement a module that conforms to the provider interface, add a factory entry in `ProviderFactory`, and register it with `ProviderRegistry.registerProvider`. No changes to `LLMService` or other consumers are required.  

* **Testing with MockServiceModule** – For unit tests, register only the mock provider and configure the resolver to always return `"mock"`. This guarantees deterministic responses and isolates tests from external services.  

---

### Architectural patterns identified  

1. Factory pattern (ProviderFactory)  
2. Dependency Injection (LLMService resolves providers)  
3. Registry pattern (ProviderRegistry)  
4. Caching (ProviderCache)  
5. Fallback strategy (ProviderFallback)  
6. Circuit Breaker (ProviderCircuitBreaker)  
7. Logging/Auditing (ProviderLogger)

### Design decisions and trade‑offs  

* **Pluggability vs. Complexity** – The registry + factory combo gives high extensibility at the cost of additional indirection and the need to maintain consistent provider descriptors.  
* **Resilience vs. Latency** – Circuit breaker and fallback improve system robustness but may introduce extra hops when a provider is unhealthy.  
* **Cache Lifetime** – Keeping provider instances for the process lifetime reduces start‑up cost but can hold onto stale connections if the underlying service restarts; explicit cache invalidation is required.  

### System structure insights  

The ProviderRegistryModule sits at the heart of the LLM abstraction, acting as a mediator between the high‑level **LLMService** façade and concrete provider implementations. Its child **ProviderFactory** encapsulates construction details, while sibling modules supply the actual provider logic. The module’s cross‑cutting concerns (cache, fallback, circuit breaker, logging) are each isolated in dedicated files, promoting single‑responsibility and easier testing.

### Scalability considerations  

* **Horizontal Scaling** – Because provider instances are cached per‑process, scaling the application horizontally (multiple Node processes) will create independent caches, which is safe but may increase overall resource usage (e.g., multiple Docker containers for DMR).  
* **Provider Load‑Balancing** – The current design selects a single provider per request; extending the registry to return a pool of providers could enable load‑balancing without altering the consumer façade.  
* **Circuit‑Breaker Granularity** – The per‑provider breaker prevents a single failing back‑end from affecting all traffic, supporting graceful degradation as the system scales.

### Maintainability assessment  

The separation of concerns (registry, factory, cache, fallback, circuit breaker, logger) makes the codebase approachable: each file has a narrow focus, and changes to one concern rarely ripple to others. The reliance on explicit registration and DI reduces hidden couplings, aiding onboarding and future extensions. The main maintenance burden lies in keeping provider descriptors synchronized with actual implementations and ensuring that cache eviction/refresh policies evolve alongside provider lifecycle changes. Overall, the architecture is **highly maintainable**, provided that new providers adhere to the established registration and factory contracts.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes a high-level facade, LLMService, which is defined in the file lib/llm/llm-service.ts. This facade is responsible for handling mode routing, caching, circuit breaking, budget/sensitivity checks, and provider fallback. The LLMService class employs dependency injection to set functions that resolve the current LLM mode, allowing for flexibility in determining the mode. For instance, the getLLMMode function in integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts is used to determine the LLM mode for a specific agent, considering global mode, per-agent overrides, and legacy mock flags.

### Children
- [ProviderFactory](./ProviderFactory.md) -- The ProviderRegistryModule uses a factory pattern to create instances of different LLM providers, such as the DMRProviderModule and MockServiceModule, as indicated by the parent context.

### Siblings
- [MockServiceModule](./MockServiceModule.md) -- The MockServiceModule uses a mocking library to generate mock LLM responses, as seen in integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts.
- [DMRProviderModule](./DMRProviderModule.md) -- The DMRProviderModule uses a Docker API client to interact with the Model Runner, as seen in lib/llm/dmr-provider-module.ts.
- [LLMServiceModule](./LLMServiceModule.md) -- The LLMServiceModule uses a dependency injection mechanism to resolve the current LLM provider, as seen in lib/llm/llm-service.ts.


---

*Generated from 7 observations*
