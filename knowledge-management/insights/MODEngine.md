# MODEngine

**Type:** SubComponent

The integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts file shows how the MODEngine sub-component can be used to manage and execute LLM operations in a specific mode, highlighting its versatility and reusability.

**## What It Is**  

The **MODEngine** sub‑component lives primarily in two locations in the code base:  

* `lib/llm/llm-service.ts` – the central façade that exposes a mode‑agnostic API for all LLM‑related work.  
* `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts` – a concrete implementation that demonstrates how a specific *mock* mode is wired into the engine.

MODEngine is the runtime orchestrator that decides **which mode** (e.g., real provider, mock provider, future custom providers) should handle a given LLM request, executes the request, and returns a unified response. It is a child of the higher‑level **LLMAbstraction** component, which itself uses the same façade to keep the rest of the system provider‑agnostic. The sub‑component is also a sibling to **BudgetTracker**, **SensitivityClassifier**, and **ProviderManager**, all of which consume the façade exposed by `lib/llm/llm-service.ts` for their own concerns (budget, sensitivity, provider registration).

---

**## Architecture and Design**  

The observations point to three core architectural patterns that shape MODEngine:

1. **Facade Pattern** – Implemented in `lib/llm/llm-service.ts`. The file presents a single, stable interface (`LLMService`‑like class or exported functions) that hides the complexity of mode selection, provider integration, and caching. Because the façade is shared by LLMAbstraction and its siblings, any new mode can be added without rippling changes through the rest of the system.

2. **State‑Machine‑Based Mode Management** – The MODEngine class (as seen in the mock service file) encapsulates a finite‑state machine that tracks the current operational mode, validates transitions, and guarantees that only allowed mode switches occur. This ensures deterministic behavior when the system moves from, say, *mock* to *real* mode or when a mode is temporarily disabled.

3. **Caching Mechanism** – MODEngine stores *mode metadata* in an internal cache (likely a map or LRU store) to avoid repeated look‑ups or remote calls for mode configuration. The cache lives inside the sub‑component and is consulted before any provider‑specific request is issued, reducing latency and external traffic.

Interaction flow: a consumer (e.g., BudgetTracker) calls the façade in `lib/llm/llm-service.ts`. The façade forwards the call to MODEngine, which consults its cache for the current mode metadata, validates the state transition (if any), selects the concrete implementation (e.g., the mock service in `llm-mock-service.ts`), executes the LLM operation, and returns the result through the same façade. Because the façade is the only public touch‑point, the rest of the system remains insulated from mode‑specific details.

---

**## Implementation Details**  

* **`lib/llm/llm-service.ts`**  
  * Exposes functions such as `runLLM(request)`, `setMode(modeId)`, and `getCurrentMode()`.  
  * Internally creates a singleton instance of **MODEngine** and delegates all calls to it.  
  * Implements the façade by translating generic request objects into the shape expected by the currently active mode.

* **`integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`**  
  * Declares a class (e.g., `MockLLMEngine` or `MODEngine`) that implements the state‑machine interface required by the façade.  
  * Defines the *mock* mode’s behavior: deterministic responses, no external network calls, and optional logging for test verification.  
  * Demonstrates how a new mode can be introduced: the class registers itself with the central MODEngine, provides a `handle(request)` method, and specifies allowed state transitions.

* **State Machine**  
  * Modes are modeled as states (e.g., `MOCK`, `PROVIDER_ANTHROPIC`, `PROVIDER_DMR`).  
  * Transitions are guarded; for example, moving from `MOCK` to a real provider may require a configuration load step.  
  * The state machine guarantees that an LLM request is never processed while the engine is in an *invalid* transitional state.

* **Caching**  
  * Mode metadata (such as endpoint URLs, authentication tokens, rate‑limit info) is cached after the first successful load.  
  * The cache is refreshed on explicit `setMode` calls or on cache‑miss events, ensuring that stale data does not corrupt subsequent requests.  
  * By keeping the cache inside MODEngine, sibling components like **BudgetTracker** benefit indirectly— they receive fast responses because the underlying mode lookup is inexpensive.

* **Relationship to Parent (`LLMAbstraction`)**  
  * LLMAbstraction imports the façade from `lib/llm/llm-service.ts` and re‑exports a higher‑level API for the rest of the application.  
  * All mode‑related logic remains encapsulated in MODEngine, allowing LLMAbstraction to stay thin and focused on abstraction rather than orchestration.

---

**## Integration Points**  

1. **Parent – LLMAbstraction**  
   * Consumes the façade (`lib/llm/llm-service.ts`) to expose a provider‑agnostic LLM interface to the entire system.  
   * Relies on MODEngine’s caching and state‑machine guarantees to ensure that higher‑level modules never see mode‑specific failures.

2. **Siblings**  
   * **BudgetTracker** calls the same façade to retrieve the current budget for LLM usage; it benefits from the same mode‑aware logic that may, for example, disable budgeting when the engine is in *mock* mode.  
   * **SensitivityClassifier** queries the façade for sensitivity tags; the classifier can be configured to bypass certain checks in mock mode.  
   * **ProviderManager** registers new providers through the façade, which in turn updates MODEngine’s state‑machine tables and cache entries.

3. **External Providers**  
   * Real providers (e.g., Anthropic, DMR) are implemented elsewhere (`lib/llm/providers/anthropic-provider.ts`, `lib/llm/providers/dmr-provider.ts`). They are plugged into MODEngine via the façade, meaning that adding a new provider only requires implementing the provider interface and registering the mode identifier.

4. **Testing / Development**  
   * The mock implementation in `llm-mock-service.ts` is used by integration tests and local development environments. Because the mock mode is a first‑class state, developers can switch to it with a single `setMode('mock')` call, guaranteeing deterministic behavior without incurring external costs.

---

**## Usage Guidelines**  

* **Always go through the façade** (`lib/llm/llm-service.ts`) when invoking any LLM operation. Directly instantiating a provider or a mode implementation bypasses the state‑machine and cache, leading to inconsistent behavior.  
* **Switch modes explicitly** using the provided `setMode(modeId)` function. Implicit mode changes are not supported; the state machine will reject any request that arrives during an undefined transition.  
* **Cache awareness** – When deploying a new provider or changing credentials, invoke a cache‑refresh (often part of `setMode`) to avoid stale metadata.  
* **Testing** – Leverage the mock mode by pointing the engine to `integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts`. The mock service returns deterministic payloads, making it safe for CI pipelines and local debugging.  
* **Extending MODEngine** – To add a new mode, implement a class that adheres to the same interface used by the mock service (e.g., a `handle(request)` method) and register the mode identifier with the façade. No changes are required in BudgetTracker, SensitivityClassifier, or ProviderManager because they all rely on the façade.

---

### Architectural Patterns Identified
1. **Facade** – Centralised, mode‑agnostic API (`lib/llm/llm-service.ts`).  
2. **State Machine** – Guarantees valid mode transitions within MODEngine.  
3. **Caching** – Stores mode metadata to minimise remote look‑ups.

### Design Decisions & Trade‑offs  
* **Facade vs. Direct Provider Calls** – Choosing a façade isolates the rest of the system from provider specifics, simplifying future provider swaps at the cost of an additional indirection layer.  
* **State‑Machine Governance** – Provides deterministic mode switching and prevents race conditions, but introduces complexity in defining and maintaining transition rules.  
* **In‑process Caching** – Improves latency and reduces external calls, yet requires careful invalidation logic to avoid serving stale configuration.

### System Structure Insights  
* MODEngine sits at the heart of LLMAbstraction, acting as the bridge between high‑level abstractions (BudgetTracker, SensitivityClassifier, ProviderManager) and low‑level provider implementations.  
* All sibling components share the same façade, ensuring a uniform contract for LLM‑related data (budget, sensitivity, provider selection).  
* The mock mode is a first‑class citizen, not a test‑only stub, which reflects a design emphasis on safe development workflows.

### Scalability Considerations  
* **Horizontal Scaling** – Because mode metadata is cached locally within each process, scaling out to multiple instances does not require a distributed cache; however, configuration changes must be propagated (e.g., via a config service) to keep caches consistent.  
* **Adding New Modes** – The façade and state‑machine architecture allow new modes to be introduced without breaking existing traffic, supporting incremental scaling of provider capabilities.  
* **Cache Size** – Mode metadata is lightweight, so the cache does not become a bottleneck; if future metadata grows, the caching strategy can be swapped for an LRU or shared cache without affecting the façade contract.

### Maintainability Assessment  
* **High** – The clear separation of concerns (facade, state machine, caching) makes the codebase easy to navigate. Adding or removing modes is a localized change.  
* **Moderate Complexity** – The state‑machine logic introduces a non‑trivial amount of code that must be kept in sync with the list of supported modes; documentation and unit tests are essential.  
* **Testability** – The existence of a dedicated mock mode that fully participates in the state machine makes automated testing straightforward and low‑cost.  
* **Future‑Proofing** – Because the parent LLMAbstraction and siblings already depend on the façade, any refactor of the underlying mode implementations will have minimal impact on the broader system.

## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component utilizes the facade pattern, as seen in the lib/llm/llm-service.ts file, which provides a unified interface for all LLM operations. This design decision allows for provider-agnostic model calls, enabling the addition or removal of providers without affecting the rest of the system. For instance, the Anthropic provider (lib/llm/providers/anthropic-provider.ts) and the DMR provider (lib/llm/providers/dmr-provider.ts) can be easily integrated or removed without modifying the core component. The facade pattern also enables the component to support multiple modes, including the mock provider (integrations/mcp-server-semantic-analysis/src/mock/llm-mock-service.ts) for testing purposes.

### Siblings
- [BudgetTracker](./BudgetTracker.md) -- BudgetTracker utilizes the lib/llm/llm-service.ts file to fetch the current budget for LLM operations, enabling provider-agnostic budget management.
- [SensitivityClassifier](./SensitivityClassifier.md) -- SensitivityClassifier utilizes the lib/llm/llm-service.ts file to fetch the sensitivity classification for LLM requests, enabling provider-agnostic sensitivity classification.
- [ProviderManager](./ProviderManager.md) -- ProviderManager utilizes the lib/llm/llm-service.ts file to manage and integrate different LLM providers, enabling provider-agnostic operations.

---

*Generated from 7 observations*
