# ConnectionManager

**Type:** SubComponent

The ConnectionManager is responsible for handling connection establishment and maintenance, including error handling and retry mechanisms.

## What It Is  

**ConnectionManager** is a sub‑component that lives inside the **Trajectory** component.  Its implementation is tightly coupled to the **SpecstoryAdapter** found at `lib/integrations/specstory-adapter.js`.  The manager’s sole responsibility is to orchestrate the lifecycle of a connection to the **Specstory** extension – from initial establishment, through ongoing maintenance, to graceful termination.  All connection‑related concerns (error handling, retries, back‑off timing) are encapsulated here, while the low‑level transport details (HTTP, IPC, file‑watch) are delegated to the SpecstoryAdapter.  The component also contains a child entity called **ConnectionEstablisher**, which further isolates the mechanics of actually opening a channel.

## Architecture and Design  

The architecture around **ConnectionManager** follows a **modular, adapter‑based** style.  The parent **Trajectory** component adopts a modular layout where each language‑model integration lives in its own directory; this same philosophy is reflected in the way ConnectionManager delegates transport specifics to the SpecstoryAdapter.  By depending on an adapter rather than a concrete protocol, ConnectionManager remains agnostic to how the Specstory extension is reached – it can use HTTP, inter‑process communication, or file‑watch mechanisms without any code change.  

Two explicit design patterns surface in the observations:  

1. **Adapter Pattern** – The SpecstoryAdapter (`lib/integrations/specstory-adapter.js`) implements the various connection methods and presents a uniform interface that ConnectionManager consumes.  This decouples the manager from protocol‑level concerns and enables easy swapping or extension of transport strategies.  

2. **Retry‑With‑Backoff** – The adapter’s `connectViaHTTP` method (line 123) employs a retry‑with‑backoff algorithm.  ConnectionManager leverages this pattern to robustly handle transient failures when establishing a link to the Specstory extension.  

The component hierarchy (`Trajectory → ConnectionManager → ConnectionEstablisher`) reinforces a **single‑responsibility** split: ConnectionManager handles high‑level state (connected, reconnecting, terminated) while ConnectionEstablisher concentrates on the concrete steps required to open a channel.  Sibling components **SpecstoryIntegration** and **ConversationLogger** also use the same SpecstoryAdapter, illustrating a shared integration contract across the subsystem.

## Implementation Details  

Although no source symbols were listed, the observations give a clear picture of the internal structure.  **ConnectionManager** holds a reference to the **SpecstoryAdapter** and invokes its connection APIs (e.g., `connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`).  The manager tracks connection state – “established”, “maintaining”, and “terminated” – and reacts to adapter callbacks or error events.  When an error occurs, ConnectionManager triggers the retry‑with‑backoff logic that lives inside the adapter, ensuring that reconnection attempts are spaced progressively longer to avoid overwhelming the extension.  

The child **ConnectionEstablisher** is likely a thin wrapper that prepares the parameters required by the adapter (such as endpoint URLs, IPC socket paths, or file‑watch directories) and then calls the appropriate adapter method.  By isolating this preparation step, the manager can remain focused on state transitions and error handling, while the establisher deals with the nuances of each transport type.  

Because the manager is described as “flexible, allowing for different connection methods and configurations,” it probably exposes a configuration object (e.g., `{ method: 'http', retryPolicy: {...} }`) that downstream code can adjust.  This configuration is then passed down to the adapter, which interprets it according to the selected transport.

## Integration Points  

**ConnectionManager** sits at the intersection of three major system pieces:

* **Parent – Trajectory**: Trajectory’s modular architecture provides the container in which ConnectionManager lives.  Trajectory likely instantiates the manager for each language‑model directory, passing model‑specific configuration (e.g., which Specstory endpoint to use).  

* **Sibling – SpecstoryIntegration & ConversationLogger**: Both siblings also depend on the same `lib/integrations/specstory-adapter.js`.  This shared dependency means that any change to the adapter’s public contract (method signatures, error codes) impacts all three components, reinforcing the need for a stable adapter API.  

* **Child – ConnectionEstablisher**: The establisher is invoked by ConnectionManager whenever a new connection attempt is required.  It prepares the concrete parameters and forwards the request to the adapter, acting as the bridge between high‑level state logic and low‑level transport calls.  

External callers (e.g., higher‑level orchestration code in Trajectory) interact with ConnectionManager through a small public surface: methods such as `start()`, `stop()`, and perhaps `onStateChange(callback)`.  Internally, the manager registers listeners on the adapter to receive success or failure events, which then drive state transitions.

## Usage Guidelines  

1. **Instantiate via Trajectory** – Let the Trajectory component create ConnectionManager instances, supplying the appropriate configuration object.  Direct manual construction bypasses the modular wiring and can lead to mismatched adapter versions.  

2. **Prefer the Adapter’s Public API** – All connection attempts should be routed through ConnectionManager, which in turn calls the SpecstoryAdapter.  Avoid calling adapter methods directly; doing so would circumvent the retry‑with‑backoff handling and state tracking performed by the manager.  

3. **Handle State Changes** – Subscribe to the manager’s state‑change callbacks (e.g., `onStateChange`) to react to transitions such as `connected`, `reconnecting`, or `terminated`.  This ensures that downstream components like SpecstoryIntegration or ConversationLogger can pause their work while the connection is unstable.  

4. **Configure Retry Policies Carefully** – While the adapter already implements a back‑off strategy, the overall retry cadence can be tuned via the manager’s configuration.  Overly aggressive retries may flood the Specstory extension; overly conservative settings may increase latency for recovery.  

5. **Do Not Modify the Adapter Internals** – Because siblings share the same adapter, any change to its implementation (e.g., adding a new transport method) must be coordinated across ConnectionManager, SpecstoryIntegration, and ConversationLogger.  Keep adapter modifications backward‑compatible to preserve subsystem stability.

---

### 1. Architectural patterns identified
* **Adapter pattern** – SpecstoryAdapter abstracts HTTP, IPC, and file‑watch transports.
* **Retry‑with‑Backoff** – Implemented in `connectViaHTTP` (line 123) and used by ConnectionManager for resilient connection attempts.
* **Modular architecture** – Trajectory’s directory‑per‑model layout and the isolated ConnectionEstablisher child illustrate a modular decomposition.
* **Single‑Responsibility principle** – Separation of connection state logic (ConnectionManager) from transport details (SpecstoryAdapter) and from connection‑setup specifics (ConnectionEstablisher).

### 2. Design decisions and trade‑offs
* **Decoupling via adapter** – Gains flexibility and testability at the cost of an extra indirection layer.
* **Embedded retry logic in the adapter** – Centralizes error recovery, but ties the back‑off policy to the adapter rather than allowing per‑manager customization.
* **Modular child (ConnectionEstablisher)** – Improves maintainability and allows future transport extensions, though it introduces an additional component to manage.

### 3. System structure insights
* **Hierarchy**: Trajectory → ConnectionManager → ConnectionEstablisher.
* **Shared integration point**: SpecstoryAdapter is a common dependency for ConnectionManager, SpecstoryIntegration, and ConversationLogger, forming a hub for all Specstory‑related communication.
* **Stateful manager** – Tracks connection lifecycle, exposing state events to siblings and parent.

### 4. Scalability considerations
* Because the adapter supports multiple transport methods, the system can scale horizontally (e.g., multiple language‑model instances each with its own ConnectionManager) without altering core logic.
* The retry‑with‑backoff algorithm prevents thundering‑herd reconnection storms when many managers experience a simultaneous outage.

### 5. Maintainability assessment
* **High** – Clear separation of concerns, modular child component, and a single adapter interface simplify updates.
* **Risk** – Tight coupling to the adapter’s public API means that changes to the adapter must be coordinated across all siblings; thorough contract tests are essential.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component utilizes a modular architecture, with each language model having its own directory and configuration, allowing for easy maintenance and scalability. For instance, the SpecstoryAdapter (lib/integrations/specstory-adapter.js) is used to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a flexible approach to integrations. This adapter implements a retry-with-backoff pattern in the connectViaHTTP method (lib/integrations/specstory-adapter.js:123) to establish a connection with the Specstory extension, showcasing a robust approach to handling potential connection issues.

### Children
- [ConnectionEstablisher](./ConnectionEstablisher.md) -- The ConnectionManager uses the SpecstoryAdapter to establish connections, implying a decoupling of connection logic from the adapter's implementation.

### Siblings
- [SpecstoryIntegration](./SpecstoryIntegration.md) -- SpecstoryIntegration uses the SpecstoryAdapter (lib/integrations/specstory-adapter.js) to connect to the Specstory extension via different methods.
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger uses the SpecstoryAdapter to log conversations with the Specstory extension.


---

*Generated from 7 observations*
