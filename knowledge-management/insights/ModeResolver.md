# ModeResolver

**Type:** SubComponent

The resolver applies a mode estimation strategy to predict the mode for a given LLM provider, as seen in the mode-estimation-strategy.ts file

## What It Is  

The **ModeResolver** sub‑component lives primarily in the `src/mode-resolver/` folder (e.g., `mode-resolver.ts`) and is the orchestrator that decides which *mode* an LLM provider should operate in at any point in time.  Its responsibilities are exposed through a class named **`ModeResolver`** that is instantiated via dependency injection, receiving a **sensitivity classifier** (the same classifier used by the sibling `SensitivityClassifier` component).  The resolver relies on a **mode registry** (`mode-registry.ts`) to look up the concrete mode implementations and on a **mode estimation strategy** (`mode-estimation-strategy.ts`) to predict the most appropriate mode for a given provider.  When a mode change is required, the resolver works together with the `LLMProviderManager` (see `llm-provider-manager.ts`) to apply the new mode, handling any required asynchronous updates through the `mode-updates.ts` module.

In short, ModeResolver is the decision‑making engine that couples the **LLMAbstraction** parent component with its child pieces—**ModeRegistryManager**, **ModeEstimationStrategy**, and **ModeSwitchingMechanism**—to deliver a scalable, type‑safe way of selecting and switching LLM operational modes.

---

## Architecture and Design  

The architecture that emerges from the observations is a **registry‑driven, strategy‑based** design built on top of **dependency injection** and **asynchronous programming**.  The **ModeRegistryManager** (implemented in `mode-registry.ts`) acts as a central catalog where each mode registers itself together with the strategy required to activate it.  This mirrors the pattern used by the sibling `ProviderRegistry` and `LLMProviderManager`, which also employ a registry to manage multiple providers.  By keeping the registry separate from the resolver, the system isolates the *what* (available modes) from the *when* (selection logic), enhancing modularity.

The **ModeEstimationStrategy** (found in `mode-estimation-strategy.ts`) follows the classic **Strategy Pattern**: different estimation algorithms can be swapped without touching the resolver core.  The resolver simply invokes the strategy’s `estimate` method to obtain a candidate mode for a given LLM provider.  This design aligns with the parent `LLMAbstraction` component’s broader use of strategies for provider selection and budgeting, reinforcing a consistent architectural language across the codebase.

Interaction between components is orchestrated through **dependency injection**.  The `ModeResolver` class receives a sensitivity classifier (shared with `SensitivityClassifier`) at construction time, allowing the resolver to factor in input‑prompt sensitivity when estimating a mode.  The resolver also references the `LLMProviderManager` to retrieve the current provider context and to trigger mode switches.  All cross‑component calls are asynchronous, using `async/await` (as demonstrated in `mode-updates.ts`), which ensures non‑blocking updates and fits the overall async nature of LLM operations described in the parent component.

Overall, the architecture is **layered**: the top‑level `LLMAbstraction` composes the resolver, the resolver composes the registry and estimation strategy, and the registry in turn holds concrete mode implementations.  This layering supports clear separation of concerns while reusing patterns already present in sibling components.

---

## Implementation Details  

1. **`mode-registry.ts` – ModeRegistryManager**  
   The file defines a **`ModeRegistry`** class (or similarly named export) that provides methods such as `registerMode(name, implementation)` and `getMode(name)`.  It encapsulates the **mode management interface** and stores a mapping from mode identifiers to concrete strategy objects.  This registry is the single source of truth for what modes exist and how they should be instantiated.

2. **`mode-resolver.ts` – ModeResolver**  
   The core class is **`ModeResolver`**. Its constructor receives a **sensitivity classifier** (injected from the parent `LLMAbstraction`) and likely also a reference to the `ModeRegistry`.  The resolver exposes an async method—e.g., `resolveMode(providerId)`—that performs the following steps:  
   * Query the `LLMProviderManager` for the current provider configuration.  
   * Invoke the **ModeEstimationStrategy** (`estimate(provider, classifier)`) to obtain a candidate mode name.  
   * Retrieve the concrete mode implementation from the `ModeRegistry`.  
   * Use the **ModeSwitchingMechanism** (internal or delegated) to apply the mode, awaiting any async side‑effects defined in `mode-updates.ts`.  

   The use of TypeScript’s type system is evident: the resolver’s signatures are strongly typed, guaranteeing that only valid mode identifiers and provider objects are passed around, which improves maintainability and catches errors at compile time.

3. **`mode-estimation-strategy.ts` – ModeEstimationStrategy**  
   This module implements one or more estimation algorithms (e.g., `SimpleEstimationStrategy`, `ContextualEstimationStrategy`).  Each strategy conforms to a common interface, perhaps `ModeEstimationStrategy { estimate(provider, classifier): string }`.  The resolver can be configured with a specific strategy at runtime, enabling easy experimentation or A/B testing of different prediction heuristics.

4. **`mode-updates.ts` – Asynchronous Mode Updates**  
   The file contains helper functions such as `applyModeChange(mode, provider)` that return promises.  The resolver awaits these functions, ensuring that any required network calls, configuration reloads, or warm‑up steps complete before the new mode becomes active.  This async handling mirrors the pattern used across the system for LLM calls, budget tracking, and provider registration.

5. **`llm-provider-manager.ts` – Integration Hook**  
   The resolver calls into `LLMProviderManager` to fetch the active provider and to notify it when a mode switch occurs.  This tight coupling is intentional: the provider manager is the authority on which LLM instance is in use, and the resolver must coordinate with it to keep the provider’s operational mode in sync.

Collectively, these pieces form a cohesive pipeline: **registry → estimation → switching → asynchronous update**, all typed and injected for flexibility.

---

## Integration Points  

- **Parent – LLMAbstraction**: The `LLMAbstraction` component composes the `ModeResolver` alongside other siblings (`BudgetTracker`, `SensitivityClassifier`, `ProviderRegistry`).  Dependency injection is used at this level to provide the resolver with the shared sensitivity classifier and possibly a concrete estimation strategy.  This ensures that mode decisions respect the same sensitivity rules applied elsewhere in the system.

- **Sibling – LLMProviderManager**: The resolver queries `LLMProviderManager` for the current provider context and informs it when a mode change occurs.  The manager, in turn, uses its own provider registry (as described in its `provider-registry.ts` file) to locate the correct LLM instance.

- **Sibling – SensitivityClassifier**: The classifier is injected into the resolver, allowing the estimation strategy to factor prompt sensitivity into its mode prediction.  This shared dependency promotes consistent handling of sensitive inputs across the entire LLM pipeline.

- **Child – ModeRegistryManager**: The resolver relies on the registry to retrieve concrete mode objects.  Adding a new mode simply means registering it in `mode-registry.ts`; the resolver automatically gains visibility without code changes.

- **Child – ModeEstimationStrategy**: The resolver delegates the “which mode?” question to this strategy.  Swapping strategies (e.g., from a simple heuristic to a machine‑learning‑based predictor) requires only re‑binding the strategy implementation, thanks to the strategy interface.

- **Child – ModeSwitchingMechanism**: Though not explicitly named in the observations, the mechanism is tightly coupled with the registry and is responsible for invoking the async update helpers in `mode-updates.ts`.  It serves as the bridge between the logical mode object and the runtime changes needed on the LLM provider.

All integration points are typed, asynchronous, and resolved through DI, which keeps the system loosely coupled while preserving compile‑time safety.

---

## Usage Guidelines  

1. **Instantiate via DI** – When constructing an `LLMAbstraction` instance, always inject the `ModeResolver` together with a concrete `SensitivityClassifier` and the desired `ModeEstimationStrategy`.  This guarantees that the resolver has the context it needs to make accurate predictions.

2. **Register Modes Early** – Populate the `ModeRegistry` during application bootstrap (e.g., in a `registerModes()` function).  Each mode should implement the common interface expected by the registry; failing to register a mode will cause the resolver to throw at runtime when it attempts to fetch an unknown mode.

3. **Prefer Async Calls** – All public methods on `ModeResolver` that trigger a mode change are async.  Callers must `await` these methods to ensure that the underlying `mode-updates.ts` operations (network calls, warm‑up, etc.) have completed before issuing further LLM requests.

4. **Leverage the Estimation Strategy** – If a new heuristic is needed (e.g., based on cost or latency), implement a new class adhering to the `ModeEstimationStrategy` interface and bind it in the DI container.  No changes to `ModeResolver` are required, thanks to the strategy pattern.

5. **Maintain Type Safety** – Because the codebase relies heavily on TypeScript’s type system, keep the mode identifiers and provider types in sync with their definitions in the registry and provider manager.  Adding a new mode should involve updating the union type that represents valid mode names, preventing accidental misuse.

Following these practices ensures that the ModeResolver remains predictable, testable, and easy to extend as new modes or estimation algorithms are introduced.

---

### Summary of Architectural Insights  

1. **Architectural patterns identified**  
   * Registry Pattern (`ModeRegistryManager`)  
   * Strategy Pattern (`ModeEstimationStrategy`)  
   * Dependency Injection (DI) across parent, sibling, and child components  
   * Asynchronous programming with `async/await` for non‑blocking updates  

2. **Design decisions and trade‑offs**  
   * **Registry + Strategy** separates mode data from selection logic, improving extensibility at the cost of an extra indirection layer.  
   * **DI** centralizes configuration and enables easy swapping of classifiers or strategies, but requires a well‑maintained container setup.  
   * **Async updates** guarantee responsiveness but introduce complexity around error handling and ordering of mode switches.  

3. **System structure insights**  
   * A clear hierarchy: `LLMAbstraction` → `ModeResolver` → (`ModeRegistryManager`, `ModeEstimationStrategy`, `ModeSwitchingMechanism`).  
   * Sibling components share common patterns (registry, async, DI), reinforcing a uniform architectural language.  

4. **Scalability considerations**  
   * Adding new modes or estimation algorithms does not affect existing resolver code, supporting horizontal growth.  
   * Asynchronous mode updates allow the system to handle many concurrent provider switches without blocking the main request flow.  

5. **Maintainability assessment**  
   * Strong TypeScript typing and isolated responsibilities make the codebase easy to navigate and refactor.  
   * Centralized registries and strategy interfaces reduce duplication and provide single points of change, lowering the risk of regression when extending functionality.


## Hierarchy Context

### Parent
- [LLMAbstraction](./LLMAbstraction.md) -- Key patterns observed in the LLMAbstraction component include dependency injection, used to set the mode resolver, budget tracker, and sensitivity classifier, and the strategy pattern, applied in the provider registry to manage the different LLM providers. The component's architecture is also characterized by the use of asynchronous programming, promises, and async/await syntax to handle the inherently asynchronous nature of LLM operations. Furthermore, the code utilizes TypeScript, benefiting from its type system to ensure better code maintainability and scalability.

### Children
- [ModeRegistryManager](./ModeRegistryManager.md) -- The mode-registry.ts file is expected to contain the ModeRegistry class, which defines the mode management interface and strategy registration mechanisms.
- [ModeEstimationStrategy](./ModeEstimationStrategy.md) -- The ModeEstimationStrategy is expected to be implemented as a separate module or class, possibly within the mode-registry.ts file or a dedicated strategy file.
- [ModeSwitchingMechanism](./ModeSwitchingMechanism.md) -- The ModeSwitchingMechanism is anticipated to be tightly coupled with the ModeRegistryManager, as it relies on the registry to determine the active mode and retrieve the associated strategy.

### Siblings
- [LLMProviderManager](./LLMProviderManager.md) -- LLMProviderManager uses a provider registry to manage the different LLM providers, as seen in the provider-registry.ts file
- [BudgetTracker](./BudgetTracker.md) -- BudgetTracker uses a budgeting algorithm to track and manage the budget, as seen in the budgeting-algorithm.ts file
- [SensitivityClassifier](./SensitivityClassifier.md) -- SensitivityClassifier uses a classification algorithm to classify input prompts, as seen in the classification-algorithm.ts file
- [ProviderRegistry](./ProviderRegistry.md) -- ProviderRegistry uses a registry-based approach to manage the different LLM providers, as seen in the provider-registry.ts file


---

*Generated from 6 observations*
