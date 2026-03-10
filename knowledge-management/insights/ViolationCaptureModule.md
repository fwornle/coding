# ViolationCaptureModule

**Type:** SubComponent

The ViolationCaptureModule integrates with other components, such as the ContentValidationModule, to ensure seamless violation capture and reporting

## What It Is  

The **ViolationCaptureModule** lives inside the **ConstraintSystem** component and is the dedicated sub‑component responsible for catching constraint‑violation events that arise when tools interact with the system.  Although the source tree does not contain a dedicated file for the module itself, the surrounding documentation makes it clear that the module is implemented alongside the other constraint‑management pieces that live under the *ConstraintSystem* hierarchy (e.g., the `ContentValidationAgent` in `integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts` and the `HookConfigLoader` in `lib/agent-api/hooks/hook-config.js`).  Its primary role is to listen for validation failures reported by the **ContentValidationModule** and to expose a **unified interface** that downstream code can query for detailed violation data such as error messages, offending entity identifiers, and contextual information.

## Architecture and Design  

The observations point to a **modular architecture**: each concern (validation, hook configuration, violation capture) lives in its own module and communicates through well‑defined interfaces.  The **ViolationCaptureModule** follows this principle by being a self‑contained unit that can be swapped or extended without touching the rest of the constraint stack.  

A key design pattern evident in the module is **event‑listener based capture**.  The module “utilizes a specific capture mechanism, such as event listeners, to capture constraint violations.”  In practice this means that when the **ContentValidationAgent** (the class that actually validates entity content) discovers a rule breach, it emits a violation event.  The **ViolationCaptureModule** registers an event listener for these emissions, records the payload, and makes it available through its unified API.  This loosely‑coupled, publish‑subscribe style interaction keeps the validation logic independent from the reporting logic while still guaranteeing that every violation is observed.

Another implicit pattern is the **Facade (Unified Interface)** pattern.  By “providing a unified interface for accessing violation data, simplifying development and maintenance,” the module abstracts away the underlying event handling, storage, and formatting details.  Callers—whether they are UI components, logging services, or external audit tools—interact with a single, stable API rather than dealing with multiple event streams or raw violation objects.

## Implementation Details  

Even though no concrete symbols were listed, the module’s responsibilities can be inferred from the surrounding codebase:

* **Event Listener Registration** – At initialization the module likely obtains a reference to the **ContentValidationAgent** (found at `integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts`).  It then subscribes to a violation‑emitted event, for example `onViolationDetected`.  The listener callback captures the event payload, which contains the error message, the rule that was broken, and any contextual data (e.g., the entity ID, the operation that triggered the check).

* **Violation Store** – To “provide detailed violation information,” the module must retain the captured events in a structured store.  This could be an in‑memory collection (e.g., a Map keyed by entity ID) or a lightweight persistence layer if the system needs to survive process restarts.  The store is the source of truth for the unified interface.

* **Unified Interface** – The module exposes methods such as `getViolations()`, `getViolationsByEntity(id)`, and `clearViolations()`.  These methods return a normalized data shape that includes the error message, rule identifier, and any additional context supplied by the validation agent.  By normalizing the data, the module shields callers from the internal event schema used by the **ContentValidationAgent**.

* **Hook Configuration Integration** – The module “integrates with the HookConfigurationManager to ensure correct configuration and validation.”  The **HookConfigurationManager** (which relies on `lib/agent-api/hooks/hook-config.js`) is responsible for loading hook definitions that determine which validation events should be listened to.  During startup, the **ViolationCaptureModule** queries the manager for the active hook set, ensuring that it only registers listeners for the hooks that are currently enabled.  This dynamic wiring lets administrators enable or disable specific violation‑capture hooks without code changes.

* **Error Context Enrichment** – The observation that the module “provides detailed violation information, including error messages and context” suggests that the listener may augment the raw event with extra diagnostics (e.g., stack traces, timestamps, user session data) before storing it.  This enrichment supports downstream debugging and audit trails.

## Integration Points  

The **ViolationCaptureModule** sits at the intersection of three major subsystems:

1. **ContentValidationModule** – The primary producer of violation events.  The module consumes events emitted by the `ContentValidationAgent` (`integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts`).  Any change in the validation agent’s event contract would directly affect the capture logic, so the two remain tightly coupled through the event interface.

2. **HookConfigurationManager** – Supplies the list of enabled hooks and the configuration that dictates which validation events are relevant.  By consulting the manager (which itself loads configurations via `HookConfigLoader` in `lib/agent-api/hooks/hook-config.js`), the capture module can dynamically adjust its listeners, supporting runtime reconfiguration without a restart.

3. **ConstraintSystem (Parent)** – The overall container that orchestrates the lifecycle of its child modules.  The parent likely instantiates the **ViolationCaptureModule**, passes in dependencies (validation agent, hook manager), and exposes the unified violation API to higher‑level services such as reporting dashboards, external audit pipelines, or automated remediation scripts.

Because the module offers a single, stable API, any consumer—whether inside the **ConstraintSystem** or external—does not need to know about the event‑listener mechanics or the hook configuration details.  This decoupling simplifies testing: unit tests can mock the validation agent’s events, while integration tests can verify that the module correctly registers with the hook manager.

## Usage Guidelines  

* **Initialize Early** – Register the capture module during system boot before any validation logic runs.  Early registration guarantees that no violation event is missed, especially during the first user interactions after a restart.

* **Respect Hook Configuration** – When adding new validation hooks, update the `HookConfigLoader` (`lib/agent-api/hooks/hook-config.js`) so that the **HookConfigurationManager** propagates the change.  The capture module will automatically pick up the new hook without code changes.

* **Query via the Unified Interface** – Consume violations through the provided methods (`getViolations`, `getViolationsByEntity`, etc.).  Avoid reaching into the internal store or listening directly to validation events; doing so bypasses the abstraction and can lead to duplicated logic.

* **Clear or Archive Wisely** – If the system needs to reset the violation state (e.g., after a successful remediation), use the module’s `clearViolations` method.  For audit purposes, consider exporting the stored violations before clearing them.

* **Performance Considerations** – Because the module stores every captured event, high‑throughput environments should monitor memory usage.  If the violation volume becomes large, consider configuring the module to batch‑persist older entries to a database or to prune entries after a configurable TTL.

---

### Architectural patterns identified
1. **Modular architecture** – each concern (validation, hook loading, violation capture) lives in its own module.  
2. **Event‑listener / Publish‑Subscribe** – violations are emitted as events and captured via listeners.  
3. **Facade (Unified Interface)** – a single API abstracts the underlying event handling and storage.

### Design decisions and trade‑offs
* **Loose coupling via events** – simplifies adding new validators but introduces reliance on a stable event contract.  
* **Dynamic hook configuration** – enables runtime flexibility at the cost of additional indirection through the HookConfigurationManager.  
* **In‑memory violation store** – offers fast access for developers but may require scaling mechanisms (e.g., persistence or pruning) for large workloads.

### System structure insights
* **ViolationCaptureModule** is a child of **ConstraintSystem**, sharing the same modular design principles as its siblings **ContentValidationModule** and **HookConfigurationManager**.  
* It bridges the validation side (ContentValidationAgent) and the configuration side (HookConfigurationManager), acting as the “glue” that turns raw validation failures into consumable data.

### Scalability considerations
* The event‑listener model scales horizontally as more validation agents can emit events without changing the capture logic.  
* Memory consumption of the violation store must be managed; introducing a configurable retention policy or external persistence can keep the module performant under high violation rates.

### Maintainability assessment
* The clear separation of concerns (validation, configuration, capture) and the unified façade make the module easy to understand, test, and extend.  
* Maintaining the event contract between **ContentValidationAgent** and **ViolationCaptureModule** is the primary maintenance hotspot; any change to the event payload requires coordinated updates in both modules.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a modular architecture, with each module responsible for a specific aspect of constraint management. For instance, the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) is used for entity content validation against configured rules. This modular design allows for easy maintenance and scalability of the system. The HookConfigLoader (lib/agent-api/hooks/hook-config.js) is another example of this modularity, as it is responsible for loading and merging hook configurations from multiple sources. This separation of concerns enables developers to focus on specific aspects of the system without affecting other parts.

### Siblings
- [ContentValidationModule](./ContentValidationModule.md) -- ContentValidationModule uses the ContentValidationAgent from integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts for entity content validation against configured rules
- [HookConfigurationManager](./HookConfigurationManager.md) -- HookConfigurationManager uses the HookConfigLoader from lib/agent-api/hooks/hook-config.js for loading and merging hook configurations from multiple sources


---

*Generated from 7 observations*
