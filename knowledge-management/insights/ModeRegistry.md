# ModeRegistry

**Type:** Detail

The use of a registry pattern in ModeRegistry implies a decoupling of mode implementation from the LLMModeManager, allowing for greater flexibility in mode development.

## What It Is  

The **ModeRegistry** lives in the source file **`lib/llm/llm-service.ts`**.  It is the central catalogue that holds the concrete “mode” objects used by the language‑model service layer.  The registry is owned by the **`LLMModeManager`** – the parent component that orchestrates which mode is active – and it is consulted by sibling components such as **`ModeSwitcher`** and **`MockModeProvider`**.  In practice, the registry is a lightweight container that maps a mode identifier (for example, a string key) to a mode implementation, allowing the rest of the system to request a mode without needing to know how that mode was constructed.

## Architecture and Design  

The observations point directly to a **registry pattern** as the core architectural choice.  By separating the *registration* of modes from their *consumption*, the design achieves **decoupling**: the `LLMModeManager` does not need to embed any mode‑specific logic, and new modes can be added without touching the manager’s code.  This pattern also supports **open‑closed** principles – the system is open for extension (new mode classes) but closed for modification (existing manager code stays unchanged).

Interaction flows are implied by the hierarchy:  

* `LLMModeManager` holds a reference to the `ModeRegistry`.  
* `ModeSwitcher` queries the registry to obtain the list of available modes and to request a switch to a particular mode.  
* `MockModeProvider` likely registers mock implementations into the same registry for testing purposes.  

Because all mode‑related look‑ups funnel through a single registry, the architecture encourages a **single source of truth** for mode metadata, which simplifies coordination between the manager, switcher, and any test harnesses.

## Implementation Details  

Although the source file contains **zero explicit code symbols** in the provided observations, the naming and location give strong clues about its internals:

1. **Registration API** – The registry probably exposes a method such as `registerMode(id: string, modeInstance: Mode)` that stores the association in an internal map.  
2. **Lookup API** – A complementary method like `getMode(id: string): Mode` enables the `ModeSwitcher` (and possibly the manager) to retrieve a concrete mode by its identifier.  
3. **Enumeration** – To support UI elements or diagnostics, the registry may provide `listModes(): string[]` or a similar iterator over the registered keys.  
4. **Lifecycle Management** – Since the registry lives inside `llm-service.ts`, it is likely instantiated once during service initialization and then shared as a singleton or as a property of the `LLMModeManager`.  

The registry’s placement in **`lib/llm/llm-service.ts`** indicates that it is part of the LLM service layer rather than a generic utility, reinforcing its purpose of managing *LLM‑specific* operational modes.

## Integration Points  

* **Parent – `LLMModeManager`**: The manager delegates all mode‑related queries to the `ModeRegistry`.  When the manager needs to activate a mode, it asks the registry for the appropriate implementation and then hands it to the underlying LLM engine.  
* **Sibling – `ModeSwitcher`**: The switcher reads the registry’s catalogue to present available options to the user (or programmatic caller) and invokes a registry lookup when a new mode is selected.  
* **Sibling – `MockModeProvider`**: In test environments, the mock provider registers stubbed mode objects into the same registry, allowing the `ModeSwitcher` and `LLMModeManager` to operate against deterministic, controllable implementations.  

No other external dependencies are mentioned, so the registry’s public interface is likely the only contract other components rely on.

## Usage Guidelines  

1. **Register Early, Use Later** – All concrete mode implementations should be registered with the `ModeRegistry` during application bootstrap (e.g., inside the initialization code of `llm-service.ts`).  This ensures that the `LLMModeManager` and `ModeSwitcher` can discover every mode before any user interaction occurs.  
2. **Avoid Direct Instantiation** – Consumers (manager, switcher, tests) must retrieve modes exclusively through the registry’s lookup methods.  Directly constructing mode objects bypasses the decoupling benefits and can lead to duplicate instances.  
3. **Unique Identifiers** – Each mode must be registered under a unique key.  Collisions would cause later registrations to overwrite earlier ones, breaking the single source of truth guarantee.  
4. **Testing with `MockModeProvider`** – When writing unit or integration tests, replace real mode registrations with mock ones via the `MockModeProvider`.  Because the registry is the sole gateway, swapping implementations is straightforward and does not require changes to the manager or switcher.  
5. **Extensibility** – Adding a new mode only requires creating the mode class and calling `registerMode` in the appropriate initialization block.  No changes to `LLMModeManager` or `ModeSwitcher` are needed, provided the new mode conforms to the expected interface.

---

### Architectural Patterns Identified  
* Registry pattern (central catalogue for mode objects)  
* Decoupling via dependency inversion (manager depends on abstract registry, not concrete modes)  

### Design Decisions and Trade‑offs  
* **Decision:** Centralize mode storage in `ModeRegistry`.  
  * **Benefit:** Easy extension, single source of truth, testability.  
  * **Trade‑off:** Introduces a global mutable structure that must be correctly initialized before use.  

* **Decision:** Locate the registry in `lib/llm/llm-service.ts`.  
  * **Benefit:** Keeps mode management close to the LLM service domain.  
  * **Trade‑off:** Ties the registry’s lifecycle to the service module, limiting reuse outside the LLM context.  

### System Structure Insights  
* Hierarchical: `LLMModeManager` → owns `ModeRegistry`; siblings (`ModeSwitcher`, `MockModeProvider`) interact with the registry.  
* The registry acts as the nexus for all mode‑related data, mediating between runtime operation (`ModeSwitcher`) and test scaffolding (`MockModeProvider`).  

### Scalability Considerations  
Because the registry is a simple map, it scales linearly with the number of modes.  Adding dozens of modes does not affect lookup performance materially.  The primary scalability concern is **initialization order** – all modes must be registered before any switch occurs, which can be managed through a deterministic bootstrap sequence.  

### Maintainability Assessment  
The registry‑centric design isolates mode‑specific code, making it straightforward to add, remove, or replace modes without touching the manager or switcher.  As long as the registration contract remains stable, the codebase enjoys high maintainability.  The main maintenance burden is ensuring that the registration step is not omitted during new feature integration, which can be mitigated with startup tests that verify the registry contains the expected keys.


## Hierarchy Context

### Parent
- [LLMModeManager](./LLMModeManager.md) -- The LLMModeManager uses a registry to manage the available modes, as seen in the lib/llm/llm-service.ts file.

### Siblings
- [ModeSwitcher](./ModeSwitcher.md) -- The ModeSwitcher likely relies on the ModeRegistry to retrieve available modes, as suggested by the parent component analysis.
- [MockModeProvider](./MockModeProvider.md) -- The MockModeProvider is likely used in conjunction with the ModeRegistry and ModeSwitcher to test mode switching and management functionality.


---

*Generated from 3 observations*
