# ConnectionManager

**Type:** SubComponent

The ConnectionManager is designed to be flexible, allowing for different connection methods to be used depending on the specific requirements of the Specstory extension.

## What It Is  

`ConnectionManager` is a **sub‑component** that lives inside the **Trajectory** component and is implemented in the file **`lib/integrations/specstory-adapter.js`**.  The file defines the `SpecstoryAdapter` class, which serves as the public entry point for all connection‑related activities.  `ConnectionManager` orchestrates the lifecycle of a connection to the Specstory extension, handling initialization, logging, retry logic, and the selection of the concrete transport (HTTP, IPC, file‑watch, etc.).  By delegating the low‑level work to its children—`ConnectionRetryHandler`, `ConnectionLogger`, and `SpecstoryAdapterIntegration`—the manager provides a clean, high‑level API that other parts of the system (e.g., `SpecstoryApiClient`, `ConversationLogger`, `RetryManager`, `SessionManager`) can consume.

The component is purpose‑built for **fault tolerance** and **observability**.  It uses a dedicated logger to create an audit trail for every connection attempt and failure, and it embeds a session identifier supplied by the extension API so that conversations can be correlated across retries and different transport mechanisms.  Its design is deliberately **flexible**, allowing the surrounding Trajectory system to switch between connection methods without changing the public `SpecstoryAdapter` interface.

---

## Architecture and Design  

The architecture that emerges from the observations is a **layered adapter‑centric** model.  At the outermost layer, the `SpecstoryAdapter` class acts as a **Facade** that presents a stable API to the rest of the codebase.  Internally, the manager composes three child components:

1. **`ConnectionRetryHandler`** – encapsulates the *retry‑with‑fallback* logic.  This implements a classic **Retry pattern**, attempting the primary connection method a configurable number of times before falling back to an alternative transport.  
2. **`ConnectionLogger`** – centralises all logging concerns, providing a consistent audit trail.  This is an example of the **Decorator/Logger pattern**, separating cross‑cutting concerns from business logic.  
3. **`SpecstoryAdapterIntegration`** – wires the `SpecstoryAdapter` to the concrete integration points (HTTP client, IPC channel, file‑watcher).  This follows the **Adapter pattern**, translating the generic connection contract into the specifics required by each transport.

Interaction flows are straightforward: a consumer (e.g., `SpecstoryApiClient`) calls a method on `SpecstoryAdapter`; the adapter delegates to `ConnectionRetryHandler` to obtain a live connection; each attempt is wrapped by `ConnectionLogger`, which records success or failure together with the current **session ID** obtained from the extension API.  If the primary method fails, `ConnectionRetryHandler` triggers the next fallback, preserving the same session context so that downstream components see a seamless conversation stream.

Because `ConnectionManager` lives inside **Trajectory**, it inherits the broader system’s emphasis on **extensibility**—different connection strategies can be added by extending `SpecstoryAdapterIntegration` without touching the manager’s core logic.  The sibling components (`SpecstoryApiClient`, `ConversationLogger`, `RetryManager`, `SessionManager`) share the same logger and session‑ID conventions, reinforcing a consistent cross‑component contract.

---

## Implementation Details  

All of the concrete code resides in **`lib/integrations/specstory-adapter.js`**.  The file exports the `SpecstoryAdapter` class, which exposes methods such as `initialize()`, `connect()`, and `logConversation()`.  During `initialize()`, the adapter creates a **session ID** via the extension API and stores it in an internal state object that is later passed to every logging call.

*Connection establishment* is mediated by `ConnectionRetryHandler`.  The handler maintains a list of candidate transports (e.g., `httpTransport`, `ipcTransport`, `fileWatchTransport`).  For each transport, it invokes a `tryConnect()` function; on failure, it records the error through `ConnectionLogger` and proceeds to the next candidate.  The number of attempts and back‑off strategy are configurable, allowing the system to balance latency against reliability.

`ConnectionLogger` wraps a generic logger instance (likely a Winston or Bunyan logger, though the exact library is not named) and prefixes every log entry with the current **session ID** and a connection‑specific tag (`[ConnMgr]`).  This makes it trivial to trace a conversation from start to finish, even when multiple retries occur.

`SpecstoryAdapterIntegration` is responsible for translating the generic connection contract into the specifics required by each transport.  For HTTP, it may construct request headers that embed the session ID; for IPC, it opens a named pipe identified by the session; for file‑watch, it creates a temporary file scoped to the session.  Because the integration logic lives in a separate class, adding a new transport (e.g., WebSocket) only requires implementing a new integration module and registering it in the transport list used by `ConnectionRetryHandler`.

The manager also collaborates with sibling components.  `SpecstoryApiClient` consumes the adapter’s `connect()` method to issue API calls; `ConversationLogger` reuses the same `ConnectionLogger` instance to log higher‑level conversation events; `RetryManager` supplies the retry configuration that `ConnectionRetryHandler` reads; `SessionManager` can regenerate or invalidate the session ID, which the adapter will pick up on the next initialization cycle.

---

## Integration Points  

`ConnectionManager` sits at the intersection of three major subsystems:

1. **Extension API** – The manager calls into the Specstory extension to obtain a **session ID** and to report connection status.  This API is the source of truth for conversation tracking.  
2. **Transport Layer** – Through `SpecstoryAdapterIntegration`, the manager plugs into concrete transport implementations (HTTP client, IPC channel, file‑watch).  Each transport is a separate module that adheres to a simple `connect()` contract.  
3. **Logging Infrastructure** – `ConnectionLogger` forwards all events to the central logger used throughout the codebase, ensuring that connection‑related logs appear alongside `ConversationLogger` and other audit trails.

Sibling components rely on the same session‑ID and logger conventions, which reduces duplication and guarantees that any audit or debugging effort can follow a request across component boundaries.  The parent component, **Trajectory**, invokes `ConnectionManager` during its own startup sequence to guarantee that a reliable Specstory connection is available before any milestone or workflow processing begins.

Because the manager’s public API is exposed via `SpecstoryAdapter`, external code does not need to know about the retry or integration details; it simply calls `adapter.connect()` and receives a ready‑to‑use connection object (or a promise that resolves when the connection is established).  This decoupling makes it straightforward to replace or mock the manager in unit tests.

---

## Usage Guidelines  

1. **Initialize before use** – Call `SpecstoryAdapter.initialize()` early in the application bootstrap (e.g., within the Trajectory startup routine).  This ensures that a valid session ID is generated and that the logger is primed.  
2. **Prefer the adapter’s API** – All callers should interact with the `SpecstoryAdapter` façade rather than reaching directly into `ConnectionRetryHandler` or `SpecstoryAdapterIntegration`.  This protects the system from future changes to retry policies or transport implementations.  
3. **Respect the retry configuration** – If a component needs a different retry behavior (e.g., more aggressive back‑off for critical operations), it should adjust the settings via the shared `RetryManager` rather than modifying the handler internals.  
4. **Log through the shared logger** – Use the same logger instance that `ConnectionLogger` employs.  Adding the `[ConnMgr]` tag manually is unnecessary; the logger will automatically attach the session ID and component tag.  
5. **Handle session lifecycle** – When a session expires or must be reset (e.g., after a major error), invoke `SessionManager.invalidateSession()` and then re‑run `SpecstoryAdapter.initialize()`.  This guarantees that subsequent connections are correlated with a fresh session identifier.

Following these conventions keeps the connection flow predictable, maintains a clean audit trail, and allows the system to scale its retry and transport strategies without breaking existing callers.

---

### Architectural Patterns Identified  

* **Facade (SpecstoryAdapter)** – Provides a simplified, stable interface to the rest of the system.  
* **Adapter (SpecstoryAdapterIntegration)** – Translates generic connection requests into transport‑specific calls.  
* **Retry/Fallback (ConnectionRetryHandler)** – Implements a configurable retry loop with alternative transports.  
* **Decorator/Logger (ConnectionLogger)** – Separates logging concerns from core connection logic.

### Design Decisions and Trade‑offs  

* **Separation of concerns** – By isolating retry, logging, and transport integration into distinct child components, the design improves testability and maintainability, at the cost of a slightly deeper call stack.  
* **Session‑ID coupling** – Embedding the session ID in every log entry gives excellent traceability but introduces a hard dependency on the extension API’s session generation; failures in session creation can halt the whole connection flow.  
* **Configurable transport list** – Flexibility to add new transports without touching the manager is a strong advantage, though it requires careful versioning of the transport contract to avoid runtime mismatches.

### System Structure Insights  

* **Parent‑child hierarchy** – Trajectory → ConnectionManager → (ConnectionRetryHandler, ConnectionLogger, SpecstoryAdapterIntegration).  
* **Sibling collaboration** – Shared logger, retry configuration, and session management create a cohesive ecosystem of components that all revolve around the same connection contract.  
* **Single source file** – All core classes reside in `lib/integrations/specstory-adapter.js`, making the sub‑component easy to locate but also concentrating responsibility in one module.

### Scalability Considerations  

* **Horizontal scaling** – Because each connection attempt is stateless aside from the session ID, multiple instances of Trajectory can run in parallel, each with its own `ConnectionManager`.  The session ID ensures logs remain distinguishable.  
* **Transport extensibility** – Adding high‑throughput transports (e.g., WebSocket) is straightforward; the retry handler will treat the new transport as another candidate, preserving existing fault‑tolerance semantics.  
* **Logging volume** – The detailed audit trail can generate large log volumes under heavy retry activity; downstream log aggregation should be sized accordingly.

### Maintainability Assessment  

The clear division into well‑named child components, coupled with a single façade, makes the codebase **highly maintainable**.  Changes to retry policy, logging format, or transport specifics are localized, reducing regression risk.  The main maintenance burden lies in keeping the transport contract synchronized across `SpecstoryAdapterIntegration` and any new transport modules.  Overall, the design balances flexibility, observability, and robustness without introducing unnecessary complexity.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component is a complex system that manages project milestones, GSD workflow, phase planning, and implementation task tracking. Its architecture involves utilizing various connection methods to integrate with the Specstory extension, including HTTP, IPC, and file watch. The component is implemented in the lib/integrations/specstory-adapter.js file and uses a logger to handle logging and errors. The SpecstoryAdapter class is the main entry point for this component, providing methods to initialize the connection, log conversations, and connect via different methods. The component's design allows for flexibility and fault tolerance, with multiple connection attempts and fallbacks in case of failures. The use of a session ID and extension API enables the component to track and manage conversations and logs effectively.

### Children
- [ConnectionRetryHandler](./ConnectionRetryHandler.md) -- The ConnectionRetryHandler would likely be implemented in the lib/integrations/specstory-adapter.js file, where the SpecstoryAdapter class is defined as the main entry point for connection management
- [ConnectionLogger](./ConnectionLogger.md) -- The ConnectionLogger would likely be integrated with the SpecstoryAdapter class in the lib/integrations/specstory-adapter.js file to log connection events
- [SpecstoryAdapterIntegration](./SpecstoryAdapterIntegration.md) -- The SpecstoryAdapterIntegration would be defined in the lib/integrations/specstory-adapter.js file, where the SpecstoryAdapter class is imported and configured

### Siblings
- [SpecstoryApiClient](./SpecstoryApiClient.md) -- SpecstoryApiClient uses the extension API to interact with the Specstory extension, as defined in the lib/integrations/specstory-adapter.js file.
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger uses the logger to handle logging and errors, providing a clear audit trail for conversations and logs.
- [RetryManager](./RetryManager.md) -- RetryManager uses a retry mechanism to retry connections in case of failures, as implemented in the lib/integrations/specstory-adapter.js file.
- [SessionManager](./SessionManager.md) -- SessionManager uses a session ID to track and manage conversations and logs effectively, as seen in the lib/integrations/specstory-adapter.js file.


---

*Generated from 5 observations*
