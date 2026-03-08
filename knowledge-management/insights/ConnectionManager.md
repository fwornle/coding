# ConnectionManager

**Type:** SubComponent

The connectViaHTTP method in lib/integrations/specstory-adapter.js uses a specific backoff strategy to handle connection failures, ensuring efficient reconnection attempts.

## What It Is  

**ConnectionManager** is a sub‑component that lives inside the *Trajectory* component. Its implementation is centred in the file **`lib/integrations/specstory-adapter.js`**, where the **`SpecstoryAdapter`** class houses the core logic. Within this class the **`connectViaHTTP`** method embodies the ConnectionManager’s responsibility: providing a flexible, retry‑aware way to establish a link to the Specstory extension. The sub‑component also owns the **`HTTPConnectionHandler`** child, which encapsulates the low‑level HTTP‑specific handling required by the manager.

## Architecture and Design  

The architecture exposed by the observations is deliberately **modular**. *Trajectory* delegates all Specstory‑related communication to the **SpecstoryAdapter**, and the **ConnectionManager** sits as a thin orchestration layer that selects among the available connection strategies (HTTP, IPC, file‑watch). This is an instance of the **Facade** style: the ConnectionManager presents a single, unified interface while the underlying **SpecstoryAdapter** hides the complexity of the multiple protocols.

A key design pattern that surfaces is the **retry‑with‑backoff** strategy. The `connectViaHTTP` method implements this pattern explicitly, using a backoff algorithm to space out reconnection attempts after a failure. This pattern is also reflected in the sibling **RetryMechanism** component, which shares the same backoff logic, reinforcing a consistent error‑recovery approach across the system.

Flexibility is achieved through **Strategy‑like** separation of connection methods. Although not named as a formal Strategy pattern in the source, the existence of distinct connection pathways (HTTP, IPC, file‑watch) that can be chosen at runtime gives the system the ability to adapt to different deployment environments without altering the higher‑level logic.

## Implementation Details  

The heart of the ConnectionManager is the **`SpecstoryAdapter`** class in `lib/integrations/specstory-adapter.js`. Within this class:

* **`connectViaHTTP`** – Implements the retry‑with‑backoff algorithm. On each attempt it tries to open an HTTP channel to the Specstory extension; if the attempt fails, it waits for a backoff interval that grows (typically exponentially) before retrying. This ensures the component can survive transient network glitches while avoiding tight retry loops that could overwhelm the network or the remote service.

* **Unified Interface** – The adapter exposes a single entry point for all connection types, allowing callers (including the **ConnectionManager** and its child **HTTPConnectionHandler**) to invoke the same high‑level method regardless of the underlying transport. This reduces coupling between the manager and the specifics of each protocol.

* **`HTTPConnectionHandler`** – As a child component, it encapsulates the low‑level details of constructing HTTP requests, handling responses, and exposing the result back to the manager. The handler relies on the retry‑with‑backoff logic supplied by `connectViaHTTP`, meaning it does not implement its own retry loop but delegates to the shared mechanism.

The sibling **LoggingMechanism** interacts with the same `SpecstoryAdapter` via the `logConversation` method (also defined in `specstory-adapter.js`). This shared usage demonstrates that the adapter is a central hub not only for connectivity but also for ancillary services such as logging.

## Integration Points  

* **Parent – Trajectory**: Trajectory contains the ConnectionManager and therefore depends on the manager’s ability to reliably open a channel to the Specstory extension. Trajectory’s higher‑level workflows invoke the manager’s public API, trusting the unified interface to select the appropriate connection method.

* **Sibling – LoggingMechanism**: Uses `logConversation` on the same `SpecstoryAdapter`. Because both logging and connection share the adapter, any change to the adapter’s error‑handling (e.g., a modification to the backoff algorithm) will uniformly affect both connection reliability and logging robustness.

* **Sibling – RetryMechanism**: Mirrors the backoff strategy used in `connectViaHTTP`. The two components likely share configuration (e.g., max retries, backoff factor) to keep retry behaviour consistent throughout the system.

* **Child – HTTPConnectionHandler**: Directly called by the ConnectionManager when an HTTP connection is required. It receives the retry policy from `connectViaHTTP` and performs the actual socket/HTTP request work.

All of these integration points are confined to the `lib/integrations/specstory-adapter.js` file, making the module a clear boundary for external interactions.

## Usage Guidelines  

1. **Prefer the Unified Interface** – Callers should interact with the ConnectionManager through the high‑level methods exposed by `SpecstoryAdapter` rather than invoking protocol‑specific code directly. This guarantees that the retry‑with‑backoff logic and any future connection strategies are applied automatically.

2. **Do Not Re‑Implement Retries** – Because the retry‑with‑backoff pattern is already encapsulated in `connectViaHTTP`, developers should avoid adding duplicate retry loops around the call. Doing so would interfere with the exponential backoff timing and could lead to excessive request traffic.

3. **Configure Backoff Consistently** – If the system needs to adjust backoff parameters (max attempts, initial delay, multiplier), the change should be made in the shared configuration used by both ConnectionManager and RetryMechanism. This ensures uniform behaviour across connection and other retry‑sensitive components.

4. **Leverage HTTPConnectionHandler for Low‑Level Needs** – Only advanced use‑cases that require direct manipulation of HTTP headers or custom request pipelines should reach into `HTTPConnectionHandler`. All standard scenarios should remain at the manager level.

5. **Respect the Parent‑Child Contract** – Trajectory expects the ConnectionManager to either succeed in establishing a connection or surface a controlled failure after exhausting retries. Consumers should handle the final error gracefully, possibly falling back to alternative connection methods (IPC or file‑watch) if those are available.

---

### 1. Architectural patterns identified  
* **Facade / Unified Interface** – ConnectionManager presents a single API while delegating to multiple connection strategies inside `SpecstoryAdapter`.  
* **Retry‑with‑Backoff** – Implemented in `connectViaHTTP`; also reflected in the sibling RetryMechanism.  
* **Strategy‑like separation of connection methods** – Multiple protocols (HTTP, IPC, file‑watch) selectable at runtime.

### 2. Design decisions and trade‑offs  
* **Centralising connection logic** in `SpecstoryAdapter` simplifies usage but creates a single point of failure; however, the built‑in retry mitigates transient failures.  
* **Choosing retry‑with‑backoff** balances resilience against network hiccups with the risk of delayed failure reporting; the exponential growth prevents overload but may increase latency for persistent failures.  
* **Exposing a unified interface** reduces coupling for callers (Trajectory, LoggingMechanism) but limits fine‑grained control for specialized scenarios unless the child `HTTPConnectionHandler` is used directly.

### 3. System structure insights  
* The hierarchy is **Trajectory → ConnectionManager → HTTPConnectionHandler**, with the `SpecstoryAdapter` acting as the shared implementation host.  
* Sibling components (LoggingMechanism, RetryMechanism) interact with the same adapter, reinforcing a tightly coupled but cohesive module boundary.  
* The lack of separate files for each connection type suggests a deliberately compact design focused on ease of maintenance.

### 4. Scalability considerations  
* Because the retry logic is local to each connection attempt, scaling the number of concurrent connections does not introduce additional coordination overhead.  
* The exponential backoff inherently throttles reconnection storms, which is beneficial when many instances of Trajectory experience a simultaneous outage.  
* Adding new connection strategies (e.g., WebSocket) would fit naturally into the existing unified interface without disrupting current behaviour.

### 5. Maintainability assessment  
* **High maintainability**: All connection‑related code lives in a single, well‑named file (`specstory-adapter.js`), making it easy to locate and modify.  
* The shared retry implementation reduces duplication, lowering the risk of divergent error‑handling logic.  
* However, the concentration of multiple responsibilities (connection, logging, retry) in one class could become a maintenance burden if the adapter grows substantially; future refactoring into smaller, purpose‑specific classes may be warranted.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is centered around the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unified interface for interacting with the Specstory extension. This class implements multiple connection methods, including HTTP, IPC, and file watch, allowing for flexibility in how the component connects to the Specstory extension. For example, the connectViaHTTP method in lib/integrations/specstory-adapter.js uses a retry-with-backoff pattern to handle connection failures, ensuring that the component can recover from temporary network issues. The SpecstoryAdapter class also logs conversation entries via the logConversation method, which formats the entries and logs them via the Specstory extension.

### Children
- [HTTPConnectionHandler](./HTTPConnectionHandler.md) -- The connectViaHTTP method in lib/integrations/specstory-adapter.js implements the retry-with-backoff pattern to handle connection failures.

### Siblings
- [LoggingMechanism](./LoggingMechanism.md) -- LoggingMechanism uses the logConversation method in lib/integrations/specstory-adapter.js to format conversation entries and log them via the Specstory extension.
- [RetryMechanism](./RetryMechanism.md) -- RetryMechanism uses a retry-with-backoff pattern in connectViaHTTP method in lib/integrations/specstory-adapter.js to handle connection failures.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter provides a unified interface for interacting with the Specstory extension, including connection methods and logging.


---

*Generated from 6 observations*
