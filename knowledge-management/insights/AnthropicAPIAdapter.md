# AnthropicAPIAdapter

**Type:** SubComponent

AnthropicAPIAdapter implements the LLMService interface (lib/llm/llm-service.ts) to provide a unified interface for LLM operations.

## What It Is  

The **AnthropicAPIAdapter** lives in the LLM abstraction layer of the codebase. It is the concrete implementation that talks to the Anthropic cloud API and is located in the same package as the other LLM adapters (e.g., `lib/llm/provider-registry.js` for registration and `lib/llm/llm-service.ts` for the shared service contract). The adapter implements the **LLMService** interface defined in `lib/llm/llm-service.ts`, thereby exposing a standard set of operations—model resolution, completion, and error handling—to the rest of the system. Registration of the adapter is performed by the **ProviderRegistry** class (`lib/llm/provider-registry.js`), which makes the Anthropic provider discoverable at runtime. In the component hierarchy, AnthropicAPIAdapter is a child of **LLMAbstraction**, which orchestrates the selection and use of any registered LLM provider.

## Architecture and Design  

The design follows a **provider‑registry pattern**. The `ProviderRegistry` maintains a map of available LLM providers, each of which must satisfy the **LLMService** contract. By registering AnthropicAPIAdapter with the registry, the system can resolve the appropriate provider dynamically without hard‑coding any Anthropic‑specific logic elsewhere. This decouples the high‑level LLM abstraction from the concrete details of each vendor’s API.

The adapter also embodies the **interface‑implementation pattern**: it implements the `LLMService` interface (`lib/llm/llm-service.ts`). This guarantees that all LLM providers expose the same method signatures (e.g., `resolveModel`, `complete`, `handleError`). Consequently, callers—whether they are the parent `LLMAbstraction` component or sibling adapters such as **MockLLMService** or **DMRProviderIntegration**—can invoke LLM operations uniformly, regardless of the underlying provider.

Error handling is baked into the adapter itself, meaning that any exceptions or API‑level failures are translated into the unified error semantics defined by `LLMService`. This keeps error handling consistent across providers and prevents leakage of provider‑specific error formats into the broader application.

## Implementation Details  

* **Interface conformance** – AnthropicAPIAdapter declares that it implements `LLMService` (found in `lib/llm/llm-service.ts`). The interface defines at least three responsibilities that the adapter fulfills:  
  1. **Model resolution** – The adapter contains logic to map a generic model identifier (e.g., “claude‑v2”) to the concrete model name expected by the Anthropic API. This enables callers to request a model abstractly while the adapter handles provider‑specific naming.  
  2. **Completion request** – A method (conceptually `complete`) builds the request payload, sends it to the Anthropic endpoint, and returns the generated text. The payload includes the resolved model, the prompt, and any other required parameters.  
  3. **Error handling** – The adapter intercepts network or API errors, normalizes them into the error type defined by `LLMService`, and propagates them upward. This ensures that higher‑level components receive a predictable error shape.

* **Registration** – In `lib/llm/provider-registry.js`, the adapter is added to the registry (e.g., `registry.register('anthropic', AnthropicAPIAdapter)`). The registry therefore knows the string key (`'anthropic'`) that maps to this concrete class. When `LLMAbstraction` asks the registry for a provider by name, the registry can instantiate or retrieve the already‑created AnthropicAPIAdapter.

* **Shared contract usage** – Because the adapter and its siblings (`MockLLMService`, `DMRProviderIntegration`) all implement `LLMService`, they share the same method signatures. This uniformity allows `LLMAbstraction` to treat any provider as a black box that can be swapped in or out without changing calling code.

No additional source files were discovered in the observation set, so the concrete method names and internal helper utilities are not listed, but the responsibilities above are directly derived from the observations.

## Integration Points  

1. **ProviderRegistry (`lib/llm/provider-registry.js`)** – The primary integration point. AnthropicAPIAdapter registers itself here, making it discoverable by name. The registry also handles lifecycle concerns such as lazy instantiation or singleton management, though those details are not explicitly observed.  

2. **LLMService Interface (`lib/llm/llm-service.ts`)** – The contract that the adapter implements. All callers, including the parent **LLMAbstraction** component, depend on this interface to invoke LLM operations.  

3. **LLMAbstraction (parent component)** – Consumes the adapter indirectly via the registry. When an application requests a completion, LLMAbstraction asks the registry for the appropriate provider (e.g., `'anthropic'`) and then calls the `complete` method defined by `LLMService`.  

4. **Sibling providers** – **MockLLMService** and **DMRProviderIntegration** share the same registration and interface mechanisms. This commonality means that switching from a mock provider to Anthropic (or vice‑versa) only requires a change in configuration, not code.  

5. **External Anthropic API** – The adapter’s only external dependency is the Anthropic HTTP endpoint. All request/response handling, authentication, and network concerns are encapsulated inside the adapter.

## Usage Guidelines  

* **Register before use** – Ensure that the AnthropicAPIAdapter is registered with `ProviderRegistry` during application startup (typically in a bootstrap module). Failure to register will result in a “provider not found” error when `LLMAbstraction` attempts to resolve the `'anthropic'` key.  

* **Prefer abstract model identifiers** – Callers should request models using the abstract identifiers defined by the system (e.g., “claude‑v2”) rather than hard‑coding Anthropic‑specific model strings. The adapter’s model‑resolution logic will translate these identifiers to the correct API values.  

* **Handle errors at the LLMService level** – Since the adapter normalizes errors, downstream code should catch exceptions thrown by the `LLMService` methods and rely on the standardized error shape. Do not attempt to parse raw Anthropic error payloads; the adapter already does that.  

* **Configuration isolation** – Keep any Anthropic‑specific configuration (API keys, endpoint URLs, timeout settings) within the adapter’s module or a dedicated config file. This keeps the rest of the codebase provider‑agnostic and simplifies swapping providers.  

* **Testing with MockLLMService** – For unit tests, replace the Anthropic provider in the registry with `MockLLMService`. Because both implement `LLMService`, test code can remain unchanged while the underlying provider changes, supporting fast and deterministic test runs.

---

### Architectural patterns identified
* **Provider‑registry pattern** – Centralized registration and lookup of LLM providers.  
* **Interface‑implementation pattern** – `LLMService` defines a contract; AnthropicAPIAdapter (and siblings) implement it.  

### Design decisions and trade‑offs
* **Decoupling via a shared interface** – Improves extensibility (new providers can be added) but requires every provider to conform to the same abstraction, which may limit provider‑specific features.  
* **Runtime registration** – Allows dynamic configuration but introduces a dependency on correct registry initialization order.  

### System structure insights
* The LLM subsystem is organized around a **parent abstraction (LLMAbstraction)** that delegates to concrete providers via a **registry**.  
* All providers, including AnthropicAPIAdapter, are **siblings** under the same contract, promoting interchangeable use.  

### Scalability considerations
* Adding more providers (e.g., additional cloud LLM APIs) scales linearly: simply implement `LLMService` and register.  
* The registry lookup is O(1) keyed by provider name, so provider selection incurs negligible overhead even as the list grows.  

### Maintainability assessment
* Centralizing the contract in `LLMService` makes it easy to evolve the API surface; changes propagate to all providers.  
* Provider‑specific logic (model resolution, error mapping) is isolated inside each adapter, limiting the blast radius of changes.  
* The clear separation between registration (`ProviderRegistry`) and usage (`LLMAbstraction`) encourages clean module boundaries and reduces coupling, supporting long‑term maintainability.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component utilizes the ProviderRegistry class (lib/llm/provider-registry.js) to manage a registry of available LLM providers, enabling dynamic provider registration and initialization. This design decision allows for flexibility and scalability, as new providers can be added or removed without modifying the existing codebase. The LLMService class (lib/llm/llm-service.ts) serves as a unified interface for LLM operations, including completion, initialization, and mode resolution, which helps to abstract away the underlying provider-specific implementation details. For instance, the DMRProvider class (lib/llm/providers/dmr-provider.ts) integrates with Docker Model Runner (DMR) for local LLM inference, supporting per-agent model overrides and health checks.

### Siblings
- [MockLLMService](./MockLLMService.md) -- MockLLMService uses the ProviderRegistry class (lib/llm/provider-registry.js) to register and initialize mock providers.
- [DMRProviderIntegration](./DMRProviderIntegration.md) -- DMRProviderIntegration uses the DMRProvider class (lib/llm/providers/dmr-provider.ts) to integrate with Docker Model Runner (DMR) for local LLM inference.
- [LLMService](./LLMService.md) -- LLMService provides a unified interface for LLM operations, including completion, initialization, and mode resolution.
- [ProviderRegistry](./ProviderRegistry.md) -- ProviderRegistry uses the ProviderRegistry class (lib/llm/provider-registry.js) to manage a registry of available LLM providers.

---

*Generated from 7 observations*
