# ViolationCaptureModule

**Type:** SubComponent

The UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) dispatches hook events and registers handlers, allowing for decoupling of the hook configuration from the specific implementation details.

## What It Is  

The **ViolationCaptureModule** lives inside the **ConstraintSystem** component and is the dedicated sub‑component that records, persists, and surfaces constraint‑violation events detected by the system.  Although the repository does not expose concrete source files for this module (the “Code Structure” entry shows *0 code symbols found*), the surrounding observations make clear where its responsibilities sit: it is the sink for violation data that originates from the hook infrastructure managed by `UnifiedHookManager` (`lib/agent-api/hooks/hook-manager.js`) and the configuration supplied by `HookConfigLoader` (`lib/agent-api/hooks/hook-config.js`).  

In practice, the module is expected to accept violation payloads emitted by the hook system, store them (e.g., in a database or file store), log the occurrence, optionally filter or aggregate the data for analysis, and forward notifications (email, alerts, etc.) to downstream consumers such as the **WorkflowOrchestrator** sibling component.  Its primary purpose is therefore to provide a reliable, queryable record of constraint breaches that can be consumed by other parts of the platform for reporting, remediation, or automated workflow triggers.

---

## Architecture and Design  

The architectural posture of the **ViolationCaptureModule** is shaped by the patterns already evident in its parent, **ConstraintSystem**.  The parent leverages the **Observer pattern** (via `UnifiedHookManager`) to broadcast hook events and the **Factory pattern** (via `HookConfigLoader`) to assemble hook configurations.  The ViolationCaptureModule sits at the *observer* end of this pipeline: it registers as a handler for specific hook events (e.g., “constraint‑violation”) and therefore benefits from the loose coupling that the Observer pattern provides.  Because the hook manager does not need to know the concrete implementation of the handler, the ViolationCaptureModule can evolve independently—adding new persistence back‑ends, filtering rules, or notification channels without requiring changes to the hook infrastructure.

The module’s design also hints at a **pipeline** style processing chain:

1. **Capture** – receives a violation object from the hook manager.  
2. **Persist** – writes the object to a durable store (database or file system).  
3. **Log** – emits a structured log entry through the system‑wide logging framework.  
4. **Filter/Aggregate** – optional in‑memory or batch processing to reduce noise or compute statistics.  
5. **Notify** – triggers external alerts (email, webhook, etc.) and forwards a reference to the **WorkflowOrchestrator**.

While the observations do not name a specific “pipeline” class, the sequence is implied by the listed capabilities (storage, logging, filtering, notification).  This design keeps each concern isolated, supporting the **Single Responsibility Principle** and making the module amenable to unit testing and future extension.

---

## Implementation Details  

Because concrete symbols are missing, the implementation can be inferred from the responsibilities described:

* **Handler Registration** – The module likely registers a callback with `UnifiedHookManager` (e.g., `hookManager.registerHandler('violation', handlerFn)`).  This registration occurs during the start‑up of the ConstraintSystem, ensuring that any hook that detects a rule breach will invoke the module’s entry point.

* **Persistence Layer** – A storage abstraction (perhaps an interface named `ViolationStore`) would be injected into the module.  Implementations could target a relational DB, a NoSQL document store, or a flat file, matching the observation that “a data storage mechanism, such as a database or file system” is used.  The module would call a method like `store.save(violationRecord)`.

* **Logging** – The module utilizes the system‑wide logging framework (e.g., `logger.info({event: 'violation', id: …})`).  By logging at a structured level, it enables downstream log aggregation tools to index and search for violation events.

* **Filtering / Aggregation** – Prior to persistence or notification, the module may apply simple filters (e.g., severity thresholds) or batch aggregation (e.g., count violations per rule over a time window).  This could be implemented as a small utility class (`ViolationProcessor`) that receives raw events and returns a processed payload.

* **Notification** – When a violation meets certain criteria, the module invokes a notifier component (`Notifier.sendEmail`, `Notifier.sendAlert`).  The observation that “a notification system, such as email or alerts” may be used suggests the presence of an abstraction that can be swapped (SMTP, Slack webhook, etc.).

* **Integration with WorkflowOrchestrator** – After persisting and optionally notifying, the module likely emits a higher‑level event (e.g., `workflowOrchestrator.handleViolation(violationId)`) so that the orchestrator can incorporate the violation into its workflow definitions.  This mirrors the sibling relationship described in the hierarchy context.

All of these pieces would be wired together in a composition root (perhaps `constraint-system/index.js`) where the factory (`HookConfigLoader`) creates the hook configuration, the hook manager registers the ViolationCaptureModule’s handler, and any required dependencies (store, logger, notifier) are instantiated.

---

## Integration Points  

1. **UnifiedHookManager (`lib/agent-api/hooks/hook-manager.js`)** – The primary entry point for violation events.  The ViolationCaptureModule registers as a listener, receiving payloads that have already been normalized by the hook system.

2. **HookConfigLoader (`lib/agent-api/hooks/hook-config.js`)** – Supplies configuration that may dictate which hooks are active and what severity levels should trigger persistence or notification.  Because the loader follows the Factory pattern, new hook configurations can be added without touching the ViolationCaptureModule.

3. **WorkflowOrchestrator (sibling)** – Consumes references to persisted violations to drive workflow actions (e.g., opening a ticket, pausing a process).  The module likely calls a public method on the orchestrator or publishes an event on a shared event bus.

4. **Logging Framework** – The module writes structured logs; the exact logger is not named but is assumed to be the same one used throughout the ConstraintSystem (e.g., `winston`, `pino`).

5. **Notification Sub‑system** – External services (SMTP server, alerting platform) are invoked via a notifier abstraction.  The module does not embed protocol details, preserving decoupling.

6. **Persistence Backend** – The module’s storage implementation may be swapped (DB vs. file system) without affecting its public contract, thanks to the abstract `ViolationStore` interface implied by the observations.

These integration points illustrate a **layered** interaction model: the ViolationCaptureModule sits in the *service* layer, receiving events from the *infrastructure* layer (hooks) and feeding results to both *observability* (logging/notification) and *orchestration* (WorkflowOrchestrator) layers.

---

## Usage Guidelines  

* **Register Early** – Ensure that the ViolationCaptureModule’s handler is registered with `UnifiedHookManager` during application start‑up before any hooks fire.  Delayed registration can cause missed violations.

* **Configure Severity** – Use `HookConfigLoader` to define which violation severities should be persisted versus merely logged.  Align these settings with operational policies to avoid storage overload.

* **Choose an Appropriate Store** – For high‑throughput environments, prefer a database that supports bulk inserts and indexing on violation fields (e.g., rule ID, timestamp).  For low‑volume or prototype setups, a simple file‑based store may suffice.

* **Leverage Structured Logging** – Emit logs with a consistent schema (`event: 'violation', ruleId, severity, timestamp`).  This enables downstream log analysis tools to correlate violations with other system events.

* **Throttle Notifications** – Implement rate‑limiting in the notifier to prevent alert fatigue.  The module’s filtering step can be used to batch similar violations before sending a single consolidated alert.

* **Coordinate with WorkflowOrchestrator** – When extending workflow definitions, reference the violation ID stored by the module.  Ensure that any workflow that reacts to a violation checks the persisted record for the latest state (e.g., resolved, ignored).

* **Maintain Test Coverage** – Because the module interacts with multiple external systems (hook manager, storage, logger, notifier, orchestrator), mock each dependency in unit tests and verify that the processing pipeline behaves correctly under success and failure scenarios.

---

### Summary of Requested Items  

**1. Architectural patterns identified**  
* Observer pattern – via `UnifiedHookManager` broadcasting hook events to the ViolationCaptureModule.  
* Factory pattern – via `HookConfigLoader` creating hook configurations that drive which violations are captured.  
* Pipeline / processing chain – implied sequence of capture → persist → log → filter/aggregate → notify.

**2. Design decisions and trade‑offs**  
* Decoupling the capture logic from storage and notification through abstractions improves extensibility but adds indirection.  
* Using a generic persistence interface permits swapping back‑ends but requires careful schema versioning.  
* Optional filtering/aggregation reduces noise and storage cost at the expense of additional processing latency.

**3. System structure insights**  
* ViolationCaptureModule is a leaf sub‑component of **ConstraintSystem**, consuming events from the hook subsystem and feeding results to the sibling **WorkflowOrchestrator**.  
* It sits between the low‑level hook infrastructure and higher‑level workflow/orchestration logic, acting as the persistence and observability bridge.

**4. Scalability considerations**  
* Persistence choice is critical: a high‑volume system should use a database that supports horizontal scaling and efficient indexing on violation attributes.  
* The Observer‑based event dispatch can handle many concurrent listeners; however, the module’s internal processing (filtering, aggregation) must be non‑blocking or off‑loaded to worker queues to avoid back‑pressure on the hook manager.  
* Notification throttling and batch aggregation help keep external alert channels from being overwhelmed.

**5. Maintainability assessment**  
* Strong separation of concerns (handler, store, logger, notifier) yields high maintainability; each piece can be updated or replaced independently.  
* Reliance on established patterns (Observer, Factory) aligns the module with the rest of the ConstraintSystem, making onboarding easier for developers familiar with the parent component.  
* The lack of concrete code symbols in the repository suggests that documentation and interface contracts are especially important to prevent drift as the module evolves.  

Overall, the **ViolationCaptureModule** embodies a well‑structured, extensible approach to recording constraint violations, leveraging the existing hook‑based architecture of the **ConstraintSystem** while providing clear integration pathways for persistence, observability, and workflow orchestration.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a combination of design patterns, including the Observer pattern and the Factory pattern, to achieve loose coupling and increased maintainability. For instance, the UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) employs the Observer pattern to dispatch hook events and register handlers, allowing for a decoupling of the hook configuration from the specific implementation details. Furthermore, the HookConfigLoader (lib/agent-api/hooks/hook-config.js) uses the Factory pattern to manage unified hook configurations, providing a flexible and extensible way to configure hooks. This design decision enables the system to easily add or remove hooks without affecting the overall architecture.

### Siblings
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- The WorkflowOrchestrator may use a workflow definition language, such as XML or JSON, to define and configure workflows.


---

*Generated from 7 observations*
