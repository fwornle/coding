# ProviderRegistry

**Type:** SubComponent

The ProviderRegistry supports mock mode for testing, allowing for mock providers to be registered and used in place of real providers.

## What It Is  

The **ProviderRegistry** is a sub‑component that lives inside the LLM abstraction layer and is defined in the `lib/llm/llm-service.ts` source file. It is the central catalogue that holds every concrete LLM provider (e.g., Anthropic, OpenAI, Groq) that the system can invoke. Through this registry the higher‑level `LLMAbstraction` component can look up a provider by name, retrieve its metadata, and obtain a ready‑to‑use client instance. The registry also embeds several cross‑cutting concerns: tier‑based routing logic, a mock‑provider plug‑in for test environments, a circuit‑breaker guard to isolate failures, and an in‑memory metadata cache that reduces repeated network calls to the providers.

## Architecture and Design  

The design of **ProviderRegistry** follows a classic **registry pattern**: a map‑like structure that registers provider implementations and exposes lookup methods. Because the registry is part of the `LLMAbstraction` façade, it enables the façade to remain provider‑agnostic while still supporting sophisticated routing decisions. The tier‑based routing capability (observed in the same `llm-service.ts` file) suggests a **strategy‑oriented design** where the registry selects a routing strategy based on the provider’s tier (e.g., free, paid, premium) and the requested model.  

To protect the system from cascading outages, the registry incorporates a **circuit‑breaker pattern** (explicitly mentioned as “CircuitBreakerPattern” in the hierarchy). When a provider repeatedly fails, the circuit breaker trips, short‑circuits further calls, and returns a fallback response, thereby preserving overall stability.  

Testing concerns are addressed through a **mock‑provider implementation**. A separate mock class (likely in `lib/llm/mock-provider.ts`) can be registered in place of a real provider, allowing unit and integration tests to run without external network dependencies.  

Finally, the **ProviderMetadataCache** embedded in the registry implements a simple caching layer. Metadata such as model capabilities, rate limits, or endpoint URLs are fetched once and stored, reducing the number of outbound requests and improving latency.  

All of these patterns coexist within the same module, keeping the provider‑related responsibilities encapsulated while exposing a clean API to sibling components like **ModelCallRouter** (which consumes the tier‑based routing logic) and **LLMModeManager** (which also relies on the same registry for mode‑specific provider selection).

## Implementation Details  

Although the source file does not enumerate concrete symbols, the observations let us infer the key building blocks:

1. **Registry Core** – an internal map (e.g., `Map<string, ProviderInterface>`) that stores provider identifiers together with their instantiated clients. Registration likely occurs at application start‑up, reading configuration that lists available providers and their tiers.  

2. **Tier‑Based Routing** – a function (perhaps `selectProvider(model: string, tier?: string)`) that examines the requested model, checks the provider’s tier metadata (cached in `ProviderMetadataCache`), and returns the most appropriate provider instance. This logic is shared with the sibling **ModelCallRouter**, which may delegate the actual request after the registry has resolved the provider.  

3. **Mock Provider Hook** – a conditional branch that checks an environment flag or a configuration option (e.g., `process.env.LLM_MODE === 'mock'`). When enabled, the registry registers an instance of `MockProviderImplementation` from `lib/llm/mock-provider.ts` under the same identifier(s) used by real providers, allowing the rest of the system to operate transparently.  

4. **Circuit Breaker Integration** – each provider client is wrapped with a circuit‑breaker wrapper (likely an instance of a `CircuitBreakerPattern` class). Calls to the provider pass through `breaker.call(() => provider.invoke(...))`. The breaker tracks failure counts, opens after a threshold, and automatically resets after a cool‑down period.  

5. **Metadata Cache** – a lightweight cache object (`ProviderMetadataCache`) that stores JSON blobs of provider capabilities. The registry populates the cache on first request (`await provider.fetchMetadata()`) and then reads from it on subsequent lookups, avoiding redundant HTTP calls.  

All of these components are instantiated and wired together inside `lib/llm/llm-service.ts`, ensuring that the **ProviderRegistry** is a self‑contained unit ready for consumption by its parent **LLMAbstraction** and its siblings.

## Integration Points  

The **ProviderRegistry** sits at the heart of the LLM abstraction stack. Its primary consumer is the **LLMAbstraction** component, which delegates all provider‑specific operations to the registry. When a client requests a model execution, `LLMAbstraction` asks the registry for the correct provider based on the current routing tier and mode.  

Sibling components also interact with the registry: **ModelCallRouter** relies on the registry’s tier‑based selection to decide which provider to forward a request to, while **LLMModeManager** may query the registry to verify that a provider supports the currently active mode (mock, local, public).  

The registry’s children expose their own interfaces:  
* `ProviderMetadataCache` provides `getMetadata(providerId)` and `refreshMetadata(providerId)` methods.  
* `CircuitBreakerPattern` offers `call(fn)` and status inspection APIs (`isOpen()`).  
* `MockProviderImplementation` implements the same contract as any real provider, ensuring seamless substitution.  

External configuration files (e.g., JSON or environment variables) feed the list of providers, tier assignments, and the mock‑mode flag into the registry during initialization. No other parts of the system need to know about the underlying HTTP endpoints or authentication details; those are encapsulated within each provider implementation registered here.

## Usage Guidelines  

1. **Register Providers Early** – All real and mock providers should be registered during application bootstrap, before any LLM request is made. This guarantees that `LLMAbstraction` and `ModelCallRouter` can resolve a provider instantly.  

2. **Prefer Tier‑Based Selection** – When invoking a model, callers should let the registry decide the provider based on tier and model name rather than hard‑coding a provider ID. This preserves the flexibility to re‑balance traffic or introduce new tiers without code changes.  

3. **Handle Circuit‑Breaker States** – Consumers must be prepared for the circuit breaker to reject calls (e.g., by catching a `CircuitBreakerOpenError`). In such cases, fallback logic—perhaps a lower‑tier provider or a cached response—should be employed.  

4. **Use Mock Mode for Tests** – Enable mock mode through the documented configuration key (e.g., `LLM_MODE=mock`). The registry will automatically swap in `MockProviderImplementation`, allowing unit tests to run deterministically without external network calls.  

5. **Refresh Metadata When Needed** – If a provider’s capabilities change (new models added, rate limits updated), invoke the cache’s `refreshMetadata` method to purge stale entries. The registry will repopulate the cache on the next lookup.  

6. **Avoid Direct Provider Access** – All interactions with a provider should go through the registry. Directly importing a provider class bypasses the circuit breaker and cache, risking inconsistent behavior and making the system harder to maintain.  

---

### 1. Architectural patterns identified  
* **Registry pattern** – central map of provider identifiers to implementations.  
* **Strategy / Tier‑based routing** – selects a provider based on model and tier.  
* **Circuit‑breaker pattern** – isolates failing providers and prevents cascade failures.  
* **Cache pattern** – `ProviderMetadataCache` stores provider metadata to reduce remote calls.  
* **Mock‑provider / Test double pattern** – `MockProviderImplementation` enables safe testing.

### 2. Design decisions and trade‑offs  
* **Centralized vs. distributed lookup** – Centralizing provider lookup simplifies the façade but creates a single point of configuration; however, the cache and circuit breaker mitigate performance and reliability concerns.  
* **Tier‑based routing granularity** – Allows fine‑grained cost control and QoS but adds routing complexity that must be kept in sync with provider tier definitions.  
* **Mock mode integration** – Embedding mock providers in the same registry avoids duplicated code paths, yet developers must ensure the mock faithfully mirrors the real provider’s contract.  
* **Circuit breaker per provider** – Protects the whole system from a single flaky provider, at the cost of additional state management and potential latency when the breaker is open.

### 3. System structure insights  
* **Parent‑child hierarchy** – `LLMAbstraction` (parent) delegates all provider concerns to `ProviderRegistry`. The registry, in turn, composes three child components (`ProviderMetadataCache`, `CircuitBreakerPattern`, `MockProviderImplementation`).  
* **Sibling collaboration** – `ModelCallRouter` and `LLMModeManager` both depend on the registry’s ability to resolve providers, illustrating a shared service model within the LLM abstraction layer.  
* **File‑level cohesion** – All core logic resides in `lib/llm/llm-service.ts`, while test‑specific code is isolated in `lib/llm/mock-provider.ts`, keeping production and test concerns separate.

### 4. Scalability considerations  
* **Cache effectiveness** – By caching provider metadata, the registry scales horizontally; additional instances can share the same cache strategy without overwhelming external provider APIs.  
* **Circuit‑breaker isolation** – As the number of providers grows, each retains its own breaker, preventing a single overloaded provider from throttling the entire system.  
* **Tier‑based routing** – Enables load distribution across providers of different cost tiers, supporting cost‑aware scaling.  
* **Potential bottleneck** – The registry map itself is in‑process; in a distributed deployment, a shared registry service or synchronized configuration store may be required to avoid stale state across nodes.

### 5. Maintainability assessment  
The **ProviderRegistry** consolidates multiple cross‑cutting concerns in a single, well‑named module, which aids discoverability and reduces duplication. The explicit child components (`ProviderMetadataCache`, `CircuitBreakerPattern`, `MockProviderImplementation`) are each responsible for a distinct aspect, promoting separation of concerns and making unit testing straightforward. Because the registry’s public API is the only entry point for provider interaction, changes to underlying provider SDKs can be isolated within the registration logic without impacting callers. The main maintenance risk lies in the complexity of tier‑based routing rules; keeping those rules synchronized with provider capabilities requires disciplined configuration management. Overall, the design balances extensibility (easy addition of new providers or tiers) with robustness (circuit breaker, caching, mock support), resulting in a maintainable core for the LLM abstraction layer.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component is a high-level facade that provides an abstraction layer over various LLM providers, including Anthropic, OpenAI, and Groq. It enables provider-agnostic model calls, tier-based routing, and mock mode for testing. The component is designed to handle different LLM modes, including mock, local, and public, and it uses a registry to manage the available providers. The LLMAbstraction component is implemented in the lib/llm/llm-service.ts file and uses various other modules, such as the provider registry, circuit breaker, and cache, to manage the LLM operations.

### Children
- [ProviderMetadataCache](./ProviderMetadataCache.md) -- The ProviderMetadataCache is likely to be implemented in the lib/llm/llm-service.ts file, where the ProviderRegistry is defined, to manage the available providers
- [CircuitBreakerPattern](./CircuitBreakerPattern.md) -- The CircuitBreakerPattern would be implemented in the lib/llm/llm-service.ts file, where the ProviderRegistry is defined, to detect and prevent cascading failures
- [MockProviderImplementation](./MockProviderImplementation.md) -- The MockProviderImplementation would be defined in a separate file, such as lib/llm/mock-provider.ts, to keep the test code separate from the production code

### Siblings
- [ModelCallRouter](./ModelCallRouter.md) -- The ModelCallRouter uses a tier-based routing strategy, as seen in the lib/llm/llm-service.ts file.
- [LLMModeManager](./LLMModeManager.md) -- The LLMModeManager uses a registry to manage the available modes, as seen in the lib/llm/llm-service.ts file.


---

*Generated from 5 observations*
