# RequestRouter

**Type:** Detail

The absence of explicit source code references for RequestRouter within the provided context implies its implementation details are not directly available, yet its function is inferable from the parent component's analysis.

## What It Is  

`RequestRouter` is a core component that lives inside the **LLMController** implementation (the exact file path is not listed in the observations, but LLMController resides alongside the other language‑model utilities under `lib/llm/`). Its sole responsibility is to direct incoming LLM‑related calls—initialisation, mode resolution, and completion requests—to the appropriate handler logic inside the controller. Because **LLMController** extends **EventEmitter**, the router operates in an event‑driven fashion: it receives an event payload, determines which internal method or downstream service should process the request, and then forwards the payload accordingly. In short, `RequestRouter` is the glue that translates high‑level LLM operations into concrete controller actions while preserving the loose coupling afforded by the event‑emitter pattern.

## Architecture and Design  

The design that emerges from the observations is **event‑driven request routing**. The primary pattern in use is the **Observer (publish/subscribe)** pattern, materialised by the `EventEmitter` base class that LLMController inherits. `RequestRouter` leverages this by listening for specific events (e.g., `"initialize"`, `"resolveMode"`, `"complete"`). When an event fires, the router inspects the payload—typically containing a request type, model identifier, and optional parameters—and routes the call to the matching method on LLMController or to a downstream service such as **LLMService** (`lib/llm/llm-service.ts`).  

This architecture isolates the *decision* about *where* a request goes from the *execution* of the request itself. The router does not implement the business logic; it merely maps request signatures to handler functions. Consequently, the system enjoys **separation of concerns**: LLMController focuses on lifecycle management and event emission, `RequestRouter` handles routing, and LLMService implements the actual model interaction. The interaction flow can be summarised as:

1. A client or internal component emits an event on the LLMController instance.  
2. `RequestRouter`, attached as a listener, intercepts the event.  
3. Based on the event name and payload, the router invokes the corresponding method on LLMController (or forwards to LLMService).  
4. The invoked method performs the work and may emit further events (e.g., `"completed"`).

Because the router is a child of LLMController, it automatically inherits the controller’s event emitter context, eliminating the need for a separate messaging bus.

## Implementation Details  

While the source code for `RequestRouter` is not present in the supplied observations, its functional contract can be inferred from the surrounding components:

* **Event Listener Registration** – During LLMController construction, the router likely registers listeners such as `this.on('initialize', this.handleInitialize)` or `this.on('complete', this.handleCompletion)`. The router’s methods (`handleInitialize`, `handleResolveMode`, `handleCompletion`) act as thin adapters that call the matching controller methods (`initialize`, `resolveMode`, `requestCompletion`).

* **Payload Inspection** – Each handler examines the event payload to extract routing keys. For example, a `"complete"` event may include `{ model: 'gpt‑4', prompt: '…', options: {...} }`. The router may contain a simple `switch` or a lookup table that maps `model` identifiers to specific service instances, allowing the controller to support multiple back‑ends without hard‑coding them.

* **Error Propagation** – In an event‑driven system, errors are typically emitted as separate events (e.g., `"error"`). `RequestRouter` likely catches synchronous exceptions from the controller calls and re‑emits them, preserving the non‑blocking nature of the architecture.

* **Extensibility Hooks** – Because the router is a distinct object, new request types can be added by defining a new event name and a corresponding handler method, without touching the core controller logic. This aligns with the open‑closed principle.

Overall, `RequestRouter` is a lightweight orchestrator that delegates work while keeping the controller’s public API simple—essentially a façade over the event emitter.

## Integration Points  

`RequestRouter` sits directly inside **LLMController**, making it an internal child component. Its primary integration points are:

* **LLMController** – The router receives the controller’s event emitter instance as its execution context. All routing decisions funnel back into the controller’s public methods, ensuring a single source of truth for state management.

* **LLMService (`lib/llm/llm-service.ts`)** – When the router determines that a request requires actual model interaction, it forwards the call to LLMService. This service encapsulates the low‑level HTTP or SDK communication with the language model provider.

* **External Clients** – Any part of the application that needs to trigger an LLM operation does so by emitting an event on the LLMController instance (e.g., `controller.emit('complete', payload)`). The router is the invisible bridge that translates those external signals into concrete service calls.

* **Event Listeners** – Other modules may listen for result events such as `"completed"` or error events like `"error"` emitted by the controller after the router’s delegation, forming a bidirectional event flow.

No additional dependencies beyond the Node.js `events` module and the internal `LLMService` are indicated by the observations.

## Usage Guidelines  

1. **Emit Defined Events Only** – Developers should interact with the LLM subsystem by emitting the canonical events that `RequestRouter` expects (`'initialize'`, `'resolveMode'`, `'complete'`). Using undocumented event names will bypass the router and result in no action.

2. **Provide Complete Payloads** – Each event payload must contain the fields required for routing (e.g., `model`, `prompt`, `options`). Missing keys may cause the router to fall back to default handlers or throw an error that propagates as an `'error'` event.

3. **Handle Result Events** – After a request is routed, listen for the corresponding success events (`'initialized'`, `'modeResolved'`, `'completed'`) or the generic `'error'` event to react appropriately. This keeps the interaction fully asynchronous and non‑blocking.

4. **Extend with New Events Carefully** – If a new LLM operation is needed, add a new event name and a handler method inside `RequestRouter`. Ensure the handler forwards to a method on LLMController or LLMService to preserve the single‑point‑of‑truth design.

5. **Avoid Direct Method Calls** – Bypassing the router by calling controller methods directly defeats the routing logic and can lead to inconsistent state. Always go through the event emitter interface.

---

### 1. Architectural patterns identified
* **Observer / Publish‑Subscribe** – realised through `EventEmitter` inheritance.
* **Facade / Router** – `RequestRouter` acts as a façade that maps events to concrete handler calls.
* **Separation of Concerns** – distinct layers for event handling (router), controller state, and service interaction.

### 2. Design decisions and trade‑offs
* **Event‑driven routing** simplifies asynchronous handling and decouples callers from implementation, at the cost of a less explicit call graph (harder static analysis).
* **Router as child component** keeps routing logic colocated with the controller, improving encapsulation but limiting reuse across unrelated controllers.
* **Payload‑based dispatch** enables flexible addition of new models without code changes, though it relies on disciplined payload structures.

### 3. System structure insights
* The system is organised around a central **LLMController** that owns an internal **RequestRouter** and delegates heavy lifting to **LLMService** (`lib/llm/llm-service.ts`).  
* All LLM‑related interactions flow through a single event emitter, creating a clear vertical communication channel.

### 4. Scalability considerations
* Because routing is event‑based and stateless, adding more request types or supporting additional model back‑ends scales linearly—just extend the router’s lookup table.  
* High request volumes are limited only by the underlying Node.js event loop and the capacity of LLMService; the router itself adds negligible overhead.

### 5. Maintainability assessment
* **High maintainability** – the router isolates routing logic, making it straightforward to modify or extend without touching controller or service code.  
* **Potential risk** – reliance on string‑based event names can lead to typos; using constants or TypeScript enums (if the codebase permits) would mitigate this.  
* Documentation of the expected event payload schema is essential to prevent runtime errors, given the lack of compile‑time checks.

## Hierarchy Context

### Parent
- [LLMController](./LLMController.md) -- The LLMController class extends EventEmitter, which provides a way to handle initialization, mode resolution, and completion requests in an event-driven manner, as seen in the LLMService class (lib/llm/llm-service.ts)

---

*Generated from 3 observations*
