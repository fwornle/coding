# HookManager

**Type:** SubComponent

The HookManager employs a priority-based hook execution mechanism in hook-executor.ts to ensure consistent hook ordering.

## What It Is  

HookManager is the **sub‑component that orchestrates the lifecycle of “hooks”** – lightweight callbacks that other parts of the platform can register and be notified about. All of its core files live alongside the other constraint‑system utilities: the registration logic resides in **`hook-registry.ts`**, the execution engine in **`hook-executor.ts`**, debugging helpers in **`hook-debugger.ts`**, and the central metadata store in **`hook-metadata.ts`**. By being embedded inside the **ConstraintSystem** component, HookManager supplies the event‑driven glue that lets sibling modules such as **ContentValidator**, **ViolationDetector**, and **AgentManager** react to domain‑specific changes without tight coupling.

The manager’s public API is centered on a **`triggerHook`** function that receives a hook identifier and an optional payload, then routes the call through the registration and execution pipeline. Hook registration is modular: any module can import `hook-registry.ts` and declare a listener together with a priority value. The metadata repository (`hook-metadata.ts`) records each listener’s configuration, enabling later introspection, debugging, and ordered execution.

In practice, when the **ContentValidator** updates an entity’s content, it asks HookManager to fire the *“content‑updated”* hook. HookManager looks up the registered listeners, orders them by priority (via the executor), and invokes each listener in turn. If a developer needs to troubleshoot a misbehaving hook, the **hook‑debugger.ts** utilities expose a transparent view of the registration state and execution trace.

---

## Architecture and Design  

HookManager follows a **modular registration + priority‑based execution** architecture. The registration module (`hook-registry.ts`) acts as a simple in‑memory catalog that maps hook names to an array of listener descriptors. Each descriptor contains a reference to the callback function, a numeric **priority**, and any static metadata required for debugging. This design mirrors the *Observer* pattern but adds explicit ordering, which is essential for deterministic constraint processing.

The **event‑driven dispatch** is implemented by the `triggerHook` function. Rather than broadcasting events through a global event bus, HookManager directly queries the registry, hands the ordered list to **`hook-executor.ts`**, and executes listeners synchronously (or asynchronously if the listener returns a promise). The executor’s priority algorithm guarantees that higher‑priority hooks run before lower‑priority ones, ensuring that, for example, validation hooks can pre‑empt violation‑detection hooks.

A dedicated **debugging layer** (`hook-debugger.ts`) reads the same metadata repository used by the registry, exposing methods such as `listRegisteredHooks()`, `inspectListener(id)`, and `traceExecution(hookName)`. This keeps debugging concerns separate from core registration/execution logic, adhering to the *Separation of Concerns* principle.

Finally, the **metadata repository** (`hook-metadata.ts`) is the single source of truth for hook configuration. By persisting registration data in a structured object (rather than scattering it across disparate modules), HookManager enables introspection, future persistence extensions, and potential static analysis tools.

---

## Implementation Details  

1. **`hook-registry.ts`** – Exposes functions `registerHook(name: string, listener: HookListener, priority?: number)` and `unregisterHook(id: string)`. Internally it maintains a `Map<string, HookDescriptor[]>` where each `HookDescriptor` holds `{ id, listener, priority, sourceFile }`. Registration validates that the same listener isn’t added twice and assigns a unique identifier used later for debugging or removal.

2. **`hook-executor.ts`** – Contains the core `executeHooks(name: string, payload: any)` routine. It retrieves the descriptor array from the registry, sorts it descending by `priority` (fallback to registration order), and iterates over the list. Execution respects async semantics: if a listener returns a promise, the executor `await`s it before moving to the next hook, guaranteeing ordered completion. Errors are caught and logged, preventing a single faulty hook from breaking the entire chain.

3. **`hook-debugger.ts`** – Provides a suite of utilities:  
   * `dumpRegistry()` – prints the full registration map.  
   * `getListenerInfo(id)` – returns the stored metadata for a particular listener.  
   * `enableTracing(name?)` – toggles console tracing for a specific hook or globally, showing start/end timestamps and payload snapshots.  
   These helpers read directly from the same structures used by the registry, ensuring no stale state.

4. **`hook-metadata.ts`** – Acts as a thin wrapper around a plain JavaScript object that stores static configuration (e.g., default priorities, deprecation flags). It also offers `loadMetadata()` and `saveMetadata()` stubs, hinting at future persistence (perhaps via the **GraphDatabaseAdapter** used by sibling components).

5. **`triggerHook`** – Defined in the public HookManager façade (likely `index.ts` or a dedicated entry file). It validates the hook name, optionally enriches the payload with system context (e.g., current transaction ID), and forwards the call to `hook-executor.ts`. Because it lives inside the **ConstraintSystem** boundary, other modules like **ContentValidator** can import it without needing to know the internal registry layout.

The overall flow is therefore: **register → store metadata → trigger → executor sorts by priority → invoke listeners → optional debugging output**.

---

## Integration Points  

HookManager is tightly coupled to its **parent component, ConstraintSystem**, which orchestrates the broader constraint‑processing pipeline. When ConstraintSystem processes a new or updated constraint, it often needs to inform other subsystems; it does so by calling `triggerHook`.  

* **ContentValidator** – Calls `triggerHook('content-updated', { entityId, newContent })` after persisting a change. The validator itself also registers hooks (e.g., `validateBeforeSave`) with a high priority so that validation runs before any downstream persistence hooks.  

* **ViolationDetector** – Listens for the same `content-updated` hook but with a lower priority, allowing it to react only after validation has succeeded.  

* **GraphDatabaseManager**, **ConstraintMetadataManager**, and **AgentManager** – While they do not directly fire hooks, they share the same **GraphDatabaseAdapter** and **metadata-repository.ts** patterns, suggesting that HookManager could later store hook registration data in the same graph store for persistence or distributed coordination.  

* **Debugging and Testing** – Test suites for any sibling component can import `hook-debugger.ts` to assert that the expected hooks were fired and in the correct order, reinforcing a contract‑first integration style.

All interactions are mediated through **type‑safe function calls** (e.g., `registerHook`, `triggerHook`) rather than shared global variables, which keeps the dependency graph shallow and eases unit testing.

---

## Usage Guidelines  

1. **Register Early, Prioritize Thoughtfully** – Modules should register their hooks during initialization (e.g., in a `setup()` function) and assign explicit priority values. High‑priority hooks (e.g., validation, security checks) must use lower numeric values if the executor sorts ascending, or higher values if descending—consult `hook-executor.ts` to confirm the sort direction.  

2. **Keep Listeners Pure and Fast** – Because HookManager executes listeners sequentially and awaits async results, a slow listener blocks all subsequent hooks. If a hook performs I/O, make it async and return a promise; otherwise, keep the logic lightweight to avoid latency spikes in the constraint pipeline.  

3. **Leverage the Debugger** – During development, enable tracing via `hook-debugger.ts` to verify registration order and payload integrity. The debugger reads directly from the shared metadata, so no extra instrumentation is required.  

4. **Handle Errors Gracefully** – Listeners should catch their own errors when possible. HookManager will log uncaught exceptions and continue processing, but swallowing errors early prevents noisy logs and unintended side effects.  

5. **Avoid Circular Registrations** – Since hooks can trigger other hooks, be mindful of potential recursion. The executor does not currently detect cycles; design your hook graph to be acyclic or implement guard logic in the listener itself.  

6. **Future Persistence** – If you need hook registration to survive restarts, consider extending `hook-metadata.ts` to persist the registry via the GraphDatabaseAdapter used by the ConstraintSystem. Until that feature is stable, treat registration as in‑memory only.

---

### Architectural Patterns Identified  

* **Observer / Pub‑Sub** – Modular registration of listeners that are notified on demand.  
* **Priority Queue Execution** – Deterministic ordering of listeners based on explicit priority values.  
* **Separation of Concerns** – Distinct modules for registration (`hook-registry.ts`), execution (`hook-executor.ts`), debugging (`hook-debugger.ts`), and metadata storage (`hook-metadata.ts`).  

### Design Decisions & Trade‑offs  

* **In‑Memory Registry** – Simplicity and low latency, at the cost of losing state across process restarts.  
* **Synchronous Ordering with Async Support** – Guarantees order but can introduce latency if a high‑priority listener is slow; developers must write non‑blocking listeners.  
* **Dedicated Debugger** – Improves developer experience but adds extra runtime code that must be kept in sync with the registry structures.  

### System Structure Insights  

HookManager sits one level below **ConstraintSystem** and shares the same architectural philosophy as its siblings: a thin façade that delegates to specialized adapters (graph database, metadata repository). The common use of a metadata repository across components hints at a unified configuration model that could be leveraged for cross‑component introspection.

### Scalability Considerations  

Because the registry is a simple `Map` and execution is linear, HookManager scales well for a modest number of hooks (tens to low‑hundreds). If the system grows to thousands of listeners per hook, the sorting step in `hook-executor.ts` may become a bottleneck, and a more sophisticated priority queue or pre‑sorted registration list could be introduced. Additionally, the current design assumes a single Node.js process; distributed execution would require persisting registration data and possibly sharding hook handling across workers.

### Maintainability Assessment  

The clear separation into four purpose‑driven files makes the codebase easy to navigate and test. The reliance on plain objects and TypeScript types reduces cognitive load. However, the lack of persistence and cycle detection are potential maintenance risks as the hook graph becomes more complex. Adding unit tests around registration, priority ordering, and error handling, together with the existing debugger utilities, should keep the component maintainable as it evolves.


## Hierarchy Context

### Parent
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and managing constraint metadata. This allows for efficient persistence and retrieval of constraint data, leveraging the capabilities of Graphology and LevelDB. The automatic JSON export sync feature ensures that the data remains consistent and up-to-date. Furthermore, the GraphDatabaseAdapter provides a flexible and scalable solution for handling large amounts of constraint metadata, making it an ideal choice for the ConstraintSystem.

### Siblings
- [ContentValidator](./ContentValidator.md) -- ContentValidator utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve validation metadata.
- [ViolationDetector](./ViolationDetector.md) -- ViolationDetector uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve violation metadata.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the LevelDB database in leveldb-database.ts to store graph data.
- [ConstraintMetadataManager](./ConstraintMetadataManager.md) -- ConstraintMetadataManager uses a metadata repository in metadata-repository.ts to store constraint configuration and registration data.
- [AgentManager](./AgentManager.md) -- AgentManager uses an agent repository in agent-repository.ts to store agent configuration and registration data.


---

*Generated from 6 observations*
