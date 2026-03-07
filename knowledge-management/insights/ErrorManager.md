# ErrorManager

**Type:** SubComponent

The retryConnection method (lib/error-manager.js:150) attempts to reconnect to the Specstory extension after a disconnection event

## What It Is  

`ErrorManager` lives in the **lib/error‑manager.js** file and is the dedicated sub‑component that governs all error‑related concerns for the **Trajectory** component.  It is instantiated by the parent **Trajectory** (see the hierarchy context) and, in turn, composes the **ErrorHandler** module that is imported from **lib/error‑handler.js**.  Its public surface includes a `handleError` method (implemented at line 100) that captures runtime exceptions and disconnection events, a `retryConnection` method (line 150) that attempts to re‑establish the link with the Specstory extension, and a notification routine located around line 50 that pushes user‑visible messages.  The class also exposes a configurable retry policy, allowing callers to tailor how aggressively the system should attempt reconnection after a failure.

---

## Architecture and Design  

The observations reveal a **strategy‑pattern** implementation: `ErrorManager` delegates the concrete handling of distinct error categories to interchangeable strategy objects housed in the `ErrorHandler` module.  By encapsulating each error‑type logic behind a common interface, the manager can switch or extend handling behavior without touching its own core flow.  

`ErrorManager` follows a **composition‑over‑inheritance** approach.  Rather than inheriting error logic, it **contains** an `ErrorHandler` instance, keeping the responsibilities cleanly separated: the manager orchestrates when to act (e.g., on a disconnection), while the handler knows *how* to process a specific error.  This separation is evident from the relationship “ErrorManager contains ErrorHandler” and the import statement in **lib/error‑manager.js** that brings in **lib/error‑handler.js**.  

The component also exhibits a **notification façade**.  The notification system (around line 50) abstracts the user‑facing feedback mechanism, allowing the same error‑handling flow to surface messages through UI dialogs, console logs, or other channels without the manager needing to know the delivery details.  This façade is a classic example of the **Facade pattern**, simplifying a potentially complex subsystem (the UI notification stack) behind a single method call.  

Finally, the retry logic (`retryConnection` at line 150) demonstrates a **policy‑driven** design.  The manager does not hard‑code retry intervals or limits; instead, it reads a configurable retry policy supplied by the caller.  This decision enables flexible tuning for different deployment contexts (e.g., development vs. production) while keeping the retry algorithm itself straightforward.

---

## Implementation Details  

The core of `ErrorManager` is a class defined in **lib/error‑manager.js**.  Its constructor creates an instance of the `ErrorHandler` module (imported from **lib/error‑handler.js**) and stores any supplied retry‑policy configuration.  

* **handleError (line 100)** – This method is the entry point for all error events.  It first classifies the incoming error, then forwards it to the appropriate strategy object within `ErrorHandler`.  After processing, it invokes the notification façade (line 50) to inform the user.  When the error type indicates a loss of connectivity, `handleError` triggers the `retryConnection` routine.  

* **notification system (line 50)** – A lightweight wrapper that abstracts the actual UI or logging mechanism.  The code calls a method such as `notifyUser(message, type)`; the underlying implementation can be swapped (e.g., toast, modal, CLI output) without affecting the error‑handling flow.  

* **retryConnection (line 150)** – Implements a loop (or recursive call) that respects the configured retry policy (max attempts, back‑off interval).  Each attempt re‑invokes the connection logic provided by the sibling **SpecstoryConnector** (which itself uses `SpecstoryAdapter`).  If reconnection succeeds, the manager clears any pending error state; otherwise, it continues until the policy expires, at which point a final notification is emitted.  

* **Configurable retry policy** – Exposed through a public setter or constructor parameter, this object typically contains fields like `maxAttempts`, `initialDelayMs`, and `backoffFactor`.  The manager reads these values each time `retryConnection` runs, making the behavior data‑driven rather than hard‑coded.  

The `ErrorHandler` child module encapsulates the concrete strategies (e.g., `NetworkErrorStrategy`, `ValidationErrorStrategy`).  Each strategy implements a common interface—perhaps a `process(error)` method—allowing `ErrorManager` to treat them uniformly.

---

## Integration Points  

`ErrorManager` is tightly coupled to its parent **Trajectory**.  Trajectory creates the manager to guard all communication with the Specstory extension, and it relies on the manager’s `handleError` callback to surface problems that arise during connection attempts performed by sibling components such as **SpecstoryConnector** and **ConnectionMonitor**.  The **ConnectionMonitor** (using `lib/heartbeat.js`) can emit a disconnection event that is routed to `ErrorManager.handleError`, which then decides whether to invoke `retryConnection`.  

The retry mechanism directly interacts with **SpecstoryConnector**.  The connector’s methods—`connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`—are invoked by `retryConnection` to re‑establish the link.  Because these methods reside in **lib/integrations/specstory‑adapter.js**, the manager indirectly depends on the adapter’s API contract.  

On the notification side, the façade may depend on a generic UI utility or logging library (not explicitly listed, but inferred from the notification call at line 50).  This dependency is deliberately abstracted so that changes to the UI stack do not ripple into the error‑handling core.  

Finally, the configurable retry policy can be supplied by higher‑level configuration files or by the **Trajectory** component at runtime, making the manager’s behavior adaptable without code changes.

---

## Usage Guidelines  

1. **Instantiate via Trajectory** – Developers should let the **Trajectory** component create the `ErrorManager`; manual instantiation bypasses the intended composition with `ErrorHandler` and may miss parent‑level configuration.  

2. **Supply a sensible retry policy** – When configuring the manager, provide values that balance user experience and resource consumption.  For production, a modest `maxAttempts` (e.g., 3–5) with exponential back‑off is recommended; in development, a higher limit can aid debugging.  

3. **Do not call `handleError` directly for expected flow** – The method is intended for exceptional conditions (network loss, validation failures).  Normal operation should rely on return codes or promises from the connector; only catch thrown errors and forward them to `ErrorManager.handleError`.  

4. **Extend error handling via `ErrorHandler`** – If a new error category emerges (e.g., authentication timeout), add a new strategy class in **lib/error‑handler.js** that implements the shared interface.  Register the strategy with the manager’s internal map; no changes to `ErrorManager` itself are required.  

5. **Respect the notification contract** – The notification façade expects a message string and a severity level.  Use the defined severity enums (e.g., `INFO`, `WARN`, `ERROR`) to ensure consistent UI rendering across the application.  

---

### Architectural patterns identified  

1. **Strategy Pattern** – `ErrorManager` delegates to interchangeable error‑handling strategies housed in `ErrorHandler`.  
2. **Facade Pattern** – The notification system abstracts the underlying user‑feedback mechanisms.  
3. **Composition over Inheritance** – `ErrorManager` contains an `ErrorHandler` instance rather than inheriting its behavior.  
4. **Policy‑Driven Design** – Retry behavior is governed by a configurable retry policy.

### Design decisions and trade‑offs  

* **Separation of concerns** – By extracting concrete error logic into `ErrorHandler`, the manager stays lightweight and easier to test.  The trade‑off is an extra indirection layer that can add minimal runtime overhead.  
* **Configurable retry policy** – Provides flexibility but requires callers to understand and correctly set policy parameters; misconfiguration could lead to excessive reconnection attempts.  
* **Notification façade** – Shields error handling from UI changes, improving modularity, yet it introduces a dependency on a stable façade contract; breaking changes to the façade would affect all error pathways.  
* **Strategy registration** – Adding new strategies is straightforward, but the manager must maintain a registry; forgetting to register a new strategy could result in unhandled errors.

### System structure insights  

`ErrorManager` sits at the intersection of the **Trajectory** parent and several siblings that manage connectivity and logging.  Its child, `ErrorHandler`, encapsulates the polymorphic behavior required for diverse error types.  The overall hierarchy is:

```
Trajectory
 ├─ ErrorManager (lib/error-manager.js)
 │    └─ ErrorHandler (lib/error-handler.js)  ← strategy implementations
 ├─ SpecstoryConnector (uses SpecstoryAdapter)
 ├─ ConversationLogger (uses lib/logging/logger.js)
 └─ ConnectionMonitor (uses lib/heartbeat.js)
```

This layout emphasizes a clear vertical separation (parent → manager → handler) and horizontal collaboration among siblings via shared events (e.g., disconnections).

### Scalability considerations  

Because error handling is strategy‑based and policy‑driven, the component scales well as the number of error types grows; new strategies can be added without affecting existing code paths.  The retry logic runs synchronously within the manager; in high‑concurrency scenarios, care must be taken to avoid blocking the event loop—future extensions could offload retries to a background worker or use async/await with non‑blocking timers.  The notification façade, if backed by a heavy UI library, could become a bottleneck under bursty error conditions; ensuring it remains lightweight (e.g., debouncing rapid notifications) will preserve scalability.

### Maintainability assessment  

`ErrorManager` exhibits strong maintainability traits:

* **Modular design** – Clear boundaries between orchestration (`ErrorManager`), concrete handling (`ErrorHandler`), and user feedback (notification façade).  
* **Low coupling** – Interacts with siblings through well‑defined interfaces (connector methods, heartbeat events) and does not embed connector logic.  
* **High cohesion** – All responsibilities revolve around error detection, classification, user notification, and reconnection, avoiding unrelated concerns.  
* **Extensibility** – Adding new error strategies or altering retry policies requires minimal changes, mostly confined to configuration or the `ErrorHandler` module.  

Potential maintenance risks include the need to keep the strategy registry synchronized with the actual strategy implementations and ensuring that the notification façade contract remains stable across UI updates. Regular unit tests for each strategy and integration tests covering the retry workflow will mitigate regression risk.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed with flexibility in mind, allowing it to connect to the Specstory extension via multiple methods including HTTP, IPC, or file watch. This is evident in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js), which provides methods such as connectViaHTTP, connectViaIPC, and connectViaFileWatch for establishing connections. For instance, the connectViaHTTP method (lib/integrations/specstory-adapter.js:123) enables connection to the Specstory extension via HTTP on common extension ports, demonstrating the component's ability to adapt to different integration scenarios.

### Children
- [ErrorHandler](./ErrorHandler.md) -- The error handling module is imported from lib/error-handler.js, indicating a separate module for error handling

### Siblings
- [SpecstoryConnector](./SpecstoryConnector.md) -- SpecstoryConnector uses the SpecstoryAdapter class (lib/integrations/specstory-adapter.js) to provide methods such as connectViaHTTP, connectViaIPC, and connectViaFileWatch for establishing connections
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger utilizes a logging module (lib/logging/logger.js) to write conversation logs to a file or database
- [ConnectionMonitor](./ConnectionMonitor.md) -- ConnectionMonitor utilizes a heartbeat mechanism (lib/heartbeat.js) to detect disconnections


---

*Generated from 7 observations*
