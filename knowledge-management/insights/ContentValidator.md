# ContentValidator

**Type:** SubComponent

ContentValidator can be used in conjunction with the useWorkflowDefinitions hook (integrations/system-health-dashboard/src/components/workflow/hooks.ts) to retrieve workflow definitions from Redux

## What It Is  

The **ContentValidator** sub‑component lives inside the **ConstraintSystem** module and is implemented in the source tree that houses the semantic‑analysis agents.  Its primary entry point is the `ContentValidationAgent` located at  

```
integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts
```  

ContentValidator orchestrates content‑validation work by delegating to this agent and by listening to validation‑related hook events through the unified hook manager found at  

```
lib/agent-api/hooks/hook-manager.js
```  

Because the component is deliberately isolated, it can be swapped or extended without ripple effects on the surrounding system.  It also cooperates with the `useWorkflowDefinitions` hook ( `integrations/system-health-dashboard/src/components/workflow/hooks.ts` ) when workflow definitions stored in Redux are needed to inform validation rules.

---

## Architecture and Design  

The architecture that emerges from the observations is **modular** and **hook‑driven**.  The `ContentValidationAgent` is built as a collection of independent modules, each responsible for a distinct validation aspect (e.g., schema compliance, business‑rule checks).  This modularity aligns with the **Component‑Based Decomposition** pattern: every validation concern lives in its own module, making the agent extensible and testable in isolation.

A second, complementary pattern is the **Mediator** pattern, realized by the unified hook manager (`hook-manager.js`).  All validation‑related events—such as “entity‑submitted”, “validation‑started”, or “validation‑failed”—are funneled through this mediator.  By centralising event orchestration, the system avoids tight coupling between the validator and other parts of the ConstraintSystem (e.g., the ViolationCaptureModule).  The mediator also enables the `useWorkflowDefinitions` hook to inject workflow data into the validation flow without the validator needing direct knowledge of Redux internals.

The relationship to the parent component, **ConstraintSystem**, reinforces a layered design: the parent provides a common contract for constraint‑related services, while the ContentValidator implements the “content” slice of that contract.  Sibling modules such as **ViolationCaptureModule** and **HookManager** share the same hook infrastructure, illustrating a **Shared Infrastructure** approach that reduces duplication and promotes consistent event handling across the constraint domain.

---

## Implementation Details  

At the heart of the implementation is the `ContentValidationAgent` class (or exported object) in `content-validation-agent.ts`.  Its constructor registers a set of validation modules with the hook manager, typically via calls such as:

```ts
hookManager.register('entitySubmitted', this.validateEntity.bind(this));
```

Each validation module encapsulates a single rule set.  For example, a “JSONSchemaValidator” module might expose a `run(entity)` method that returns a list of violations.  The agent aggregates the results from all modules and emits a consolidated `validationCompleted` event through the hook manager.

The hook manager itself (`hook-manager.js`) maintains an internal map of event names to listener arrays.  It provides `register(eventName, listener)` and `emit(eventName, payload)` APIs.  Because the manager is a singleton imported by every agent, any component—such as the `useWorkflowDefinitions` hook—can listen for the same events, enrich the payload (e.g., by attaching workflow metadata), and let the ContentValidator consume the enriched data when it runs its checks.

The `useWorkflowDefinitions` hook, defined in `hooks.ts`, reads workflow definitions from the Redux store (`state.workflow.definitions`) and returns them to any consumer that subscribes.  When a validation request occurs, the ContentValidator can invoke this hook (or receive its output via a hook event) to apply workflow‑specific constraints, ensuring that validation logic respects the current process context.

Finally, the independence of ContentValidator is enforced by exposing a thin public API (e.g., `validate(entity): Promise<ValidationResult>`) that hides the internal modular composition.  This API can be called directly by higher‑level services in ConstraintSystem or by external callers that need ad‑hoc validation.

---

## Integration Points  

ContentValidator interacts with three primary integration surfaces:

1. **Hook Manager** – All validation lifecycle events flow through `lib/agent-api/hooks/hook-manager.js`.  The validator registers listeners, emits results, and consumes events emitted by other modules (e.g., ViolationCaptureModule).

2. **Workflow Definitions Hook** – The `useWorkflowDefinitions` hook (`integrations/system-health-dashboard/src/components/workflow/hooks.ts`) supplies contextual workflow data.  By subscribing to the same hook events, the validator can adjust its rule set based on the active workflow, enabling dynamic validation paths.

3. **ConstraintSystem Parent** – As a child of ConstraintSystem, ContentValidator adheres to the parent’s contract for constraint services.  The parent may invoke `ContentValidator.validate` when a new entity is persisted, and it may also listen for the `validationFailed` event to trigger downstream remediation (e.g., logging or UI feedback).

Sibling components, such as **ViolationCaptureModule**, also rely on the hook manager to receive validation outcomes.  This shared dependency ensures that when ContentValidator emits a `validationFailed` event, the ViolationCaptureModule can capture the violation details without direct coupling to the validator’s internal code.

---

## Usage Guidelines  

Developers should treat ContentValidator as a **plug‑and‑play** service within the ConstraintSystem.  When adding a new validation rule, create a dedicated module that implements a `run(entity)` (or similar) interface and register it with the agent in `content-validation-agent.ts`.  Avoid modifying the core agent logic; instead, extend the modular registry to keep the system maintainable.

All interactions with the validator should occur through the hook manager.  Direct method calls are acceptable for synchronous validation, but for asynchronous or cross‑cutting concerns (e.g., logging, telemetry) prefer emitting or listening to hook events.  This preserves the mediator’s decoupling benefits and allows future modules—such as a new analytics collector—to tap into the validation flow without code changes to ContentValidator.

When workflow context influences validation, retrieve the definitions via the `useWorkflowDefinitions` hook rather than accessing Redux state directly.  This abstraction protects the validator from changes in state shape and encourages a clear separation between UI‑layer state management and backend validation logic.

Finally, because the component is designed to be replaceable, any replacement implementation must honor the same public API (`validate(entity)`) and continue to register its events with the unified hook manager.  Maintaining this contract ensures that sibling modules like ViolationCaptureModule remain functional after a swap.

---

### Architectural Patterns Identified  
* **Component‑Based Decomposition** – validation logic is split into discrete, replaceable modules.  
* **Mediator (Hook Manager)** – centralised event orchestration via `hook-manager.js`.  
* **Shared Infrastructure** – sibling modules share the same hook manager and Redux‑derived hooks.  

### Design Decisions & Trade‑offs  
* **Modularity vs. Overhead** – breaking validation into many tiny modules improves testability and future extensibility but introduces a small runtime cost for module registration and event dispatch.  
* **Hook‑Driven Coupling** – using a mediator reduces direct dependencies, yet developers must understand the event contract to avoid silent failures.  
* **Independence of ContentValidator** – the decision to keep the validator independent enables hot‑swapping but requires a stable public API and disciplined versioning.  

### System Structure Insights  
ContentValidator sits one level below ConstraintSystem, sharing the hook manager with ViolationCaptureModule and collaborating with workflow hooks.  The hierarchy forms a clear vertical slice: parent provides the constraint contract, siblings provide complementary services, and the child (ContentValidator) implements a focused validation slice.

### Scalability Considerations  
Because validation modules are registered once at startup and invoked per‑entity, the system scales horizontally by adding more worker instances without changing the core architecture.  The hook manager’s lightweight publish/subscribe model can handle high event throughput, but if event volume grows dramatically, a more robust message bus may be required.

### Maintainability Assessment  
The modular design, clear separation of concerns, and central hook mediation make the codebase highly maintainable.  Adding, removing, or updating a validation rule only touches its own module and the registration list.  The unified hook manager reduces duplicated event‑handling code, and the use of a Redux‑derived hook for workflow data isolates UI state concerns from backend validation.  Overall, the architecture balances flexibility with simplicity, supporting long‑term evolution of the ContentValidator sub‑component.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- [LLM] The ConstraintSystem component utilizes a modular architecture, with each module responsible for a specific aspect of constraint validation and enforcement. This is evident in the use of ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) for validating entity content and ViolationCaptureService (scripts/violation-capture-service.js) for capturing constraint violations from tool interactions. The modular design allows for easier maintenance and updates, as each module can be modified or replaced independently without affecting the overall system. Furthermore, the use of a unified hook manager (lib/agent-api/hooks/hook-manager.js) enables central orchestration of hook events, making it easier to manage and coordinate the various modules. For instance, the useWorkflowDefinitions hook (integrations/system-health-dashboard/src/components/workflow/hooks.ts) can be used to retrieve workflow definitions from Redux, which can then be used to inform the constraint validation process.

### Siblings
- [ViolationCaptureModule](./ViolationCaptureModule.md) -- ViolationCaptureModule uses the ViolationCaptureService (scripts/violation-capture-service.js) to capture constraint violations from tool interactions
- [HookManager](./HookManager.md) -- HookManager uses a unified hook manager (lib/agent-api/hooks/hook-manager.js) to enable central orchestration of hook events


---

*Generated from 7 observations*
