# SpecstoryConnector

**Type:** SubComponent

SpecstoryConnector uses the SpecstoryAdapter class (lib/integrations/specstory-adapter.js) to provide methods such as connectViaHTTP, connectViaIPC, and connectViaFileWatch for establishing connections

## What It Is  

**SpecstoryConnector** is a sub‑component that lives inside the **Trajectory** component and is responsible for establishing and maintaining a link to the external *Specstory* extension. All of its core logic resides in the **SpecstoryAdapter** class located at `lib/integrations/specstory-adapter.js`. The adapter exposes three concrete connection entry points – `connectViaHTTP`, `connectViaIPC`, and `connectViaFileWatch` – each targeting a different integration scenario (HTTP ports, Node IPC channels, or file‑system watching). A configuration object defined around line 50 of the same file holds the connection settings (ports, IPC channel names, file paths, retry policies, etc.). The connector also collaborates with the **ErrorManager** module to surface disconnection and runtime errors, and it leverages the **ConnectionMonitor** sibling to detect lost links and trigger reconnection attempts.

---

## Architecture and Design  

The design of **SpecstoryConnector** follows a **factory‑style abstraction**. The `SpecstoryAdapter` class implements a factory pattern that decides, based on the supplied configuration, which concrete connector instance to create – HTTP, IPC, or file‑watch. This decision point centralises the creation logic and shields the rest of the system from the details of each transport.  

Within the broader **Trajectory** hierarchy, the connector is a child of the parent component and works alongside sibling services such as **ConversationLogger**, **ErrorManager**, and **ConnectionMonitor**. The sibling relationship is functional: while **ConversationLogger** records the exchange of messages, **ErrorManager** provides a unified error‑handling façade, and **ConnectionMonitor** supplies a heartbeat that the connector subscribes to for detecting disconnections.  

The adapter’s three `connectVia*` methods each encapsulate a distinct integration technique:

* **HTTP** – uses standard Node HTTP client calls on the “common extension ports” (see `connectViaHTTP` at `lib/integrations/specstory-adapter.js:123`).  
* **IPC** – employs the built‑in `node:ipc` module to open a bidirectional channel with the Specstory process.  
* **FileWatch** – monitors a designated file for changes, allowing a loosely coupled “drop‑file” style handshake.

Error handling is delegated to **ErrorManager**, ensuring that any exception raised inside a connection method is captured, logged, and transformed into a consistent error object for the rest of the system. The reconnection capability is built into the connector: after a disconnection event (detected by **ConnectionMonitor**), the connector re‑invokes the appropriate factory method to re‑establish the link.

---

## Implementation Details  

### Core Class – `SpecstoryAdapter` (`lib/integrations/specstory-adapter.js`)  
* **Configuration Object (≈ line 50)** – stores keys such as `method` (`'http' | 'ipc' | 'fileWatch'`), `port`, `ipcChannel`, `watchPath`, and retry policies. The object is read by the factory logic to decide which `connectVia*` routine to execute.  

* **Factory Logic** – the constructor or a static `create()` method examines the `method` field and returns an instance that has the appropriate `connect` function bound. This isolates the transport‑specific code from callers.  

* **`connectViaHTTP` (line 123)** – builds an HTTP request targeting the Specstory extension’s listening port. It sets up listeners for `response`, `error`, and `close` events, forwarding any network‑level failures to **ErrorManager**.  

* **`connectViaIPC`** – creates an IPC socket via `node:ipc`, registers `message`, `error`, and `disconnect` callbacks, and pipes incoming Specstory messages into the Trajectory pipeline.  

* **`connectViaFileWatch`** – leverages `fs.watch` (or a higher‑level wrapper) to watch a predefined file. When the file changes, the adapter reads the payload and treats it as a message from Specstory.  

* **Reconnection Logic** – after a disconnection is reported (either by an error event or by **ConnectionMonitor**’s heartbeat timeout), the adapter invokes its own factory method again, preserving the original configuration so that the same transport is re‑used unless the configuration is altered.  

### Supporting Modules  
* **ErrorManager** (`lib/error-handler.js`) – provides `handle(error, context)` which the adapter calls whenever a transport throws. This centralises logging, error classification, and potential user notifications.  
* **ConnectionMonitor** (`lib/heartbeat.js`) – emits a `heartbeatLost` event that **SpecstoryConnector** subscribes to; the event triggers the reconnection flow.  

### Child Component – `SpecstoryAdapterFactory`  
Although not a separate file, the factory responsibilities are encapsulated within the `SpecstoryAdapter` class itself, and the hierarchy notes this as a child component. It isolates the instantiation details from the parent **Trajectory**, allowing Trajectory to request a connector without caring about the underlying transport.

---

## Integration Points  

1. **Parent – Trajectory** – Trajectory owns an instance of **SpecstoryConnector** and calls into its public API (e.g., `initialize()` or `connect()`). Trajectory passes the configuration object that lives in `lib/integrations/specstory-adapter.js`.  

2. **Sibling – ErrorManager** – All connection‑related exceptions flow through `ErrorManager.handle()`. This ensures a consistent error reporting surface across the system, including the other siblings such as **ConversationLogger**.  

3. **Sibling – ConnectionMonitor** – The monitor’s heartbeat signals are consumed by the connector to detect silent disconnections. The monitor itself may be configured by Trajectory to adjust timeout thresholds.  

4. **Sibling – ConversationLogger** – While not directly invoked by the connector, any messages received via the chosen transport are typically logged by **ConversationLogger** for audit and debugging purposes.  

5. **External – Specstory Extension** – The ultimate endpoint of the connection. Depending on the chosen method, the connector either opens an HTTP client to the extension’s port, creates an IPC channel, or watches a file that the extension updates.  

All interactions are mediated through well‑defined JavaScript objects and event emitters, keeping the coupling loose and the contracts explicit.

---

## Usage Guidelines  

* **Select the appropriate transport** – When configuring **SpecstoryConnector**, set the `method` field to `'http'`, `'ipc'`, or `'fileWatch'` based on the deployment environment. HTTP is preferred for network‑visible setups; IPC offers the lowest latency when both processes run on the same host; file‑watch is a fallback for environments where direct sockets are prohibited.  

* **Provide complete configuration** – Ensure that the configuration object includes all required keys for the chosen method (e.g., `port` for HTTP, `ipcChannel` for IPC, `watchPath` for file watch). Missing fields will cause the factory to throw an error that will be caught by **ErrorManager**.  

* **Handle errors centrally** – Do not wrap the connector’s calls in ad‑hoc `try/catch` blocks; instead rely on **ErrorManager** to surface errors. Subscribe to the connector’s `error` events if you need to react locally, but always forward the error to the manager.  

* **Respect reconnection semantics** – The connector automatically attempts to reconnect after a disconnection. If custom back‑off logic is required, adjust the retry settings in the configuration object; avoid manually calling `connectVia*` after a failure, as that bypasses the built‑in state machine.  

* **Log communication** – Pair the connector with **ConversationLogger** to capture inbound and outbound messages. This aids troubleshooting, especially when using the file‑watch method where message ordering can be ambiguous.  

* **Testing** – When unit‑testing **SpecstoryConnector**, mock the underlying transport modules (`node:http`, `node:ipc`, `fs.watch`) and verify that the factory creates the correct connector instance based on the configuration. Also assert that any thrown errors are passed to **ErrorManager**.

---

### Architectural patterns identified  

1. **Factory Pattern** – Implemented by `SpecstoryAdapter` to produce concrete connector instances based on the `method` configuration.  
2. **Strategy‑like separation** – Each transport (`connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`) encapsulates a distinct algorithm for communication, allowing the system to swap strategies at runtime.  
3. **Observer/Event‑Driven** – The connector listens to `heartbeatLost` events from **ConnectionMonitor** and emits its own `error` and `connected` events, enabling loose coupling with other components.  

### Design decisions and trade‑offs  

* **Flexibility vs. Complexity** – Supporting three transport mechanisms gives Trajectory maximal deployment flexibility but introduces branching logic and additional testing surface.  
* **Centralised error handling** – Delegating all exceptions to **ErrorManager** simplifies consumer code but makes the connector heavily dependent on that module’s contract.  
* **Reconnection built‑in** – Automatic reconnection improves resilience but may mask underlying systemic issues if back‑off policies are not tuned.  

### System structure insights  

* The hierarchy is cleanly layered: **Trajectory** (parent) orchestrates high‑level flow; **SpecstoryConnector** (child) handles the integration specifics; **SpecstoryAdapterFactory** (sub‑child) isolates creation logic; siblings provide cross‑cutting concerns (logging, error handling, heartbeat).  
* All transport code resides in a single file (`lib/integrations/specstory-adapter.js`), which aids discoverability but could become a maintenance hotspot as more transports are added.  

### Scalability considerations  

* Adding new transport methods (e.g., WebSocket) only requires extending the factory and implementing a new `connectVia*` function, preserving the existing API.  
* The configuration‑driven approach allows bulk deployment of many connector instances with different settings without code changes.  
* However, each active connector maintains its own event listeners and possibly open sockets; in a high‑concurrency scenario, careful resource management (e.g., limiting simultaneous IPC channels) will be needed.  

### Maintainability assessment  

* **Positive factors** – Clear separation of concerns (factory, transport implementations, error handling) and reliance on standard Node modules make the codebase approachable. The use of a single configuration object reduces duplication.  
* **Potential risks** – Consolidating all transport logic in one file can lead to a “God file” if additional transports are added without refactoring. The implicit strategy pattern is not formally abstracted, so future contributors must understand the naming convention (`connectVia*`). Regular code reviews and possibly extracting each transport into its own module would improve long‑term maintainability.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed with flexibility in mind, allowing it to connect to the Specstory extension via multiple methods including HTTP, IPC, or file watch. This is evident in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js), which provides methods such as connectViaHTTP, connectViaIPC, and connectViaFileWatch for establishing connections. For instance, the connectViaHTTP method (lib/integrations/specstory-adapter.js:123) enables connection to the Specstory extension via HTTP on common extension ports, demonstrating the component's ability to adapt to different integration scenarios.

### Children
- [SpecstoryAdapterFactory](./SpecstoryAdapterFactory.md) -- The SpecstoryAdapter class (lib/integrations/specstory-adapter.js) is used by the SpecstoryConnector to provide connection methods.

### Siblings
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger utilizes a logging module (lib/logging/logger.js) to write conversation logs to a file or database
- [ErrorManager](./ErrorManager.md) -- ErrorManager utilizes a error handling module (lib/error-handler.js) to catch and handle errors
- [ConnectionMonitor](./ConnectionMonitor.md) -- ConnectionMonitor utilizes a heartbeat mechanism (lib/heartbeat.js) to detect disconnections


---

*Generated from 7 observations*
