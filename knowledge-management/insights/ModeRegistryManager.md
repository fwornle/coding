# ModeRegistryManager

**Type:** Detail

The ModeRegistryManager is anticipated to implement a strategy pattern, allowing for easy addition or removal of modes and their corresponding strategies without modifying the existing codebase.

## What It Is  

`ModeRegistryManager` lives in the **`mode‑registry.ts`** module (the same file that defines the `ModeRegistry` class).  It is the concrete manager that owns a `ModeRegistry` instance and exposes the public API used by the rest of the system to register, look‑up, and switch between *modes*.  The parent component, **`ModeResolver`**, holds a reference to this manager and delegates all mode‑related decisions to it.  Sibling modules such as **`ModeEstimationStrategy`** and **`ModeSwitchingMechanism`** rely on the manager to obtain the currently active strategy and to trigger mode changes, respectively.  In short, `ModeRegistryManager` is the central “registry‑and‑dispatcher” for mode‑specific behaviour within the application.

---

## Architecture and Design  

The observations point directly to a **Strategy pattern** implementation: each mode is associated with a distinct strategy object (e.g., `ModeEstimationStrategy`) that encapsulates the behaviour for that mode.  `ModeRegistryManager` maintains a map of *mode identifiers* → *strategy instances* inside the `ModeRegistry` class, allowing the system to swap strategies at runtime without touching the callers.  

The surrounding architecture also reflects a **Registry pattern**.  `ModeRegistry` defines the registration interface (`registerMode(id, strategy)`, `unregisterMode(id)`, etc.) and stores the associations.  `ModeRegistryManager` acts as the façade over this registry, exposing higher‑level operations such as “activate mode X” or “resolve the active strategy”.  

Interaction flow:  

1. **Registration** – During application bootstrap, concrete strategy classes (e.g., `ModeEstimationStrategy`) are instantiated and registered with the manager via the underlying `ModeRegistry`.  
2. **Resolution** – When `ModeResolver` needs to know which mode is currently active, it asks `ModeRegistryManager`, which consults the registry and returns the appropriate strategy.  
3. **Switching** – `ModeSwitchingMechanism` invokes a method on `ModeRegistryManager` to change the active mode; the manager updates its internal state and notifies any observers (if such a mechanism exists).  

Because the manager does not embed any mode‑specific logic itself, the design cleanly separates *policy* (the strategies) from *infrastructure* (the registry and manager).  This separation is explicitly called out in the observations: “allowing for easy addition or removal of modes and their corresponding strategies without modifying the existing codebase.”

---

## Implementation Details  

- **File location** – All core definitions are housed in **`mode-registry.ts`**.  The file contains the `ModeRegistry` class, which likely holds a private collection (e.g., `Map<string, ModeStrategy>`) and provides CRUD‑style methods for mode entries.  
- **`ModeRegistryManager` class** – Although the source code is not listed, the manager is expected to wrap the registry and expose a public API such as:  
  - `registerMode(id: string, strategy: ModeStrategy): void`  
  - `unregisterMode(id: string): void`  
  - `setActiveMode(id: string): void`  
  - `getActiveStrategy(): ModeStrategy`  
  - `listAvailableModes(): string[]`  

  These methods delegate to the underlying `ModeRegistry` for storage concerns while maintaining the “active mode” state internally.  

- **Strategy coupling** – `ModeEstimationStrategy` and any other mode‑specific implementations are independent modules that conform to a common interface (e.g., `ModeStrategy`).  The manager does not need to know the internals of each strategy; it only stores and retrieves them.  

- **Parent‑child relationship** – `ModeResolver` contains an instance of `ModeRegistryManager`.  When the resolver receives a request that depends on the current mode (e.g., a calculation that varies by mode), it calls `manager.getActiveStrategy()` and forwards the request to the returned strategy object.  

- **Sibling collaboration** – `ModeSwitchingMechanism` interacts with the manager to change the active mode.  Because the mechanism is “tightly coupled” with the manager, it likely calls a method like `manager.setActiveMode(newModeId)` and may listen for a change event emitted by the manager (if an event system is present).  

Overall, the implementation isolates mode‑specific code in discrete strategy classes while centralising registration and activation logic in `ModeRegistryManager`.

---

## Integration Points  

1. **`ModeResolver` (parent)** – Holds the manager instance and uses it as the sole source of truth for which strategy should handle a request.  Any resolver logic that depends on mode must go through the manager.  

2. **`ModeEstimationStrategy` (sibling)** – Implements the behaviour for a particular mode.  It is registered with the manager, typically during application start‑up, via `manager.registerMode('estimation', new ModeEstimationStrategy())`.  

3. **`ModeSwitchingMechanism` (sibling)** – Triggers mode changes by invoking the manager’s `setActiveMode`.  Because it is “tightly coupled,” it may also read the manager’s internal state to decide whether a switch is permissible.  

4. **External consumers** – Any component that needs to perform mode‑dependent work should depend on `ModeResolver` (or directly on `ModeRegistryManager` if appropriate) rather than on concrete strategies.  This keeps the dependency graph shallow and respects the encapsulation provided by the manager.  

No other modules are mentioned, so the integration surface is limited to the three entities above.  All communication appears to be synchronous method calls; no asynchronous messaging or service‑bus patterns are inferred from the observations.

---

## Usage Guidelines  

- **Register before use** – All strategies must be registered with `ModeRegistryManager` during initialization.  Attempting to activate or resolve a mode that has not been registered will result in an undefined strategy and should be avoided.  

- **Never modify the registry directly** – Interact with the manager’s public API (`registerMode`, `unregisterMode`, `setActiveMode`) rather than reaching into the underlying `ModeRegistry`.  This preserves the encapsulation and ensures any side‑effects (e.g., event emission) are correctly handled.  

- **Prefer the resolver for consumption** – Application code should request the current strategy via `ModeResolver` (which internally calls `manager.getActiveStrategy()`).  This decouples callers from the manager’s internal state handling.  

- **Add new modes by implementing a strategy** – To extend the system, create a new class that satisfies the common strategy interface, then register it with the manager.  No changes to `ModeResolver`, `ModeSwitchingMechanism`, or existing strategies are required, honoring the design goal of “easy addition or removal of modes without modifying the existing codebase.”  

- **Unregister with care** – If a mode is removed at runtime, ensure that it is not the currently active mode; otherwise, switch to a safe fallback before calling `unregisterMode`.  

---

### Architectural Patterns Identified  

1. **Strategy Pattern** – Modes are represented by interchangeable strategy objects.  
2. **Registry (or Service Locator) Pattern** – `ModeRegistry` stores and provides lookup for mode‑strategy pairs.  

### Design Decisions & Trade‑offs  

- **Separation of concerns** – By isolating registration (registry) from activation (manager) and behaviour (strategies), the design promotes modularity but introduces an extra indirection layer that developers must understand.  
- **Tight coupling with ModeSwitchingMechanism** – The switching component depends heavily on the manager, which simplifies coordination but can make unit testing of the switching logic harder if the manager’s internal state is not easily mockable.  
- **Synchronous API** – All interactions appear to be synchronous method calls, which keeps the flow simple but may limit scalability in highly concurrent scenarios.  

### System Structure Insights  

- The **core of mode handling** resides in a single file (`mode-registry.ts`), suggesting a deliberately small, focused module.  
- **Parent‑child hierarchy** is shallow: `ModeResolver` → `ModeRegistryManager` → `ModeRegistry`.  Sibling modules (`ModeEstimationStrategy`, `ModeSwitchingMechanism`) interact directly with the manager, forming a clear “hub‑spoke” topology.  

### Scalability Considerations  

- Adding many modes only grows the registry’s internal map; lookup remains O(1) if a hash‑based collection is used, so performance scales well.  
- If the number of strategies becomes large, initialization time (registration) may increase, but this is a one‑time cost at start‑up.  
- Because the manager holds the active mode in a single variable, concurrent mode switches would need synchronization if the application becomes multi‑threaded or runs in a distributed environment.  

### Maintainability Assessment  

The design’s emphasis on **strategy encapsulation** and **registry‑based lookup** makes the codebase highly maintainable: new modes are added by creating a new strategy class and registering it, with no need to touch existing logic.  The clear separation also aids readability—developers can locate mode‑related code in three predictable places (`mode-registry.ts`, strategy modules, and the switching mechanism).  The primary maintenance risk is the tight coupling between `ModeSwitchingMechanism` and the manager; any change to the manager’s API could ripple into the switching component.  Keeping the manager’s public contract stable and providing thin adapters for the switching logic will mitigate this risk.


## Hierarchy Context

### Parent
- [ModeResolver](./ModeResolver.md) -- ModeResolver uses a mode registry to manage the different modes, as seen in the mode-registry.ts file

### Siblings
- [ModeEstimationStrategy](./ModeEstimationStrategy.md) -- The ModeEstimationStrategy is expected to be implemented as a separate module or class, possibly within the mode-registry.ts file or a dedicated strategy file.
- [ModeSwitchingMechanism](./ModeSwitchingMechanism.md) -- The ModeSwitchingMechanism is anticipated to be tightly coupled with the ModeRegistryManager, as it relies on the registry to determine the active mode and retrieve the associated strategy.


---

*Generated from 3 observations*
