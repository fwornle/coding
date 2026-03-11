# MockLLMService

**Type:** SubComponent

MockLLMService is used in conjunction with the DMRProviderIntegration component to test the integration with Docker Model Runner (DMR) for local LLM inference.

## What It Is  

**MockLLMService** is a concrete implementation of the `LLMService` interface that lives in the *MockLLM* sub‑component of the LLM stack.  The source code that defines the service is registered through the **ProviderRegistry** located at `lib/llm/provider-registry.js`.  By conforming to the contract expressed in `lib/llm/llm-service.ts`, MockLLMService offers the same public methods (completion, initialization, and mode resolution) as any real LLM provider, but it returns deterministic, fabricated data instead of invoking an external model.  This makes the service a first‑class participant in the **LLMAbstraction** component, which aggregates all available providers—real or mock—through the registry.

## Architecture and Design  

The design of MockLLMService revolves around two well‑established architectural ideas that are directly observable in the codebase:

1. **Registry (or Service Locator) Pattern** – The `ProviderRegistry` class (`lib/llm/provider-registry.js`) maintains a map of provider identifiers to concrete provider instances.  MockLLMService registers itself with this registry, allowing the rest of the system to request a “mock” provider by name without hard‑coding any import statements.  This decouples provider discovery from provider usage and enables dynamic addition or removal of providers at runtime.

2. **Interface‑Based Polymorphism (Strategy‑like)** – All LLM providers, including MockLLMService, implement the `LLMService` interface defined in `lib/llm/llm-service.ts`.  By sharing a common contract, the system can swap between real providers (e.g., `DMRProvider` in `lib/llm/providers/dmr-provider.ts`) and the mock implementation without changing the calling code.  The abstraction is leveraged by the parent **LLMAbstraction** component, which treats every registered provider as an interchangeable strategy for completing a request.

These patterns give the overall LLM stack a plug‑in architecture: new providers can be dropped into the `lib/llm/providers/` directory, registered in `ProviderRegistry`, and immediately become usable by any consumer that depends on `LLMService`.

## Implementation Details  

MockLLMService’s core responsibilities are threefold:

* **Completion Mocking** – When the `completion` method (as defined by `LLMService`) is invoked, MockLLMService generates a static or configurable response payload that mimics the shape of a real LLM completion.  The payload includes fields such as `text`, `tokens`, and any metadata required by downstream components.

* **Initialization Mocking** – The `initialize` method pretends to perform any warm‑up or model‑loading steps that a real provider would need.  Instead of loading a model, it simply resolves immediately, optionally logging that the mock provider has been “initialized”.

* **Mode Resolution Mocking** – For calls that query the available modes or capabilities of a provider, MockLLMService returns a hard‑coded list (e.g., `["completion", "chat"]`).  This satisfies the expectations of the **LLMAbstraction** component, which may perform feature checks before routing a request.

The registration flow is straightforward: during application bootstrap, `ProviderRegistry.register('mock', MockLLMService)` is executed (observed in `lib/llm/provider-registry.js`).  The registry then stores the class reference, and any consumer can retrieve it via `ProviderRegistry.get('mock')`.  Because MockLLMService also **uses** the `LLMService` class (the interface definition) it stays in lockstep with any future method additions to the contract.

## Integration Points  

MockLLMService sits at the intersection of several sibling components:

* **DMRProviderIntegration** – This integration test harness invokes the mock service to verify that the Docker Model Runner (DMR) plumbing works correctly without launching an actual container.  By swapping the real `DMRProvider` with MockLLMService, developers can exercise the same code paths (initialization, completion) in a deterministic environment.

* **AnthropicAPIAdapter** – The Anthropic adapter normally forwards requests to the external Anthropic API.  In unit tests, the adapter is pointed at the mock provider, allowing verification of request‑building logic and error handling without incurring network latency or API costs.

* **ProviderRegistry** – As the central registry, it is the sole dependency that both MockLLMService and all other providers share.  The registry’s API (`register`, `get`, `list`) defines the contract for how providers are discovered and instantiated.

* **LLMAbstraction** – This parent component aggregates the registry’s entries and presents a unified façade to the rest of the system.  Because MockLLMService conforms to `LLMService`, LLMAbstraction can treat it exactly like any production provider when performing mode resolution or routing completions.

No additional external services are required for MockLLMService; its only runtime dependency is the in‑process registry.

## Usage Guidelines  

1. **Register Early** – Ensure that MockLLMService is registered with `ProviderRegistry` before any component attempts to resolve a provider.  The typical place is the application’s initialization script or test setup file.

2. **Select via Identifier** – When configuring a test environment, set the provider identifier to `"mock"` (the key used in the registry).  All calls to `ProviderRegistry.get('mock')` will return the mock instance.

3. **Do Not Use in Production** – Because the service returns fabricated data, it should be limited to unit tests, integration tests, and local development scenarios.  Production code should reference a real provider such as `DMRProvider` or an external API adapter.

4. **Extend with Caution** – If additional mock behaviours are needed (e.g., error injection, latency simulation), extend the existing class rather than creating a new provider type.  Maintaining a single mock implementation keeps the registry tidy and reduces the surface area for divergent behaviour.

5. **Stay Synchronized with LLMService** – Any change to the `LLMService` interface (new methods, altered signatures) must be reflected in MockLLMService.  Because the mock is used in many test suites, mismatches will surface quickly as compile‑time or test failures.

---

### Architectural Patterns Identified  
* Registry / Service Locator (via `ProviderRegistry`)  
* Interface‑based polymorphism (implementation of `LLMService`) – a Strategy‑like approach  

### Design Decisions and Trade‑offs  
* **Pluggable Provider Model** – Enables easy addition of new providers but introduces a runtime lookup cost (negligible in this context).  
* **Mock‑First Testing** – Guarantees deterministic tests; however, it requires diligent synchronization with the real provider contract to avoid false positives.  

### System Structure Insights  
The LLM stack is organized around a central abstraction (`LLMAbstraction`) that delegates all provider‑specific work to entries in `ProviderRegistry`.  MockLLMService is a sibling to real providers such as `DMRProvider` and sits one level below the abstraction, providing the same API surface.  

### Scalability Considerations  
Because providers are resolved by name from a simple in‑memory map, the registry scales linearly with the number of providers.  Adding more mock or real providers does not affect request latency; the primary scalability factor is the underlying provider’s performance, not the registry itself.  

### Maintainability Assessment  
The clear separation between the registry, the service interface, and concrete implementations (including the mock) yields high maintainability.  The mock implementation is lightweight, with no external dependencies, making it easy to update alongside the interface.  The only maintenance risk is divergence between the mock and real providers, mitigated by the shared `LLMService` contract and the fact that the mock is exercised in the same test suites as the real adapters.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component utilizes the ProviderRegistry class (lib/llm/provider-registry.js) to manage a registry of available LLM providers, enabling dynamic provider registration and initialization. This design decision allows for flexibility and scalability, as new providers can be added or removed without modifying the existing codebase. The LLMService class (lib/llm/llm-service.ts) serves as a unified interface for LLM operations, including completion, initialization, and mode resolution, which helps to abstract away the underlying provider-specific implementation details. For instance, the DMRProvider class (lib/llm/providers/dmr-provider.ts) integrates with Docker Model Runner (DMR) for local LLM inference, supporting per-agent model overrides and health checks.

### Siblings
- [DMRProviderIntegration](./DMRProviderIntegration.md) -- DMRProviderIntegration uses the DMRProvider class (lib/llm/providers/dmr-provider.ts) to integrate with Docker Model Runner (DMR) for local LLM inference.
- [AnthropicAPIAdapter](./AnthropicAPIAdapter.md) -- AnthropicAPIAdapter uses the Anthropic API to handle model resolution, completion requests, and error handling.
- [LLMService](./LLMService.md) -- LLMService provides a unified interface for LLM operations, including completion, initialization, and mode resolution.
- [ProviderRegistry](./ProviderRegistry.md) -- ProviderRegistry uses the ProviderRegistry class (lib/llm/provider-registry.js) to manage a registry of available LLM providers.


---

*Generated from 7 observations*
