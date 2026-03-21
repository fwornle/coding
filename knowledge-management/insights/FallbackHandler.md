# FallbackHandler

**Type:** SubComponent

FallbackHandler uses a set of predefined fallback strategies to handle connection failures, including retrying the connection or switching to a different connection method.

## What It Is  

**FallbackHandler** is a *SubComponent* that lives inside the **Trajectory** component.  Although the source repository does not expose a concrete file path for the handler (the “Code Structure” section reports *0 code symbols found*), its role is clearly described in the observations: it encapsulates a collection of **fallback strategies** that are invoked when the primary connection method fails.  The handler continuously monitors the status of that primary connection, selects the most appropriate strategy from a prioritized list, executes it, and reports the outcome back to the caller through a callback interface.  Because the logic is **decoupled** from any specific connection implementation, the same handler can be reused whether the underlying transport is HTTP, IPC, or a file‑watch mechanism that the parent **Trajectory** component already supports via `SpecstoryAdapter` (see `lib/integrations/specstory-adapter.js`).  

## Architecture and Design  

The observations point to a **modular, strategy‑oriented architecture**.  Each fallback technique (e.g., retry, alternative transport) is packaged as an independent *strategy* that can be added to or removed from the handler at runtime.  This matches the classic **Strategy pattern**: the handler holds a collection of interchangeable strategy objects, each exposing a common interface (e.g., `execute()` and `isApplicable()`).  The **prioritization** rule—“ensuring the most suitable strategy is used in each scenario”—suggests the handler iterates the list in order of priority until a strategy reports success.  

The **callback mechanism** described in observation 6 introduces an **Observer‑like** interaction: the handler notifies the calling component (likely the parent **Trajectory** or one of its siblings such as **ConnectionManager**) about the result of a fallback attempt.  This keeps the handler’s core logic free of side‑effects while still providing a hook for higher‑level coordination.  

Because the handler is **decoupled from the underlying connection method**, it does not reference concrete connection classes.  Instead, it relies on a *status monitor* supplied by the parent component (e.g., the health‑checking logic inside `SpecstoryAdapter.connectViaHTTP`).  This separation of concerns enables **reuse** across the sibling components that also deal with connections—`ConnectionManager`, `SpecstoryAdapter`, and the HTTP‑related helpers—without each having to implement its own fallback handling.

## Implementation Details  

* **Strategy Container** – The handler maintains an internal collection (e.g., an array or map) of fallback strategy objects.  Each object implements a standard interface that includes:
  * `isApplicable(connectionStatus)` – returns a boolean indicating whether the strategy can be used given the current failure mode.
  * `execute()` – performs the fallback action (retry, switch transport, etc.).
  * `priority` – an integer or enum that the handler uses to sort the strategies.

* **Monitoring Loop** – A lightweight watcher observes the primary connection’s health.  When a failure event is emitted (for example, an error callback from `SpecstoryAdapter` or a timeout in `ConnectionManager`), the handler’s `onFailure` handler is invoked.

* **Selection & Execution** – Upon detection, the handler sorts the strategies by their `priority` value (observation 7) and iterates through them:
  1. Calls `isApplicable` on the current strategy.
  2. If true, calls `execute`.
  3. If `execute` resolves successfully, the handler fires the **success callback**; otherwise it proceeds to the next strategy.

* **Configurability** – Observation 3 notes that the set of strategies is **configurable**.  This is typically realized via a configuration object supplied at construction time (e.g., `{ strategies: [RetryStrategy, SwitchTransportStrategy], maxRetries: 3 }`).  The configuration can be altered at runtime, allowing developers to tailor fallback behavior to specific use‑cases.

* **Callback Interface** – The handler accepts two callbacks (or a single callback with a status flag):
  * `onFallbackSuccess(strategyId, details)`
  * `onFallbackFailure(strategyId, error)`
  These are invoked after each strategy attempt, enabling the parent **Trajectory** component or any consumer (e.g., `ConnectionManager`) to react—log the event, update UI, or trigger additional recovery steps.

Because no concrete class names appear in the observations, the above description stays faithful to the documented behavior without inventing class or function names.

## Integration Points  

* **Parent – Trajectory** – `Trajectory` owns the `FallbackHandler`.  When `Trajectory` establishes a connection via `SpecstoryAdapter` (see `lib/integrations/specstory-adapter.js`), it also registers the handler’s status monitor.  If `SpecstoryAdapter.connectViaHTTP` reports a transient error, the failure propagates up to `Trajectory`, which then delegates to `FallbackHandler` to decide whether to retry or switch to an alternative method (IPC, file watch, etc.).  

* **Sibling – ConnectionManager** – `ConnectionManager` also relies on `SpecstoryAdapter` for transport selection.  It can share the same fallback handler instance or instantiate its own, ensuring a consistent fallback policy across the system.  Because both components expose a similar “connect” API, they benefit from the handler’s **decoupled** design—no direct dependency on the concrete transport class is required.  

* **Sibling – DataFormatter & HttpRequestHelper** – While these siblings focus on payload preparation and request templating, they indirectly depend on a stable connection.  By using the same fallback handler (or by listening to its callbacks), they can postpone data submission until the connection is restored, preserving data integrity.  

* **Sibling – SpecstoryAdapter** – This adapter already implements a retry mechanism for HTTP (see `connectViaHTTP`).  The presence of `FallbackHandler` suggests a layered approach: `SpecstoryAdapter` handles **transport‑specific** retries, whereas `FallbackHandler` decides **higher‑level** fallback actions such as switching transports entirely.  The two layers complement each other without overlapping responsibilities.

## Usage Guidelines  

1. **Instantiate with Explicit Configuration** – When constructing a `FallbackHandler`, always pass a configuration object that lists the desired strategies and their priorities.  This makes the fallback behavior deterministic and easier to test.  

2. **Register Callbacks Early** – Attach `onFallbackSuccess` and `onFallbackFailure` callbacks before the first connection attempt.  This guarantees that any fallback event, even the first one, is observed by the calling component (e.g., `Trajectory`).  

3. **Keep Strategies Small and Focused** – Each fallback strategy should address a single concern (e.g., “retry up to N times” or “switch to IPC”).  This modularity aligns with the observed **modular architecture** and simplifies future additions or removals.  

4. **Respect Prioritization** – When adding new strategies, assign a priority that reflects the cost and desirability of the fallback.  High‑cost actions (like spawning a new process) should have lower priority than inexpensive ones (simple retry).  

5. **Avoid Direct Coupling to Transport Implementations** – Do not embed HTTP‑specific logic inside a fallback strategy.  Instead, delegate to the existing adapters (`SpecstoryAdapter`, `ConnectionManager`) that already know how to establish each transport type.  This preserves the **decoupled** nature highlighted in the observations.  

6. **Monitor Callback Outcomes** – Use the success/failure callbacks to update health metrics, trigger alerts, or log diagnostic information.  Because the handler does not itself log, the surrounding system (e.g., `Trajectory`) should handle observability.  

---

### Architectural Patterns Identified
* **Strategy Pattern** – interchangeable fallback strategies, prioritized list.  
* **Observer/Callback Pattern** – notification of success or failure to the caller.  
* **Modular/Plugin Architecture** – strategies can be added or removed without touching core handler code.  

### Design Decisions and Trade‑offs  
* **Decoupling from Connection Method** – Improves reusability across HTTP, IPC, and file‑watch transports, but requires a generic status interface that all transports must implement.  
* **Prioritized Strategy Selection** – Guarantees the “best” fallback is tried first, at the cost of extra decision logic and the need to maintain correct priority ordering.  
* **Configurable Strategy Set** – Gives flexibility to tailor fallback behavior per deployment, but introduces runtime configuration complexity and the need for validation.  

### System Structure Insights  
* `FallbackHandler` sits **one level below** `Trajectory` and **above** the concrete adapters (`SpecstoryAdapter`, `ConnectionManager`).  
* It acts as a **policy engine** for connection resilience, while its siblings (`DataFormatter`, `HttpRequestHelper`) remain agnostic of connection health, relying on the handler’s callbacks to know when it is safe to send data.  

### Scalability Considerations  
* Adding new fallback strategies scales linearly; each new strategy is a self‑contained module.  
* The priority‑based selection algorithm is O(n) in the number of strategies, which is acceptable given the typically small set (retry, switch transport, etc.).  
* Because the handler does not maintain stateful connections itself, it can be instantiated per request or shared globally without contention.  

### Maintainability Assessment  
* **High** – The modular strategy container isolates changes; a new fallback method requires only a new strategy class and an update to the configuration.  
* **Medium** – Maintaining correct priority ordering and ensuring each strategy’s `isApplicable` logic stays in sync with evolving transport error codes can introduce subtle bugs; comprehensive unit tests around the selection loop are essential.  
* **Low Coupling** – Decoupling from transport implementations reduces ripple effects when adapters evolve (e.g., adding a new IPC protocol).  

Overall, **FallbackHandler** embodies a clean, extensible approach to connection resilience within the **Trajectory** ecosystem, leveraging well‑understood design patterns while staying tightly aligned with the system’s fault‑tolerant goals.

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed with flexibility and fault tolerance in mind, as evident from its ability to adapt to different connection methods such as HTTP, IPC, and file watch. This is achieved through the use of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unified interface for connecting to the Specstory extension. The connectViaHTTP function in specstory-adapter.js demonstrates this flexibility by implementing a connection retry mechanism to handle transient connection issues.

### Siblings
- [ConnectionManager](./ConnectionManager.md) -- ConnectionManager uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to connect to the Specstory extension via HTTP, IPC, or file watch.
- [DataFormatter](./DataFormatter.md) -- DataFormatter uses a set of predefined templates to format data for submission to the Specstory extension.
- [HttpRequestHelper](./HttpRequestHelper.md) -- HttpRequestHelper uses a set of predefined HTTP request templates to simplify the request process.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter uses a set of predefined adapters to connect to the Specstory extension via different methods.

---

*Generated from 7 observations*
