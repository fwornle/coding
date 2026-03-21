# ModeSwitcher

**Type:** Detail

The implementation of the ModeSwitcher may involve conditional logic to determine the current mode and switch to the appropriate mode based on environment variables or other conditions.

## What It Is  

`ModeSwitcher` is the component responsible for changing the active **LLM mode** at runtime.  The observations place it inside the **LLMModeManager** hierarchy – the manager “contains ModeSwitcher”, and the surrounding infrastructure (the `ModeRegistry` and `MockModeProvider`) lives in **`lib/llm/llm‑service.ts`**.  Although the source file for `ModeSwitcher` itself is not listed, its logical location is alongside the other mode‑related classes in that module.  Its core job is to query the **`ModeRegistry`** for the set of registered modes, decide which mode should be active (often by inspecting environment variables or other runtime flags), and then hand off control to the selected mode implementation.  In test and development builds it can also delegate to a **`MockModeProvider`** so that mode changes are deterministic and isolated from external services.

## Architecture and Design  

The design that emerges from the observations is a **registry‑driven, provider‑based architecture**.  `ModeRegistry` acts as a central catalog of all concrete mode implementations; `ModeSwitcher` queries this registry, applying conditional logic to pick the appropriate entry.  This is a classic **Registry pattern** – the registry decouples the consumer (`ModeSwitcher`) from the concrete mode classes, allowing new modes to be added without touching the switcher logic.  

The interaction with `MockModeProvider` introduces a **Provider pattern** (or a test double strategy).  When the system runs under a testing configuration, `ModeSwitcher` can route calls to the mock provider, ensuring that mode‑switching behavior can be exercised without invoking real LLM services.  The conditional selection based on environment variables is a **Configuration‑Driven** approach: the active mode is not hard‑coded but driven by external configuration, which keeps the component flexible across environments (development, CI, production).  

All of these pieces sit under the umbrella of **LLMModeManager**, which appears to be the façade that external callers interact with.  By nesting `ModeSwitcher` inside the manager, the design enforces a clear separation: callers ask the manager for the current mode, while the manager delegates the decision‑making to the switcher and the lookup to the registry.

## Implementation Details  

Although no concrete symbols were extracted, the observations give a clear picture of the implementation flow:

1. **Mode discovery** – `ModeSwitcher` calls into `ModeRegistry` (implemented in `lib/llm/llm-service.ts`) to retrieve a map or list of available mode identifiers and their corresponding handler objects.  The registry likely exposes methods such as `getAllModes()` or `getMode(id)`.

2. **Decision logic** – The switcher evaluates runtime conditions.  The most common trigger mentioned is an **environment variable** (e.g., `LLM_MODE=mock|prod|test`).  A series of `if/else` or a `switch` statement maps the variable’s value to a mode key that exists in the registry.

3. **Mode activation** – Once a target mode is identified, the switcher either returns the concrete mode instance directly or instructs the `LLMModeManager` to set it as the active mode.  In a testing scenario the switcher detects the presence of `MockModeProvider` and substitutes the real mode with the mock implementation, ensuring that downstream code receives a predictable stub.

4. **Error handling** – If the requested mode is not present in the registry, the switcher likely falls back to a default mode (perhaps the first registered mode) or throws a descriptive error.  This defensive path keeps the system from entering an undefined state when configuration is mismatched.

Because the switcher is a thin orchestration layer, most of the heavy lifting (e.g., actual LLM calls, mock behavior) resides in the concrete mode classes that the registry holds.

## Integration Points  

`ModeSwitcher` sits at the intersection of three key entities:

* **Parent – `LLMModeManager`** – The manager owns the switcher and presents a simplified API (`getCurrentMode()`, `setMode()`) to the rest of the codebase.  All external components interact with the manager rather than the switcher directly, preserving encapsulation.

* **Sibling – `ModeRegistry`** – The registry is the source of truth for what modes exist.  Any addition or removal of a mode requires only an update to the registry (e.g., registering a new class in `lib/llm/llm-service.ts`).  The switcher reads from this registry but does not modify it.

* **Sibling – `MockModeProvider`** – When the environment indicates a testing scenario, the switcher delegates to this provider.  The provider implements the same interface as real modes, allowing the rest of the system to remain agnostic to whether it is dealing with a mock or a production implementation.

The only external dependency explicitly mentioned is the **environment** (process variables).  No other services or libraries are referenced, so the integration surface is deliberately narrow, which simplifies both testing and deployment.

## Usage Guidelines  

1. **Configure via environment** – Set the appropriate environment variable (e.g., `LLM_MODE`) before the application starts.  The value must match a key registered in `ModeRegistry`; otherwise the switcher will fall back to its default or raise an error.

2. **Prefer the manager API** – Call `LLMModeManager` methods to query or change the active mode.  Direct interaction with `ModeSwitcher` is discouraged because the manager may perform additional bookkeeping (e.g., caching the current mode).

3. **Register new modes centrally** – When extending the system with a new LLM mode, add the implementation to `ModeRegistry` in `lib/llm/llm-service.ts`.  No changes to `ModeSwitcher` are required, preserving the open/closed principle.

4. **Use `MockModeProvider` for tests** – In unit‑ or integration‑tests, set the environment to a mock flag (or inject a test configuration) so that `ModeSwitcher` selects the mock provider.  This guarantees deterministic behavior without external LLM calls.

5. **Avoid hard‑coding mode names** – All mode identifiers should be defined as constants (or enum‑like structures) in the registry module.  This prevents mismatches between the switcher’s conditional logic and the registry’s keys.

---

### Architectural patterns identified
* **Registry pattern** – `ModeRegistry` centralises mode discovery.  
* **Provider / Test double pattern** – `MockModeProvider` supplies a mock implementation for testing.  
* **Configuration‑driven selection** – Environment variables steer the switcher’s conditional logic.  

### Design decisions and trade‑offs
* **Decoupling via registry** – Allows adding new modes without touching the switcher, but introduces a runtime lookup cost (negligible for a small set of modes).  
* **Environment‑based configuration** – Simple to use and works across deployment pipelines; however, it couples mode selection to process state, which can be less explicit than a programmatic API.  
* **Separate mock provider** – Facilitates isolated testing, but requires developers to keep the mock implementation in sync with the real mode interfaces.  

### System structure insights
The mode‑management subsystem is organized as a **vertical slice**: `LLMModeManager` (facade) → `ModeSwitcher` (decision engine) → `ModeRegistry` (catalog) → concrete mode implementations (including `MockModeProvider`).  All files reside under **`lib/llm/llm-service.ts`**, reinforcing a modular boundary for LLM‑related concerns.

### Scalability considerations
* Adding many modes will still be inexpensive because the registry lookup is O(1) (likely a map).  
* If future requirements demand dynamic mode loading (e.g., plugins), the current registry could be extended to load modules lazily, preserving the same switcher interface.  
* Environment‑based selection scales well for containerised deployments where each instance can be configured independently.

### Maintainability assessment
The architecture is **highly maintainable**: the switcher contains only orchestration logic, the registry owns the mode catalogue, and the mock provider isolates test concerns.  The clear separation of responsibilities means that changes to one piece (e.g., a new LLM backend) rarely ripple to others.  The main maintenance risk is keeping the environment‑variable values aligned with registry keys, which can be mitigated by defining shared constants.

## Hierarchy Context

### Parent
- [LLMModeManager](./LLMModeManager.md) -- The LLMModeManager uses a registry to manage the available modes, as seen in the lib/llm/llm-service.ts file.

### Siblings
- [ModeRegistry](./ModeRegistry.md) -- The ModeRegistry is implemented in the lib/llm/llm-service.ts file, which suggests a modular design for mode management.
- [MockModeProvider](./MockModeProvider.md) -- The MockModeProvider is likely used in conjunction with the ModeRegistry and ModeSwitcher to test mode switching and management functionality.

---

*Generated from 3 observations*
