# MockService

**Type:** SubComponent

The modular architecture of LLMAbstraction enables the easy addition of new LLM providers, including MockService, as evidenced by the provider registry in lib/llm/provider-registry.js.

## What It Is  

MockService is the **mock implementation of the LLM (large‑language‑model) provider** used throughout the LLMAbstraction component. Its source lives in `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` (referred to in the parent‑component description) and is also mentioned directly in the observation *“MockService uses the llm‑mock‑service.ts file to simulate LLM responses for testing and development purposes.”* The class exported from this file is registered in the provider registry located at `lib/llm/provider-registry.js`, allowing the rest of the system to treat it as just another LLM provider.  

At runtime, developers can swap the real LLM providers (e.g., Anthropic, OpenAI) for MockService without changing any consumer code. The high‑level façade that orchestrates this selection is the `LLMService` class defined in `lib/llm/llm-service.ts`. Because MockService implements the same interface expected by `LLMService`, it participates in the same mode‑routing, caching, and circuit‑breaking logic that the real providers use.

In short, MockService is a **sub‑component** that provides deterministic, controllable LLM responses for unit‑ and integration‑testing, while being fully integrated into the modular LLM abstraction layer.

---

## Architecture and Design  

The observations point to a **modular, provider‑based architecture**. The key structural elements are:

1. **Facade (LLMService)** – `lib/llm/llm-service.ts` acts as a high‑level façade that hides the details of individual providers. It centralises concerns such as *mode routing* (selecting a provider based on configuration), *caching* of responses, and *circuit breaking* to protect the system from flaky providers. Both real providers and MockService are invoked through this façade, guaranteeing a uniform API surface.

2. **Provider Registry** – The file `lib/llm/provider-registry.js` implements a **registry pattern**. It maintains a map of provider identifiers to concrete provider classes. The observation *“The provider registry … enables the easy registration of new LLM providers, including MockService”* confirms that adding a new provider is a matter of registering it in this central place. This design decouples provider implementations from the façade and from each other.

3. **Strategy‑like Provider Implementations** – Each concrete provider (e.g., `anthropic-provider.ts`, the mock provider in `llm‑mock‑service.ts`) follows a common contract expected by `LLMService`. While the term *Strategy* is not explicitly used, the behaviour mirrors that pattern: the façade delegates to a selected strategy object at runtime.

4. **Cross‑cutting Concerns in Providers** – MockService *“handles mode routing, caching, and circuit breaking, similar to the LLMService class.”* This indicates that the provider itself may contain logic for these concerns, or that the façade forwards calls that trigger the same mechanisms. The duplication suggests a design decision to keep providers self‑contained, allowing them to be used outside the façade if needed (e.g., direct testing).

The overall interaction flow is:

```
Consumer → LLMService (facade) → Provider Registry → Selected Provider (MockService or real)
```

Because the registry is a simple JavaScript module, registration happens at import time, keeping the system lightweight and avoiding runtime discovery overhead.

---

## Implementation Details  

### Core Files  

| Path | Primary Role |
|------|--------------|
| `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` | Implements `MockService`, a class that returns pre‑programmed or deterministic responses mimicking an LLM. |
| `lib/llm/llm-service.ts` | Defines `LLMService`, the façade that exposes methods such as `generate`, `chat`, etc., and incorporates mode routing, caching, and circuit‑breaking logic. |
| `lib/llm/provider-registry.js` | Holds a registry object (likely a plain map) where each provider is registered under a key (e.g., `"mock"`, `"anthropic"`). |

### MockService Mechanics  

* **Mode Routing** – MockService can be selected when the system is run in a “mock” or “test” mode. The same routing logic present in `LLMService` evaluates the current mode and asks the registry for the provider keyed for that mode.  

* **Caching** – Although the mock does not need external latency mitigation, it still participates in the caching layer. Calls to the mock may be cached based on request payload, ensuring repeatable responses during a test run.  

* **Circuit Breaking** – The mock implements a lightweight circuit‑breaker that can be toggled to simulate failure scenarios. This mirrors the production behaviour of real providers, enabling developers to verify fallback logic.

### Provider Registration  

Inside `provider-registry.js` a typical registration looks like:

```js
const registry = new Map();
registry.set('mock', require('../integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service').MockService);
registry.set('anthropic', require('./providers/anthropic-provider').AnthropicProvider);
module.exports = registry;
```

When `LLMService` boots, it imports this registry and selects the appropriate class based on configuration. Because the registry is a plain module, adding a new provider only requires a one‑line `set` call.

### Shared Concerns  

Both `LLMService` and `MockService` contain similar logic for *mode routing, caching, and circuit breaking*. This redundancy is intentional: it allows the mock to be used **stand‑alone** (e.g., in isolated unit tests that bypass the façade) while still behaving like a fully‑featured provider when accessed through the façade.

---

## Integration Points  

1. **LLMAbstraction (Parent)** – MockService is a child of the `LLMAbstraction` component. The parent component’s description emphasises modularity, and MockService exemplifies that by being a pluggable provider.

2. **LLMService (Sibling)** – The sibling `LLMService` uses the same provider registry and shares the same cross‑cutting concerns. Both rely on `provider-registry.js` for discovery, which means any change to the registry impacts both the façade and the mock.

3. **DMRService (Sibling)** – While DMRService provides local inference via Docker, it does not directly interact with MockService. However, both are alternative ways to obtain LLM‑like responses, and the existence of both highlights the system’s flexibility in swapping between local, remote, and mock providers.

4. **Consumers** – Any higher‑level component that needs LLM capabilities calls into `LLMService`. When the configuration selects the `"mock"` provider, `LLMService` resolves the mock from the registry and forwards the request. This keeps consumer code unchanged regardless of the underlying provider.

5. **Testing Harnesses** – Test suites import `llm-mock-service.ts` directly to seed deterministic responses, or they configure the system to run in mock mode, causing `LLMService` to automatically route all calls to MockService.

---

## Usage Guidelines  

* **Selecting the Mock Provider** – Set the LLM mode (often via an environment variable or config file) to `"mock"` before starting the application. The façade will then resolve `MockService` from the registry automatically.  

* **Extending Mock Responses** – If additional deterministic behaviours are needed, edit `llm-mock-service.ts`. Because the mock follows the same interface as real providers, new methods (e.g., `streamChat`) can be added without touching `LLMService`.  

* **Avoid Direct Instantiation in Production Code** – Always obtain the provider through `LLMService` or the registry. Directly constructing `new MockService()` bypasses mode routing, caching, and circuit‑breaking logic and can lead to inconsistent behaviour between test and production environments.  

* **Circuit‑Breaker Testing** – Use the mock’s built‑in circuit‑breaker toggles to simulate provider outages. This allows verification of fallback paths without requiring a real provider to fail.  

* **Cache Management** – When testing caching behaviour, be aware that the mock also participates in the cache layer. Clear the cache between tests if deterministic fresh responses are required.  

---

### Architectural Patterns Identified  

| Pattern | Evidence |
|---------|----------|
| Facade (`LLMService`) | “LLMService class … serves as a high‑level façade for all LLM operations.” |
| Registry (`provider-registry.js`) | “Provider registry … enables the easy registration of new LLM providers.” |
| Strategy‑like Provider Interface | Providers (including MockService) are interchangeable under the same contract. |
| Cross‑cutting Concern Encapsulation (caching, circuit‑breaking) | Both `LLMService` and `MockService` handle mode routing, caching, circuit breaking. |

### Design Decisions and Trade‑offs  

* **Explicit Registry vs. Dynamic Discovery** – Using a static JavaScript registry makes provider lookup fast and simple, at the cost of requiring manual registration for each new provider. This trade‑off favours clarity and predictability in a testing‑heavy codebase.  

* **Duplication of Cross‑cutting Logic** – Replicating caching and circuit‑breaking in the mock provider keeps the mock usable outside the façade, but introduces maintenance overhead. Any change to these mechanisms must be mirrored in both places.  

* **Modular Provider Separation** – By isolating each provider (real or mock) in its own file, the system gains high maintainability and easy extensibility, as evidenced by the ease of adding new providers to the registry.

### System Structure Insights  

* The **LLMAbstraction** component is a thin orchestration layer that aggregates multiple provider implementations via a common registry.  
* **MockService** lives under the same namespace as production providers, reinforcing a “plug‑and‑play” model.  
* Sibling services (`DMRService`, `LLMService`) share the same architectural philosophy of modularity, but each focuses on a distinct delivery mechanism (Docker inference, façade, mock).  

### Scalability Considerations  

* **Provider Count** – Adding many providers only grows the size of the registry map, which remains O(1) lookup, so scalability is not a concern.  
* **Caching Layer** – Because MockService participates in the same caching infrastructure, cache size and eviction policies must be sized for the worst‑case (real provider) workload; the mock will not add extra pressure.  
* **Circuit‑Breaker Granularity** – Each provider, including the mock, maintains its own circuit‑breaker state, allowing independent scaling of failure isolation.  

### Maintainability Assessment  

The design scores highly on maintainability:

* **Clear Separation of Concerns** – Providers, façade, and registry each have a single responsibility.  
* **Explicit Registration** – Adding or removing a provider is a single line change in `provider-registry.js`.  
* **Consistent Interface** – MockService mirrors the real provider contract, reducing the cognitive load for developers switching contexts.  
* **Potential Debt** – The duplicated caching and circuit‑breaking logic could become a source of bugs if updates diverge. A future refactor could extract these concerns into shared utility modules to reduce duplication.

Overall, MockService exemplifies a well‑engineered testing aid that integrates seamlessly into the existing LLM abstraction, leveraging the same architectural patterns that power production LLM providers.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- [LLM] The LLMAbstraction component employs a modular architecture, with its functionality distributed across multiple files, including integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts, lib/llm/llm-service.ts, and lib/llm/providers/anthropic-provider.ts. This modularity contributes to the component's robustness and ease of maintenance, as it allows developers to focus on specific aspects of the system without affecting other parts. For example, the LLMService class in lib/llm/llm-service.ts serves as a high-level facade for all LLM operations, handling mode routing, caching, and circuit breaking. This modular approach also enables the easy addition of new LLM providers, as evidenced by the provider registry in lib/llm/provider-registry.js.

### Siblings
- [DMRService](./DMRService.md) -- DMRService uses the Docker Model Runner to provide local LLM inference capabilities.
- [LLMService](./LLMService.md) -- LLMService uses the lib/llm/llm-service.ts file to provide a high-level facade for all LLM operations.


---

*Generated from 7 observations*
