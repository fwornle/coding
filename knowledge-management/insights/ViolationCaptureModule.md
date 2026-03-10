# ViolationCaptureModule

**Type:** SubComponent

ViolationCaptureModule can be used in conjunction with the useWorkflowDefinitions hook (integrations/system-health-dashboard/src/components/workflow/hooks.ts) to retrieve workflow definitions from Redux

## What It Is  

The **ViolationCaptureModule** lives inside the **ConstraintSystem** and is responsible for recording constraint‑violation events that arise when tools interact with the platform. Its core implementation is spread across three concrete files that the observations call out directly:

* `scripts/violation-capture-service.js` – the **ViolationCaptureService** that contains the actual capture logic.  
* `lib/agent-api/hooks/hook-manager.js` – the **HookManager** that provides a unified hook orchestration layer used by the module to subscribe to and emit violation‑related hook events.  
* `integrations/system-health-dashboard/src/components/workflow/hooks.ts` – the `useWorkflowDefinitions` hook, which the module can call to pull workflow definitions from Redux when it needs contextual information for a violation.

The module is a **SubComponent** of the larger **ConstraintSystem**. It works side‑by‑side with sibling subcomponents such as **ContentValidator** (which uses `ContentValidationAgent`) and **HookManager** (which also relies on the same unified hook manager). The design goal is to keep the capture logic isolated, replaceable, and easy to maintain while still being tightly integrated with the hook‑driven event flow that the rest of the constraint‑validation stack uses.

---

## Architecture and Design  

The observations point to a **modular architecture** that treats each concern of constraint handling as an independent module. The key architectural traits are:

1. **Modular Service Layer** – `scripts/violation-capture-service.js` implements **ViolationCaptureService** as a self‑contained unit. Because it “is designed to be modular, allowing for easier maintenance and updates of capture logic” and “independent, allowing for modification or replacement without affecting the overall system,” the system follows a **service‑isolation pattern**. The service can be swapped out or extended without ripple effects on the rest of the ConstraintSystem.

2. **Central Hook Orchestration** – Both the module and its siblings rely on `lib/agent-api/hooks/hook-manager.js`. This file provides a **unified hook manager** that centralises registration, dispatch, and lifecycle handling of hook events. The pattern here is a **hook‑manager orchestration** approach: rather than each module wiring its own event bus, they all delegate to a single manager, simplifying coordination and guaranteeing a consistent ordering of events.

3. **Integration via Redux‑backed Hook** – The `useWorkflowDefinitions` hook (found in `integrations/system-health-dashboard/src/components/workflow/hooks.ts`) is a concrete integration point that pulls workflow definitions from the Redux store. This demonstrates a **state‑driven integration** where the ViolationCaptureModule can enrich violation data with the current workflow context.

Overall, the architecture avoids monolithic coupling. The **ConstraintSystem** acts as a container that aggregates independent modules (ViolationCaptureModule, ContentValidator, HookManager) each exposing a well‑defined interface (service functions, hook subscriptions). The design leans heavily on **separation of concerns** and **dependency inversion**: the module depends on abstractions provided by the hook manager rather than concrete event emitters.

---

## Implementation Details  

### Core Service (`scripts/violation-capture-service.js`)  
The **ViolationCaptureService** encapsulates all logic required to listen for violation events, format the payload, and persist or forward the data. Because the observations repeatedly stress its modularity, the service likely exports a small public API such as:

```js
export function initialize(hookManager) { … }
export function captureViolation(event) { … }
export function shutdown() { … }
```

The service registers its interest in specific hook names (e.g., `onConstraintViolation`) through the **HookManager** passed during initialization. By keeping the registration logic inside the service, the module can later replace the implementation (e.g., switch from local logging to remote telemetry) without touching the hook manager.

### Hook Manager (`lib/agent-api/hooks/hook-manager.js`)  
The **HookManager** provides a registry of hook names to listener arrays and a dispatch routine that executes listeners in a deterministic order. The ViolationCaptureModule uses this manager to:

* **Subscribe** – during service initialization, it adds a listener for violation‑related hooks.  
* **Emit** – if the module itself generates secondary events (e.g., “violation‑captured” notifications), it pushes them through the same manager, ensuring other components (such as analytics or UI dashboards) can react.

Because the same manager is shared with **ContentValidator** and the generic **HookManager** sibling, any change to hook semantics propagates uniformly, reducing duplication.

### Workflow Hook (`integrations/system-health-dashboard/src/components/workflow/hooks.ts`)  
The `useWorkflowDefinitions` hook is a React‑style custom hook that reads workflow definitions from the Redux store. When the ViolationCaptureService processes an event, it can invoke this hook (or a utility derived from it) to augment the violation record with the active workflow ID, step name, or other contextual metadata. This tight coupling to Redux ensures that violation data reflects the exact state of the system at the moment of capture.

### Interaction with Parent (`ConstraintSystem`)  
The **ConstraintSystem** orchestrates the lifecycle of its children. It likely calls a bootstrap routine that:

1. Instantiates the **ViolationCaptureService**.  
2. Passes the shared **HookManager** instance to it.  
3. Optionally supplies the `useWorkflowDefinitions` hook or a wrapper that provides workflow context.

Because the parent component also hosts **ContentValidator** and **HookManager**, the ViolationCaptureModule benefits from already‑initialized infrastructure (e.g., the hook manager is guaranteed to be ready before the service registers its listeners).

---

## Integration Points  

1. **Hook Manager Dependency** – The module cannot function without `lib/agent-api/hooks/hook-manager.js`. All violation events flow through this manager, making it the primary integration contract. Any change to hook naming or dispatch semantics must be coordinated with the manager.

2. **Workflow Context** – By leveraging `integrations/system-health-dashboard/src/components/workflow/hooks.ts`, the module obtains workflow definitions from Redux. This is an optional but recommended integration because it enriches violation payloads with operational context that downstream consumers (e.g., dashboards, alerting pipelines) rely on.

3. **Parent ConstraintSystem** – The parent is responsible for initializing the service and providing the hook manager instance. It also determines the order in which subcomponents are started; for example, the HookManager must be ready before the ViolationCaptureService registers its listeners.

4. **Sibling Interaction** – While the ViolationCaptureModule does not directly call **ContentValidator**, both share the same hook manager. If **ContentValidator** emits a validation‑failure hook, the ViolationCaptureService could optionally listen to it, allowing a unified view of both validation and violation events. This is an implicit integration enabled by the common manager.

5. **External Consumers** – Any downstream system that subscribes to the violation hook (e.g., telemetry pipelines, UI dashboards) will receive the events emitted by the service. Because the service’s output format is encapsulated, external consumers only need to understand the hook payload contract, not the internal capture mechanics.

---

## Usage Guidelines  

* **Initialize via ConstraintSystem** – Developers should never instantiate the ViolationCaptureService in isolation. Instead, rely on the parent **ConstraintSystem** bootstrap sequence, which guarantees that the shared HookManager is injected correctly.

* **Register Hooks Early** – If additional custom listeners need to be added (e.g., a custom logger), they should be registered **before** the ViolationCaptureService calls its `initialize` method. This ensures the service’s listeners are placed appropriately in the dispatch order.

* **Do Not Bypass the Hook Manager** – Directly emitting violation events without using `hook-manager.js` defeats the central orchestration guarantee and can cause missed or out‑of‑order processing. All event emission must go through the manager’s `emit` or equivalent API.

* **Leverage Workflow Context** – When capturing a violation, always enrich the payload with the current workflow definition obtained via `useWorkflowDefinitions`. This practice yields richer analytics and aligns with the design intent expressed in the observations.

* **Treat the Service as Replaceable** – Because the service is intentionally modular, teams are encouraged to replace the default implementation with a custom one (e.g., sending violations to a third‑party monitoring service) as long as the new implementation respects the same initialization signature and hook subscriptions.

* **Testing** – Unit tests should mock the HookManager to verify that the service correctly registers listeners and formats events. Integration tests should spin up the full ConstraintSystem stack to ensure end‑to‑end propagation of violation events through the manager to downstream consumers.

---

### Architectural Patterns Identified  

1. **Modular Service Isolation** – ViolationCaptureService is a self‑contained module that can be swapped independently.  
2. **Hook‑Manager Orchestration** – Centralised event registration and dispatch via `hook-manager.js`.  
3. **State‑Driven Integration** – Use of `useWorkflowDefinitions` to pull Redux state into violation handling.

### Design Decisions and Trade‑offs  

* **Independence vs. Coupling** – Making the service independent improves replaceability but introduces a runtime dependency on the hook manager. The trade‑off is acceptable because the manager is already a shared infrastructure component.  
* **Central Hook Manager** – Provides uniform event handling and reduces duplication, but it becomes a single point of failure; careful error handling within the manager is essential.  
* **Redux‑Based Context** – Enriching violations with workflow data yields better observability, yet it ties the module to the Redux store shape, requiring coordination when the store schema evolves.

### System Structure Insights  

* The **ConstraintSystem** is a container component that aggregates multiple modular subcomponents (ViolationCaptureModule, ContentValidator, HookManager).  
* Each subcomponent follows a “module‑with‑service + hook‑subscription” pattern, sharing the same `hook-manager.js`.  
* Sibling modules do not directly call each other; instead, they communicate indirectly through hooks, preserving loose coupling.

### Scalability Considerations  

* **Horizontal Scaling** – Because violation capture is event‑driven and decoupled via the hook manager, multiple instances of the ViolationCaptureService can run in parallel if the hook manager supports multi‑listener broadcasting.  
* **Throughput** – The unified hook manager must be able to handle high‑frequency hook emissions without becoming a bottleneck; this suggests that the manager should implement efficient listener queues or async dispatch.  
* **Extensibility** – Adding new violation‑type listeners merely requires registering additional hooks; no changes to existing services are needed, supporting scalable feature growth.

### Maintainability Assessment  

The design scores highly on maintainability:

* **Clear Separation** – Capture logic lives in a single file (`violation-capture-service.js`), making it easy to locate and modify.  
* **Modular Replacement** – The service can be swapped without touching the rest of the system, reducing regression risk.  
* **Centralized Event Management** – Changes to hook semantics are confined to `hook-manager.js`, avoiding scattered event‑handling code.  
* **Explicit Integration Points** – The use of `useWorkflowDefinitions` provides a well‑defined contract for contextual data, limiting hidden dependencies.

Potential maintenance risks include the reliance on the hook manager’s stability and the need to keep the Redux‑derived workflow hook in sync with any store changes. Regular reviews of the hook manager’s API and automated tests around hook registration will mitigate these risks.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a modular architecture, with each module responsible for a specific aspect of constraint validation and enforcement. This is evident in the use of ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) for validating entity content and ViolationCaptureService (scripts/violation-capture-service.js) for capturing constraint violations from tool interactions. The modular design allows for easier maintenance and updates, as each module can be modified or replaced independently without affecting the overall system. Furthermore, the use of a unified hook manager (lib/agent-api/hooks/hook-manager.js) enables central orchestration of hook events, making it easier to manage and coordinate the various modules. For instance, the useWorkflowDefinitions hook (integrations/system-health-dashboard/src/components/workflow/hooks.ts) can be used to retrieve workflow definitions from Redux, which can then be used to inform the constraint validation process.

### Siblings
- [ContentValidator](./ContentValidator.md) -- ContentValidator uses the ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) to validate entity content
- [HookManager](./HookManager.md) -- HookManager uses a unified hook manager (lib/agent-api/hooks/hook-manager.js) to enable central orchestration of hook events


---

*Generated from 7 observations*
