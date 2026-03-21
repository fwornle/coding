# MockLLM

**Type:** SubComponent

The MockLLMProvider class returns pre-defined mock responses for common LLM requests, such as text classification and language translation

## What It Is  

**MockLLM** is the mock‑implementation of the LLM Provider contract that lives inside the **LLMAbstraction** component. Its source code is located in `lib/llm/providers/mock-llm-provider.ts` and it draws its behaviour from configuration files placed under `config/mock-llm`. The class `MockLLMProvider` implements the same `Provider` interface used by the real LLM providers (e.g., `AnthropicProvider` and `DMRProvider`). Instead of invoking an external model, it returns a set of pre‑defined responses for typical LLM operations such as text classification or language translation. The mock provider also contains a lightweight, in‑memory cache to avoid recomputing identical responses during a test run.  

MockLLM is purpose‑built for the test suite: it supplies deterministic, fast responses to the higher‑level `LLMService` (found in `lib/llm/llm-service.ts`) and is registered alongside the other providers via the `ProviderRegistry` (`lib/llm/provider-registry.js`). Because it follows the same interface as production providers, any component that depends on the LLM abstraction—most notably `LLMService`—can be exercised without external network calls or heavyweight model containers.

---

## Architecture and Design  

The overall architecture of the LLM subsystem is **modular provider‑based**. The parent component **LLMAbstraction** defines a `Provider` interface that each concrete provider implements. `MockLLMProvider` is one such implementation, sitting alongside siblings such as `LocalLLM` (which runs Docker‑based models) and the public providers (`AnthropicProvider`, `DMRProvider`).  

* **Provider Pattern** – Each LLM flavour is encapsulated behind a common contract, enabling the `ProviderRegistry` to treat them uniformly. `MockLLMProvider` adheres to this contract, allowing it to be swapped in for any other provider without code changes elsewhere.  

* **Facade (LLMService)** – `LLMService` acts as a high‑level façade that orchestrates routing, caching, and circuit‑breaking. When a test invokes `LLMService`, the service queries the `ProviderRegistry` for an appropriate provider; the registry can return the mock provider when the test environment is configured accordingly.  

* **Registry** – `ProviderRegistry` (`lib/llm/provider-registry.js`) maintains a list of available providers. Because the mock provider registers itself in the same registry, the rest of the system does not need to know whether it is dealing with a real or a mock implementation.  

* **Configuration‑Driven Behaviour** – Mock responses are defined in the `config/mock-llm` directory. This externalizes the data that drives the mock, keeping the provider code simple and making it easy to add or modify scenarios without recompiling.  

* **In‑Memory Cache** – Inside `MockLLMProvider` a simple in‑process cache stores previously generated mock responses. The cache is consulted before looking up the configuration, reducing duplicate work and keeping test execution fast.  

The design is deliberately lightweight, favouring **testability** and **determinism** over runtime performance or scalability, which aligns with its role as a testing sub‑component.

---

## Implementation Details  

### Core Class – `MockLLMProvider` (`lib/llm/providers/mock-llm-provider.ts`)  
* **Implements** the shared `Provider` interface, guaranteeing the same method signatures as the real providers.  
* **Response Retrieval** – When a request arrives (e.g., `classifyText`, `translate`), the provider first checks its in‑memory cache. If a cached entry exists, it returns that value immediately.  
* **Configuration Lookup** – If the cache misses, the provider loads the appropriate mock payload from the `config/mock-llm` directory. The configuration files are typically JSON or YAML files keyed by request type and optional parameters, allowing the same provider to serve many scenarios.  
* **Caching Strategy** – After loading a response from the config, the provider stores it in the in‑memory map keyed by a deterministic hash of the request payload. This “cache‑aside” pattern ensures that repeated identical calls within a test suite are served instantly.  

### Extensibility  
The provider is written to be **easily extensible**: adding a new mock scenario only requires placing a new entry in the configuration folder and, if necessary, augmenting the request‑handling logic with a new case statement. Because the class already implements the generic `Provider` contract, any new method added to the interface can be stubbed out with additional mock data without touching the surrounding infrastructure.

### Interaction with the Registry and Service  
During application boot (or test setup), `MockLLMProvider` registers itself with `ProviderRegistry`. The registry maintains an ordered list of providers; `LLMService` queries the registry to resolve the appropriate provider for a given mode (e.g., `"mock"`). Once resolved, `LLMService` forwards the request, and the mock provider returns its deterministic result.  

### Testing Integration  
The test suite injects the mock provider by configuring the `ProviderRegistry` to prioritize the mock implementation. This allows downstream components such as `LLMService` and any consumer of `LLMAbstraction` to be exercised in isolation from external LLM APIs. The mock works seamlessly with other testing tools (e.g., Jest, Sinon) because it behaves like any other class instance and can be spied on or stubbed further if needed.

---

## Integration Points  

1. **LLMService (`lib/llm/llm-service.ts`)** – The primary consumer of `MockLLMProvider`. `LLMService` delegates request handling to the provider resolved by `ProviderRegistry`.  
2. **ProviderRegistry (`lib/llm/provider-registry.js`)** – Holds the collection of all providers, including the mock. Registration of `MockLLMProvider` occurs here, enabling dynamic selection based on runtime configuration or test flags.  
3. **LLMAbstraction (parent component)** – Defines the `Provider` interface and aggregates the various providers. `MockLLM` is a child of this abstraction, sharing the same contract as its siblings (`LocalLLM`, `AnthropicProvider`, etc.).  
4. **Configuration Files (`config/mock-llm/…`)** – External data source that drives the mock responses. Developers can edit or extend these files to model new LLM behaviours without touching code.  
5. **Testing Frameworks & Mocking Libraries** – The mock provider is designed to be used alongside tools like Jest or Sinon. Because it returns plain objects and maintains an in‑memory cache, test code can reset the cache between test cases or replace the configuration directory with a fixture set.  

No other runtime dependencies are required; the provider is self‑contained apart from reading its configuration files and the shared `Provider` type.

---

## Usage Guidelines  

* **Select the Mock Provider via the Registry** – In test setup, ensure that `ProviderRegistry` is configured to include `MockLLMProvider` and that it is selected for the mode under test (commonly a `"mock"` flag). This guarantees that calls to `LLMService` will be routed to the mock implementation.  

* **Define Deterministic Responses** – Place JSON/YAML files in `config/mock-llm` that map request signatures to expected responses. Keep the keys stable (e.g., request type + serialized payload) so the cache can correctly deduplicate calls.  

* **Leverage the In‑Memory Cache** – The cache is per‑process; it speeds up repeated calls within a single test run. If a test needs a fresh response (e.g., to verify state changes), clear the cache by calling the provider’s `clearCache()` method (if exposed) or by re‑instantiating the provider.  

* **Extend for New Scenarios** – To add a new mock scenario, create a new entry in the configuration folder and, if the request type is novel, add a handling branch in `MockLLMProvider`. Because the class implements the shared `Provider` interface, the rest of the system will automatically pick up the new behaviour.  

* **Avoid Production Usage** – `MockLLMProvider` is intentionally lightweight and lacks the robustness required for production workloads (no circuit breaking, no external latency simulation). It should be confined to unit and integration tests.  

* **Combine with Other Testing Tools** – The mock provider can be spied on to assert that certain calls were made, or its configuration directory can be swapped out per test suite to isolate test data.  

---

### Summary of Architectural Insights  

| Item | Detail |
|------|--------|
| **Architectural patterns identified** | Provider pattern (common `Provider` interface), Facade (`LLMService`), Registry (`ProviderRegistry`), Configuration‑driven behaviour, Simple in‑memory cache (cache‑aside). |
| **Design decisions and trade‑offs** | *Deterministic mock responses* → fast, reliable tests but limited realism; *In‑memory cache* → speed vs. possible stale data; *External config* → easy updates vs. potential config drift; *Extensibility* → low code churn vs. responsibility to keep mock aligned with real provider semantics. |
| **System structure insights** | `MockLLMProvider` sits under `LLMAbstraction` alongside real providers; it registers with `ProviderRegistry`, which is queried by the `LLMService` façade. This mirrors the production flow, ensuring test code exercises the same pathways. |
| **Scalability considerations** | Designed for unit‑test scale; the in‑memory cache works only within a single process. Adding many mock scenarios scales linearly with config size; no network or compute bottlenecks are introduced. |
| **Maintainability assessment** | High maintainability: clear separation of concerns, small code footprint, and configuration‑driven responses. The main maintenance burden is keeping mock data synchronized with evolving real‑provider contracts, but the shared `Provider` interface mitigates accidental divergence. |

By adhering to these guidelines and understanding the underlying design, developers can confidently employ **MockLLM** to validate LLM‑dependent components while preserving the modular, provider‑centric architecture of the broader LLM subsystem.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes a modular design, with each provider having its own implementation, such as the AnthropicProvider (lib/llm/providers/anthropic-provider.ts) and the DMRProvider (lib/llm/providers/dmr-provider.ts). This design allows for easy addition or removal of providers, making the system more flexible and scalable. The LLMService (lib/llm/llm-service.ts) acts as a high-level facade, handling mode routing, caching, and circuit breaking, which helps to decouple the provider implementations from the rest of the system. For example, the LLMService uses the ProviderRegistry (lib/llm/provider-registry.js) to manage a chain of LLM providers, including local and public providers, with support for subscription-based providers.

### Siblings
- [LocalLLM](./LocalLLM.md) -- LocalLLM uses the DockerModelRunner class in lib/llm/docker-model-runner.ts to run local LLM models
- [LLMService](./LLMService.md) -- LLMService uses the ProviderRegistry in lib/llm/provider-registry.js to manage a chain of LLM providers
- [ProviderRegistry](./ProviderRegistry.md) -- ProviderRegistry uses a registry data structure to store a list of available LLM providers

---

*Generated from 7 observations*
