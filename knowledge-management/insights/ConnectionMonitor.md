# ConnectionMonitor

**Type:** SubComponent

ConnectionMonitor supports handling different types of disconnections, including network errors and extension crashes

## What It Is  

`ConnectionMonitor` is a **sub‑component** that lives under the `Trajectory` component and is responsible for continuously supervising the health of the link to the Specstory extension. Its core implementation resides in `lib/connection-monitor.js`, where the public API is exposed through methods such as `monitorConnection` (line 100) and `detectDisconnection` (line 150). The monitor relies on a dedicated **heartbeat mechanism** defined in `lib/heartbeat.js` (exposed as the child component *HeartbeatMechanism*) to emit periodic “ping” signals and verify that the remote endpoint is still reachable. In addition to the heartbeat, a **timeout mechanism** (implemented around line 50 of `lib/connection-monitor.js`) provides a secondary guard that flags a connection as broken when expected heartbeats do not arrive within a configurable window. The component is configurable – callers can set the heartbeat interval and the disconnection timeout, allowing the surrounding system to tune responsiveness versus resource consumption.

## Architecture and Design  

The observable design of `ConnectionMonitor` is anchored in two classic patterns that are explicitly evident in the source:

1. **Observer Pattern** – The class implements an observer/subject role, broadcasting disconnection events to any registered listeners. This is the mechanism by which sibling components such as `SpecstoryConnector`, `ConversationLogger`, and `ErrorManager` can react to a lost link without being tightly coupled to the monitor’s internals. The notification channel is likely exposed through `addListener`/`removeListener`‑style methods (though not listed, the pattern is confirmed by observation 4).

2. **Heartbeat / Timeout Pattern** – The monitor couples a **heartbeat** (via `HeartbeatMechanism` in `lib/heartbeat.js`) with a **timeout guard** (`lib/connection-monitor.js:50`). The heartbeat continuously emits lightweight signals; the timeout watches for missed beats and triggers `detectDisconnection`. This dual‑layer approach provides resilience against both transient network glitches and more catastrophic failures such as an extension crash (observation 3).

Interaction flow: `Trajectory` creates a `ConnectionMonitor` instance, which in turn instantiates a `HeartbeatMechanism`. The monitor starts `monitorConnection` (line 100), which registers the heartbeat callback and starts the timeout timer. Each successful heartbeat resets the timeout. When the timeout expires, `detectDisconnection` (line 150) analyses the failure cause (network error vs. extension crash) and notifies observers. This clear separation of concerns—heartbeat generation, timeout tracking, cause analysis, and event propagation—creates a modular architecture that is easy to reason about.

## Implementation Details  

- **HeartbeatMechanism (`lib/heartbeat.js`)** – Encapsulates the low‑level ping logic. It likely exports a class or factory that can be started with a configurable interval. The interval is supplied by the `ConnectionMonitor` configuration (observation 7). The heartbeat emits a simple “alive” signal, perhaps via an EventEmitter, that the monitor consumes.

- **Timeout Logic (`lib/connection-monitor.js:50`)** – Implements a timer that is (re)started each time a heartbeat is received. The timeout value is also configurable, enabling developers to balance detection latency against false positives caused by temporary latency spikes.

- **`monitorConnection` (`lib/connection-monitor.js:100`)** – The long‑running loop that wires the heartbeat and timeout together. It registers a listener on the heartbeat, resets the timeout on each tick, and may also perform ancillary health checks (e.g., verifying IPC sockets or HTTP endpoints).

- **`detectDisconnection` (`lib/connection-monitor.js:150`)** – When the timeout fires, this method runs a small decision tree to classify the failure. It distinguishes between *network errors* (e.g., socket closed, unreachable host) and *extension crashes* (e.g., process termination, missing IPC pipe). The classification result is then broadcast through the observer channel.

- **Configuration API** – The monitor exposes an options object (observation 7) where callers can set `heartbeatInterval` and `timeoutMs`. These values are passed down to `HeartbeatMechanism` and the internal timer, respectively, allowing the surrounding `Trajectory` component to adapt to different deployment environments (local development vs. CI pipelines).

## Integration Points  

`ConnectionMonitor` sits directly under the **parent component** `Trajectory`. `Trajectory` orchestrates the overall connection workflow and delegates health supervision to the monitor. The monitor’s observer notifications are consumed by several **sibling components**:

* **SpecstoryConnector** – Needs to know when the underlying Specstory connection is lost so it can attempt reconnection via the various adapters (`connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`) defined in `lib/integrations/specstory-adapter.js`.  
* **ConversationLogger** – May pause logging or flush buffers when a disconnection occurs, using the logger located in `lib/logging/logger.js`.  
* **ErrorManager** – Receives disconnection events to surface user‑friendly error messages or trigger automated diagnostics via `lib/error-handler.js`.

The **child component** `HeartbeatMechanism` is the only direct dependency of `ConnectionMonitor`. Because the heartbeat lives in its own file (`lib/heartbeat.js`), the monitor can swap implementations (e.g., a WebSocket‑based ping vs. a simple file‑watch ping) without altering its own logic, reinforcing the modular contract.

External integration points are also implicit: any module that wishes to observe disconnection events must register with the monitor’s observer interface, ensuring a loose coupling that respects the overall architecture of the system.

## Usage Guidelines  

1. **Instantiate via Trajectory** – Developers should let the `Trajectory` component create the `ConnectionMonitor` so that the parent can correctly wire the observer listeners and pass the appropriate configuration. Direct instantiation bypasses important initialization steps (e.g., registration with sibling components).

2. **Configure Thoughtfully** – Choose a `heartbeatInterval` that reflects the expected latency of the underlying transport (HTTP, IPC, or file watch). A shorter interval yields faster detection but increases CPU/network overhead. The `timeoutMs` should be set to a multiple of the heartbeat interval (commonly 2‑3×) to avoid false positives.

3. **Register Observers Early** – Subscribe to disconnection events as soon as the monitor is started. Since `monitorConnection` runs continuously, late registration could miss the first failure, leaving dependent components (e.g., `SpecstoryConnector`) unaware of a broken link.

4. **Handle All Disconnection Types** – The `detectDisconnection` method differentiates between network errors and extension crashes. Consumers should implement distinct recovery strategies: network errors may merit a simple retry, whereas an extension crash might require a full restart of the Specstory process.

5. **Avoid Blocking in Observers** – Observer callbacks run in the same event loop as the monitor. Long‑running work (e.g., heavy file I/O) should be off‑loaded to worker threads or asynchronous APIs to keep the heartbeat and timeout mechanisms responsive.

---

### Architectural Patterns Identified  
* Observer (subject/observer) – for broadcasting disconnection events.  
* Heartbeat / Timeout – for proactive health checking and fail‑fast detection.

### Design Decisions & Trade‑offs  
* **Dual detection (heartbeat + timeout)** – Improves reliability (captures both silent crashes and network stalls) at the cost of additional timer management and slight CPU overhead.  
* **Configurable intervals** – Provides flexibility across environments but introduces the risk of misconfiguration leading to delayed detection or unnecessary churn.  
* **Separate HeartbeatMechanism child** – Encourages reuse and testability; however, it adds an extra indirection layer that developers must understand when debugging timing issues.

### System Structure Insights  
* `Trajectory` → **contains** → `ConnectionMonitor` → **contains** → `HeartbeatMechanism`.  
* Sibling components (`SpecstoryConnector`, `ConversationLogger`, `ErrorManager`) **listen** to the monitor’s observer events, forming a loosely coupled event‑driven mesh around the connection lifecycle.

### Scalability Considerations  
* The heartbeat runs on a single Node.js event loop; scaling to thousands of concurrent connections would require either multiplexed heartbeats (single timer broadcasting to many monitors) or sharding the monitors across worker processes.  
* Configurable intervals allow operators to throttle the heartbeat frequency in high‑load scenarios, reducing CPU and network usage.

### Maintainability Assessment  
* **High cohesion** – Each file (`connection-monitor.js`, `heartbeat.js`) has a clear responsibility.  
* **Low coupling** – Observer pattern and child‑component abstraction keep external dependencies minimal.  
* **Extensibility** – Adding new disconnection causes or alternative heartbeat transports only requires changes inside `detectDisconnection` or `HeartbeatMechanism`, leaving observers untouched.  
* **Potential technical debt** – The dual‑timer logic can become subtle; thorough unit tests around timeout reset and heartbeat loss are essential to avoid flaky detection. Overall, the design promotes maintainability while providing the necessary robustness for the Specstory integration.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed with flexibility in mind, allowing it to connect to the Specstory extension via multiple methods including HTTP, IPC, or file watch. This is evident in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js), which provides methods such as connectViaHTTP, connectViaIPC, and connectViaFileWatch for establishing connections. For instance, the connectViaHTTP method (lib/integrations/specstory-adapter.js:123) enables connection to the Specstory extension via HTTP on common extension ports, demonstrating the component's ability to adapt to different integration scenarios.

### Children
- [HeartbeatMechanism](./HeartbeatMechanism.md) -- The ConnectionMonitor sub-component relies on the HeartbeatMechanism to detect disconnections, as indicated by the parent context.

### Siblings
- [SpecstoryConnector](./SpecstoryConnector.md) -- SpecstoryConnector uses the SpecstoryAdapter class (lib/integrations/specstory-adapter.js) to provide methods such as connectViaHTTP, connectViaIPC, and connectViaFileWatch for establishing connections
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger utilizes a logging module (lib/logging/logger.js) to write conversation logs to a file or database
- [ErrorManager](./ErrorManager.md) -- ErrorManager utilizes a error handling module (lib/error-handler.js) to catch and handle errors


---

*Generated from 7 observations*
