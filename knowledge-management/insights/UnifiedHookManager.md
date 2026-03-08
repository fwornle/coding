# UnifiedHookManager

**Type:** SubComponent

UnifiedHookManager may utilize a configuration loading mechanism, such as a config loader module, to load hook configurations from files or databases.

## What It Is  

UnifiedHookManager is the central hub for hook management inside the **ConstraintSystem** component. Its implementation lives in `lib/agent-api/hooks/hook-manager.js` and is driven by a configuration file named `hook‑manager.yaml`. The manager is responsible for loading hook configurations, caching validated definitions, registering handler functions for named hook events, and dispatching those events to the appropriate handlers. It is used by sibling sub‑components – **ConstraintMonitor**, **HookConfigurationManager**, and **ViolationCaptureModule** – all of which obtain a reference to the same manager instance to coordinate hook‑related work.

---

## Architecture and Design  

The observations point to a **modular design** where UnifiedHookManager encapsulates all hook‑related responsibilities behind a well‑defined API. The manager isolates three cross‑cutting concerns:

1. **Configuration loading** – a dedicated loader (likely a “config loader module”) reads `hook‑manager.yaml` (or a similar source) and produces a structured representation of hook definitions.  
2. **Caching** – a “cache module” stores the loaded and validated configuration, allowing subsequent look‑ups to avoid re‑reading the file or database.  
3. **Handler registry** – a native JavaScript `Map` holds arrays of handler functions keyed by event name, enabling O(1) registration and retrieval.

These concerns are combined in a single class (or module) that offers methods such as `registerHandler(eventName, handlerFn)` and an internal dispatch routine that iterates the `Map` for a given event. The use of a `Map` is a concrete design decision that favors fast look‑ups and deterministic ordering of insertion, which is important when many hooks may be attached to a single event.

Although the term “event‑driven” is not explicitly used in the observations, the pattern of **dispatch → handler registration** is evident and aligns with a classic publish/subscribe (pub/sub) style: the manager publishes hook events and subscribers (the sibling components) register callbacks. The manager also integrates a **logging mechanism** (via a logger module) to record registration, dispatch, and error events, supporting observability without coupling the core logic to any particular logging framework.

---

## Implementation Details  

### Core Data Structure  
- **`handlers: Map<string, Function[]>`** – Each key is a hook event identifier; the value is an array of handler functions. The `registerHandler(event, fn)` method pushes `fn` onto the array, creating a new entry if the event does not yet exist.

### Configuration Loading  
- The manager invokes a **config loader module** (exact name not given) to read `hook‑manager.yaml`. The loader parses the YAML into a JavaScript object describing which hooks are enabled, their priorities, and any static parameters.  
- After parsing, the manager validates the configuration (e.g., ensuring required fields exist) and then stores the result in the **cache module**. Subsequent calls to load configuration first check the cache, returning the cached object if present, thereby avoiding repeated I/O.

### Caching  
- The cache module provides simple `get(key)` / `set(key, value)` semantics. The manager uses a fixed cache key (e.g., `"hookConfig"`) to store the validated configuration object. This design reduces latency when many components request hook definitions during startup or runtime.

### Logging  
- Throughout registration and dispatch, the manager calls a **logger module** (e.g., `logger.info`, `logger.error`). Typical log messages include “Handler registered for event X”, “Dispatching event Y to N handlers”, and error traces when a handler throws.

### Public API (as inferred)  
```js
// lib/agent-api/hooks/hook-manager.js
class UnifiedHookManager {
  constructor() { /* loads config, populates cache, creates empty Map */ }
  registerHandler(eventName, handlerFn) { /* stores in handlers Map */ }
  dispatch(eventName, payload) { /* iterates handlers[eventName] and invokes each */ }
  getConfig() { /* returns cached configuration */ }
}
module.exports = new UnifiedHookManager(); // singleton used by siblings
```
While the exact method signatures are not listed in the observations, the presence of a `registerHandler` function is explicitly mentioned, and the surrounding description implies a complementary `dispatch` routine.

---

## Integration Points  

1. **Parent – ConstraintSystem** – UnifiedHookManager is a sub‑component of ConstraintSystem. The parent likely instantiates the manager (or imports the singleton) during its own initialization, ensuring the hook infrastructure is ready before any constraint logic runs.  

2. **Siblings** –  
   - **ConstraintMonitor** registers handlers for constraint‑violation events via `UnifiedHookManager.registerHandler`.  
   - **HookConfigurationManager** calls the manager’s configuration‑loading API to merge external hook definitions with the base `hook‑manager.yaml`.  
   - **ViolationCaptureModule** also registers its own violation‑handling callbacks. Because all three share the same manager instance, they automatically see each other’s registrations, enabling coordinated responses to the same hook event.  

3. **External Modules** – The manager depends on three auxiliary modules:  
   - **Config loader** (reads YAML or DB sources)  
   - **Cache** (stores the parsed configuration)  
   - **Logger** (records lifecycle events).  

These dependencies are injected or required directly inside `hook-manager.js`, keeping the manager’s core logic thin and focused on hook orchestration.

---

## Usage Guidelines  

- **Always register before dispatch** – Handlers should be added during the application start‑up phase (e.g., in the initialization code of ConstraintMonitor, HookConfigurationManager, or ViolationCaptureModule). Registering after a hook has already been dispatched may lead to missed events.  
- **Idempotent registration** – If a component may be re‑initialized, guard against duplicate registrations by checking whether the handler already exists in the `handlers` Map (or by using a unique identifier for each handler).  
- **Keep handlers lightweight** – Since the manager will invoke every registered function synchronously during dispatch, long‑running or blocking operations should be delegated to asynchronous workers to avoid delaying other handlers.  
- **Leverage the cache** – When accessing hook configuration, call the manager’s `getConfig()` method rather than reading the YAML file directly. This ensures the cached, validated version is used and prevents unnecessary I/O.  
- **Respect logging conventions** – Use the provided logger module for any diagnostic output inside custom handlers; this maintains a consistent log format across the system.  

---

### Architectural patterns identified  
1. **Modular component design** – UnifiedHookManager isolates hook logic behind a clean API.  
2. **Publish/Subscribe (pub/sub) style** – Handlers subscribe to named events; the manager publishes events to all subscribers.  
3. **Cache‑aside pattern** – Configuration is loaded once, validated, then cached for fast subsequent reads.  

### Design decisions and trade‑offs  
- **Map for handler storage** gives O(1) registration/retrieval but stores handlers in memory, which is acceptable for the typical number of hooks but could become a memory concern if thousands of handlers are registered.  
- **Centralized singleton** simplifies sharing across siblings but creates a single point of failure; any uncaught exception in a handler can affect the entire dispatch flow.  
- **YAML configuration** offers human‑readable settings but introduces a parsing step; caching mitigates the performance impact.  

### System structure insights  
UnifiedHookManager sits at the heart of the ConstraintSystem’s extensibility layer. Its sibling components each focus on a specific domain (monitoring, configuration merging, violation capture) but converge on the same hook manager, ensuring consistent behavior and reducing duplication of hook‑handling code.

### Scalability considerations  
- **Horizontal scaling** – Because the manager holds state in memory (handlers Map, cached config), each process instance maintains its own copy. In a multi‑process deployment, configuration must be kept in sync (e.g., by re‑loading the YAML file on change).  
- **Handler count** – The Map scales well up to tens of thousands of entries; beyond that, the cost of iterating all handlers during dispatch could become noticeable. Consider batching or prioritizing handlers if growth is anticipated.  

### Maintainability assessment  
The modular separation of concerns (configuration loading, caching, logging, handler registry) makes the codebase approachable. The explicit `registerHandler` API provides a clear contract for new components. However, the reliance on a singleton can make unit testing harder unless the manager is designed to allow injection of mock dependencies (config loader, cache, logger). Adding comprehensive unit tests around registration, dispatch ordering, and error handling will further improve maintainability.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component's architecture is designed with flexibility and customizability in mind, utilizing a modular design that allows for easy extension and modification. This is evident in the use of the UnifiedHookManager (lib/agent-api/hooks/hook-manager.js), which provides a central hub for hook management, handling hook event dispatch, handler registration, and configuration loading. The UnifiedHookManager uses a Map to store handlers for each event, allowing for efficient registration and retrieval of handlers. For example, the registerHandler function in hook-manager.js takes in an event name and a handler function, and stores them in the handlers Map for later retrieval.

### Siblings
- [ConstraintMonitor](./ConstraintMonitor.md) -- ConstraintMonitor uses the UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) to register handlers for constraint violation events.
- [HookConfigurationManager](./HookConfigurationManager.md) -- HookConfigurationManager uses the UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) to load and merge hook configurations.
- [ViolationCaptureModule](./ViolationCaptureModule.md) -- ViolationCaptureModule uses the UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) to register handlers for constraint violation events.


---

*Generated from 6 observations*
