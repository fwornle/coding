# ModeResolver

**Type:** SubComponent

ModeResolver uses a strategy pattern in ModeResolverStrategy.java to resolve the operating mode based on the provider configuration in providers.json

## What It Is  

ModeResolver is a **sub‑component** that lives inside the **LLMAbstraction** façade.  Its concrete implementation is spread across three core source files that appear in the code base:

* `ModeResolverStrategy.java` – encapsulates the **strategy** used to decide which operating mode a provider should run in, based on the JSON configuration found in `providers.json`.  
* `ModeResolverSingleton.java` – guarantees that the whole application works with a **single, globally‑available** instance of ModeResolver.  
* `ProviderRegistry.java` – supplies ModeResolver with the current catalogue of registered LLM providers and the mode each provider advertises.

Together these files give ModeResolver the responsibility of translating static provider configuration into a runtime‑ready “mode” (e.g., *mock*, *live*, *tier‑based*).  The component is a child of **LLMAbstraction**, shares the same layer as sibling components **ProviderRegistry** and **CompletionRequestHandler**, and owns three child entities: **ModeConfiguration**, **ProviderRegistry**, and **ModeResolverStrategy**.

---

## Architecture and Design  

The observations reveal a deliberately layered architecture built around well‑known **design patterns**:

1. **Strategy Pattern** – `ModeResolverStrategy.java` implements the algorithmic variation for mode resolution.  By isolating the decision logic in a strategy class, the system can swap or extend resolution algorithms (e.g., a rule‑based strategy vs. a machine‑learning‑driven one) without touching the surrounding code.  

2. **Singleton Pattern** – `ModeResolverSingleton.java` enforces a single instance of ModeResolver throughout the application lifecycle.  This guarantees a consistent view of provider modes and eliminates the overhead of repeatedly constructing the resolver.  

3. **Dependency on ProviderRegistry** – ModeResolver does not own the provider catalogue itself; it delegates that responsibility to `ProviderRegistry.java`.  This separation of concerns mirrors the **factory** approach used by the sibling **ProviderRegistry** component (via `ProviderFactory.java`) and keeps registration logic distinct from mode‑resolution logic.

The component therefore follows a **modular, composition‑over‑inheritance** style: the parent **LLMAbstraction** orchestrates high‑level LLM interactions, while ModeResolver focuses exclusively on mode determination.  Interaction with siblings is minimal – ModeResolver only calls into ProviderRegistry to retrieve the latest provider list, whereas CompletionRequestHandler consumes the resolved mode when routing a request through its pipeline (`CompletionRequestPipeline.java`).

---

## Implementation Details  

### Core Classes  

| File | Class | Role |
|------|-------|------|
| `ModeResolverStrategy.java` | `ModeResolverStrategy` | Implements the **strategy** interface for mode resolution. It reads the provider entry from `providers.json`, extracts the configured mode, and returns a concrete `ModeConfiguration` object. |
| `ModeResolverSingleton.java` | `ModeResolverSingleton` | Holds a **static** reference to the sole `ModeResolver` instance. The `getInstance()` method lazily constructs the resolver on first call, ensuring thread‑safe, lazy initialization (the observation does not specify synchronization, but typical singleton implementations include it). |
| `ProviderRegistry.java` | `ProviderRegistry` | Exposes `getRegisteredProviders()` (or a similarly named method) that returns a collection of provider descriptors, each containing a mode field. ModeResolver invokes this to obtain the data required by the strategy. |

### Flow  

1. **Initialisation** – When the application starts, `ModeResolverSingleton.getInstance()` is called (often from the LLMAbstraction bootstrap). The singleton creates a `ModeResolver` object that internally holds a reference to `ModeResolverStrategy` and `ProviderRegistry`.  

2. **Resolution Request** – A caller (e.g., `CompletionRequestHandler`) asks the resolver for the mode of a specific provider. The resolver forwards the request to `ModeResolverStrategy`, passing the provider identifier.  

3. **Strategy Execution** – `ModeResolverStrategy` looks up the provider in the list supplied by `ProviderRegistry`. It reads the mode value from the JSON configuration (`providers.json`) and constructs a `ModeConfiguration` instance that encapsulates the resolved mode (including any auxiliary flags such as “mock‑only”).  

4. **Result Propagation** – The resolved `ModeConfiguration` is returned to the caller, which can then decide how to route the request (e.g., through a mock adapter or a live API client).

Because the strategy is a separate class, adding a new resolution algorithm (for example, a dynamic mode based on runtime load) only requires creating a new strategy implementation and wiring it into the singleton – no changes to the surrounding infrastructure are needed.

---

## Integration Points  

* **Parent – LLMAbstraction**: LLMAbstraction treats ModeResolver as a black‑box service for “mode lookup”.  During its façade initialisation it obtains the singleton instance and injects it wherever mode information is required (e.g., request routing, provider health checks).  

* **Sibling – ProviderRegistry**: ModeResolver directly depends on ProviderRegistry to fetch the current set of providers and their static configurations.  Any change to provider registration (addition, removal, or mode update) propagates automatically to ModeResolver because the registry is consulted at each resolution call.  

* **Sibling – CompletionRequestHandler**: The handler’s pipeline (`CompletionRequestPipeline.java`) consumes the `ModeConfiguration` produced by ModeResolver to decide which concrete completion client to invoke (mock vs. live).  This creates a clear contract: the pipeline only needs the mode, not the underlying provider details.  

* **Children – ModeConfiguration & ModeResolverStrategy**: `ModeConfiguration` is the data carrier produced by the strategy.  The strategy itself is the extensibility point for future resolution logic.  Both are encapsulated within ModeResolver, keeping the public API minimal (typically a `resolveMode(providerId)` method).  

* **External Configuration – providers.json**: The JSON file is the single source of truth for provider‑specific mode settings.  Because the strategy reads directly from this file (via ProviderRegistry), the system remains configuration‑driven and does not require code changes to adjust modes.

---

## Usage Guidelines  

1. **Always obtain ModeResolver through the singleton** – Call `ModeResolverSingleton.getInstance()` rather than constructing a new resolver.  This ensures a consistent view of provider modes and avoids accidental duplication of state.  

2. **Do not modify `providers.json` at runtime** – The design assumes a static configuration that is read each time a mode is resolved.  If dynamic updates are required, the ProviderRegistry must be refreshed first; otherwise the resolver may return stale mode data.  

3. **Extend resolution logic via a new strategy** – When a new mode‑determination rule is needed (e.g., feature‑flag driven), implement a new class that adheres to the same interface as `ModeResolverStrategy` and replace the existing strategy in the singleton’s construction block.  No other component needs to change.  

4. **Treat `ModeConfiguration` as immutable** – The object returned by the strategy should not be altered after creation.  If downstream code needs to adapt the configuration, create a new instance rather than mutating the original.  

5. **Coordinate with ProviderRegistry for registration changes** – If a provider’s mode is altered, ensure the ProviderRegistry reloads the updated `providers.json` before any subsequent mode resolution calls.  This prevents mismatches between the registry’s view and the resolver’s output.  

6. **Thread safety** – Although the observations do not detail synchronization, the singleton pattern typically requires thread‑safe lazy initialization.  Verify that `ModeResolverSingleton` uses a synchronized block or the “initialization‑on‑demand holder” idiom to avoid race conditions in a multi‑threaded environment.

---

### Summary of Architectural Insights  

| Architectural pattern | Where it appears | Rationale / trade‑off |
|-----------------------|------------------|-----------------------|
| **Strategy** | `ModeResolverStrategy.java` | Enables pluggable mode‑resolution algorithms; adds a level of indirection but keeps the resolver flexible. |
| **Singleton** | `ModeResolverSingleton.java` | Guarantees a single source of truth for mode data; simplifies consumption but introduces global state that must be carefully managed for testability. |
| **Dependency on ProviderRegistry** | `ProviderRegistry.java` (used by ModeResolver) | Centralises provider data, avoiding duplication; however, any latency in ProviderRegistry lookup propagates to mode resolution. |
| **Configuration‑driven design** | `providers.json` | Allows non‑code changes to affect runtime behaviour; requires disciplined configuration management. |

**Design decisions** focus on separation of concerns (resolution vs. registration), configurability, and ease of extension.  The main trade‑off is the reliance on a global singleton, which can hinder unit testing unless the design provides a way to inject a mock resolver.  

**System structure insights** show a clear hierarchy: LLMAbstraction → ModeResolver (singleton + strategy) → ProviderRegistry → providers.json.  Siblings operate independently but converge on the same provider data, promoting a cohesive yet loosely coupled ecosystem.  

**Scalability considerations** – Because mode resolution is a lightweight lookup (JSON read + map lookup) and the singleton caches no heavy state, the component scales horizontally with minimal overhead.  If the provider catalogue grows dramatically, the only scalability impact would be the time to read and parse `providers.json`, which can be mitigated by caching the parsed representation inside ProviderRegistry.  

**Maintainability assessment** – The use of well‑known patterns (strategy, singleton) and a clear separation between configuration, registration, and resolution makes the codebase easy to understand and modify.  Adding new modes or resolution rules does not ripple through other components.  The primary maintenance risk lies in the global singleton; introducing a dependency‑injection façade around the singleton would improve testability and future‑proof the design.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component serves as a high-level facade for interacting with various LLM providers, such as Anthropic, OpenAI, and Groq, enabling provider-agnostic model calls, tier-based routing, and mock mode for testing. Its architecture involves a combination of interfaces, classes, and modules that work together to manage LLM operations, including mode resolution, provider registration, and completion requests. The component utilizes design patterns like dependency injection, singleton, and factory to ensure flexibility, scalability, and maintainability.

### Children
- [ModeConfiguration](./ModeConfiguration.md) -- The ModeResolverStrategy.java file implements a strategy pattern to resolve the operating mode based on the provider configuration, which is managed by the ModeConfiguration.
- [ProviderRegistry](./ProviderRegistry.md) -- The ProviderRegistry is responsible for managing the registration of LLM providers, which includes storing their configurations and modes.
- [ModeResolverStrategy](./ModeResolverStrategy.md) -- The ModeResolverStrategy.java file implements a strategy pattern to resolve the operating mode based on the provider configuration, which is managed by the ModeConfiguration.

### Siblings
- [ProviderRegistry](./ProviderRegistry.md) -- ProviderRegistry uses a factory pattern in ProviderFactory.java to create instances of different provider classes based on their configurations in providers.json
- [CompletionRequestHandler](./CompletionRequestHandler.md) -- CompletionRequestHandler uses a pipeline pattern in CompletionRequestPipeline.java to process completion requests, including validation, routing, and response handling


---

*Generated from 3 observations*
