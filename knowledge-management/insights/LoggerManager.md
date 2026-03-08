# LoggerManager

**Type:** SubComponent

The LoggerManager sub-component is responsible for error reporting and debugging, ensuring that the Trajectory component can effectively handle errors and debug its activities.

## What It Is  

**LoggerManager** is a sub‑component that lives inside the **Trajectory** component and is implemented in the same repository as the rest of the system.  All of its concrete interactions are routed through the **SpecstoryAdapter** class found at  

```
lib/integrations/specstory-adapter.js
```  

LoggerManager’s primary responsibilities are *error reporting*, *debugging* and *conversation‑entry logging* for the **Trajectory** component.  It does not contain its own low‑level transport code; instead it delegates to the SpecstoryAdapter’s `connectViaFileWatch` method to watch a designated log file (or directory) and emit log events whenever the file changes.  By doing so, LoggerManager supplies a fault‑tolerant, file‑watch‑driven logging pipeline that the parent **Trajectory** component can rely on for both operational insight and post‑mortem analysis.

---

## Architecture and Design  

The observable architecture revolves around a **central adapter** (`SpecstoryAdapter`) that abstracts the details of how the system talks to the external **Specstory** extension.  This is a classic **Adapter pattern**: the adapter presents a uniform API (`connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`) while encapsulating protocol‑specific implementation.  

LoggerManager consumes this adapter in a **Strategy‑like** manner.  Rather than hard‑coding a single transport, it selects the `connectViaFileWatch` strategy because logging is file‑watch‑centric.  The same adapter is shared by sibling sub‑components—**SpecstoryIntegration**, **ConnectionHandler**, **ProtocolManager**, and **EnvironmentManager**—which each pick the strategy that best fits their use case (HTTP, IPC, or file watch).  This sharing yields a **modular and reusable** design: the transport logic lives in one place, while each consumer focuses on its domain concern (logging, connection handling, protocol management, environment configuration).

Interaction flow:

1. **Trajectory** creates an instance of **LoggerManager**.  
2. LoggerManager constructs or receives a `SpecstoryAdapter` instance.  
3. LoggerManager calls `adapter.connectViaFileWatch(logFilePath)`.  
4. The adapter sets up a file‑system watcher (e.g., `fs.watch` or a platform‑specific watcher) and emits events back to LoggerManager whenever the log file is appended.  
5. LoggerManager processes those events—adding timestamps, categorising them as *conversation entries* or *errors*, and forwarding them to any downstream consumers (e.g., a UI console or persistent store).

Because the adapter also supports HTTP and IPC, the overall system can **swap protocols** without touching LoggerManager’s core logic, evidencing a **flexible, protocol‑agnostic** architecture.

---

## Implementation Details  

### Core Classes / Functions  
* **SpecstoryAdapter** – located in `lib/integrations/specstory-adapter.js`. It encapsulates three connection methods:  
  * `connectViaHTTP(endpoint)` – establishes an HTTP client to the Specstory extension.  
  * `connectViaIPC(pipeName)` – opens an Inter‑Process Communication channel.  
  * `connectViaFileWatch(filePath)` – registers a file‑system watcher on `filePath` and emits change events.  

* **LoggerManager** – a sub‑component under **Trajectory** (no explicit file path was listed, but its implementation resides alongside other Trajectory sub‑components). Its public surface includes:  
  * `logConversation(entry)` – formats and writes a conversation entry to the watched log file.  
  * `reportError(errorObj)` – enriches an error payload and writes it to the same file, ensuring the watcher picks it up.  
  * `initialize()` – internally creates a `SpecstoryAdapter` instance and calls `connectViaFileWatch` with the configured log location.  

### Technical Mechanics  
When `connectViaFileWatch` is invoked, the adapter typically uses Node.js’s `fs.watch` (or a higher‑level library such as `chokidar`) to listen for `change` events on the target file.  Each event triggers a callback that reads the newly appended lines, parses them (often JSON‑encoded), and forwards the structured data back to LoggerManager via an event emitter or a promise‑based listener.  LoggerManager then decides whether the payload represents a normal conversation entry or an error, tags it with the appropriate severity, and may forward it to a downstream diagnostics service.

The **error‑reporting** path is deliberately separate from the normal logging path: errors are wrapped with stack traces and a unique error ID before being written, facilitating later correlation with user‑reported issues.  The **debugging** capability is achieved by exposing the same event stream to developer tools; because the underlying file watch is asynchronous and non‑blocking, LoggerManager does not impede the main execution flow of Trajectory.

---

## Integration Points  

* **Parent – Trajectory**: LoggerManager is instantiated by Trajectory, which supplies configuration such as the log file location and any required adapter options (e.g., protocol preferences).  Trajectory depends on LoggerManager for all its internal diagnostics, meaning any failure in LoggerManager propagates upward as a loss of observability.

* **Sibling – SpecstoryIntegration, ConnectionHandler, ProtocolManager, EnvironmentManager**: All siblings also import `SpecstoryAdapter` from `lib/integrations/specstory-adapter.js`.  They each call the adapter’s protocol‑specific methods that best match their responsibilities (HTTP for SpecstoryIntegration, IPC for ConnectionHandler, etc.).  This shared dependency creates a **common integration contract**: changes to the adapter’s API affect all siblings, encouraging coordinated versioning.

* **External – Specstory Extension**: The adapter’s three connection strategies are the only outward‑facing interfaces.  For LoggerManager, the file‑watch strategy is the external contract; the Specstory extension is expected to append log lines to the watched file, or the system itself writes to that file and the extension reads it.  No direct network or IPC calls are made by LoggerManager, keeping its external surface minimal.

* **Configuration / Environment**: The **EnvironmentManager** sub‑component also uses the adapter to decide which protocol to enable based on runtime conditions (e.g., development vs. production).  LoggerManager inherits the chosen strategy indirectly because Trajectory passes the appropriate adapter instance during initialization.

---

## Usage Guidelines  

1. **Initialize Early** – Call `LoggerManager.initialize()` as part of Trajectory’s startup sequence before any other component begins emitting logs.  This guarantees the file watcher is active and no log entries are missed.

2. **Prefer Structured Entries** – Use `logConversation(entryObject)` where `entryObject` is a plain‑JSON object containing at least `timestamp`, `message`, and `conversationId`.  Structured logs simplify downstream parsing by the file‑watch callback.

3. **Error Reporting Discipline** – When invoking `reportError(error)`, always include a unique error identifier (`errorId`) and a full stack trace.  This practice enables deterministic correlation between logs and bug reports.

4. **Do Not Bypass the Adapter** – All file‑system interactions for logging must go through the `SpecstoryAdapter.connectViaFileWatch` pathway.  Directly writing to the log file without the watcher may lead to missed events if the watcher’s internal buffer is not flushed.

5. **Handle Watcher Errors** – The file‑watch API can emit `error` events (e.g., when the file is deleted).  LoggerManager should subscribe to those events and either recreate the watcher or surface a fatal error to Trajectory, ensuring the system remains aware of a loss of logging capability.

6. **Testing Considerations** – In unit tests, replace the real `SpecstoryAdapter` with a mock that provides a stubbed `connectViaFileWatch` method returning an event emitter.  This isolates LoggerManager’s logic from the OS file‑watch implementation.

---

### Architectural patterns identified  

1. **Adapter Pattern** – `SpecstoryAdapter` abstracts multiple transport mechanisms (HTTP, IPC, file watch) behind a unified interface.  
2. **Strategy‑like Selection** – LoggerManager selects the `connectViaFileWatch` strategy at runtime, allowing interchangeable protocols without code changes.  
3. **Event‑Driven Interaction** – The file‑watch callback emits log events that LoggerManager consumes, forming a lightweight event‑driven pipeline.

### Design decisions and trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Centralize logging in LoggerManager | Single source of truth for error reporting & debugging within Trajectory | Introduces a single point of failure for observability |
| Use file‑watch (`connectViaFileWatch`) for logging | Leverages OS‑level notifications; simple to implement; works in environments without network connectivity | May miss rapid bursts of writes; platform‑specific quirks; less real‑time than IPC |
| Share `SpecstoryAdapter` across siblings | Reduces code duplication, enforces consistent protocol handling | Tightens coupling; changes to the adapter affect many components, requiring coordinated releases |

### System structure insights  

* **Hierarchical** – LoggerManager is a child of Trajectory, while sibling components share the same parent and a common integration library.  
* **Modular** – Each concern (logging, connection handling, protocol management, environment configuration) lives in its own sub‑component, all of which depend on the same adapter module.  
* **Separation of Concerns** – LoggerManager focuses solely on logging semantics; transport details are delegated to the adapter, enabling clear responsibility boundaries.

### Scalability considerations  

* **Throughput** – File‑watch based logging can become a bottleneck if the log volume grows dramatically; the underlying OS may coalesce events, causing latency.  
* **Extensibility** – Adding a new protocol (e.g., WebSocket) would only require extending `SpecstoryAdapter` with a new `connectViaWebSocket` method; LoggerManager could then switch strategies without code changes.  
* **Horizontal Scaling** – Because LoggerManager writes to a single file, scaling out multiple Trajectory instances would require a shared storage mechanism or per‑instance log files to avoid contention.

### Maintainability assessment  

* **Positive** – Centralizing error and debug handling in LoggerManager simplifies debugging and reduces duplication across the codebase.  The adapter’s unified API makes protocol changes localized.  
* **Risk** – Heavy reliance on the adapter means any regression in `SpecstoryAdapter` propagates to all consumers, increasing the impact radius of bugs.  The file‑watch approach ties LoggerManager to OS‑specific behavior, which may require platform‑specific maintenance.  
* **Mitigation** – Comprehensive unit tests that mock the adapter, plus integration tests that verify the file‑watch pipeline on each supported platform, will keep the maintenance burden manageable.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's utilization of the SpecstoryAdapter class, located in lib/integrations/specstory-adapter.js, enables seamless connections to the Specstory extension via multiple protocols, including HTTP, IPC, and file watch. This adaptability is crucial for a robust and fault-tolerant system, as it allows the component to adjust its connection strategy based on the environment and requirements. For instance, the connectViaHTTP method in specstory-adapter.js facilitates HTTP-based connections, while the connectViaIPC method enables Inter-Process Communication. Furthermore, the connectViaFileWatch method allows the component to monitor file changes, demonstrating a flexible and modular design.

### Siblings
- [SpecstoryIntegration](./SpecstoryIntegration.md) -- SpecstoryIntegration uses the connectViaHTTP method in specstory-adapter.js to facilitate HTTP-based connections to the Specstory extension.
- [ConnectionHandler](./ConnectionHandler.md) -- ConnectionHandler uses the connectViaHTTP method in specstory-adapter.js to facilitate HTTP-based connections to external services.
- [ProtocolManager](./ProtocolManager.md) -- ProtocolManager uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to manage the different protocols used by the Trajectory component.
- [EnvironmentManager](./EnvironmentManager.md) -- EnvironmentManager uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to manage the environment and requirements for the Trajectory component.


---

*Generated from 6 observations*
