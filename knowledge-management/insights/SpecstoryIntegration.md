# SpecstoryIntegration

**Type:** SubComponent

The connectViaHTTP method (lib/integrations/specstory-adapter.js:123) implements a retry-with-backoff pattern to establish a connection with the Specstory extension.

## What It Is  

**SpecstoryIntegration** is a sub‑component that lives inside the **Trajectory** parent component.  Its core implementation resides in the file **`lib/integrations/specstory-adapter.js`**, where it leverages the **SpecstoryAdapter** class to communicate with the external **Specstory** extension.  The integration does not contain its own business logic; instead, it delegates all connection handling, data exchange, and logging responsibilities to the adapter.  By doing so, SpecstoryIntegration acts as a thin orchestration layer that wires the adapter into the broader Trajectory workflow, allowing other sibling components—such as **ConversationLogger** and **ConnectionManager**—to reuse the same communication backbone.

## Architecture and Design  

The design that emerges from the observations is a **modular adapter‑based architecture**.  The **SpecstoryAdapter** is deliberately isolated in its own module (`lib/integrations/specstory-adapter.js`), which makes the integration replaceable or extensible without touching the rest of the system.  This follows the classic **Adapter pattern**: the adapter translates the internal calls of SpecstoryIntegration (and its siblings) into the protocol required by the Specstory extension (HTTP, IPC, or file‑watch mechanisms).  

A second, explicitly mentioned pattern is **retry‑with‑backoff**, implemented in the `connectViaHTTP` method (line 123 of the adapter).  This pattern adds robustness by automatically re‑trying failed connection attempts while progressively increasing the wait interval, thereby mitigating transient network hiccups.  The presence of this pattern indicates that reliability was a primary design goal for the integration layer.  

Interaction among components is straightforward: **Trajectory** instantiates the adapter and passes it to its child sub‑components.  **ConversationLogger** and **ConnectionManager**, which sit alongside SpecstoryIntegration, also receive the same adapter instance.  This shared‑adapter approach eliminates duplicate connection code and ensures a consistent communication contract across the system.

## Implementation Details  

The heart of the implementation is the **SpecstoryAdapter** module.  Although the source code is not fully listed, the observations highlight two critical pieces:

1. **`connectViaHTTP` (lib/integrations/specstory-adapter.js:123)** – This function establishes the HTTP channel to the Specstory extension.  It wraps the connection logic in a retry‑with‑backoff loop, likely using a counter for attempts and a backoff calculation (e.g., exponential or jittered delay).  The method returns a promise or callback that signals success once the connection is live, or propagates an error after exhausting retries.

2. **Modular architecture** – The adapter is structured to support multiple transport mechanisms (HTTP, IPC, file watch).  While the observation only names `connectViaHTTP`, the parent component description mentions the same adapter can also connect via IPC or file watch, implying a set of similarly named methods (e.g., `connectViaIPC`, `connectViaFileWatch`).  Each method probably adheres to a common interface so that callers (SpecstoryIntegration, ConversationLogger, ConnectionManager) can remain agnostic of the underlying transport.

The **SpecstoryIntegration** component itself likely consists of a thin wrapper that imports the adapter, invokes the appropriate connection method during initialization, and then forwards any data payloads to the adapter’s send/receive APIs.  Because the integration “relies on the SpecstoryAdapter to handle data exchange and communication,” it does not duplicate any networking code; instead, it may expose higher‑level functions such as `logConversation` or `pushEvent` that internally call the adapter’s methods.

## Integration Points  

- **Parent – Trajectory**: Trajectory orchestrates the lifecycle of SpecstoryIntegration.  It creates the adapter instance and injects it into SpecstoryIntegration, ConversationLogger, and ConnectionManager.  This centralization ensures that all sub‑components share a single, consistent connection to the Specstory extension.

- **Siblings – ConversationLogger & ConnectionManager**: Both siblings depend on the same SpecstoryAdapter.  ConversationLogger uses the adapter to **log conversations** with Specstory, while ConnectionManager uses it to **establish and maintain connections**.  Because they share the adapter, any change to connection handling (e.g., tweaking backoff parameters) automatically propagates to all three components.

- **External – Specstory extension**: The ultimate integration target is the Specstory extension, reachable via HTTP (as demonstrated by `connectViaHTTP`).  The adapter abstracts the protocol details, so SpecstoryIntegration never directly manipulates sockets or request objects.

The only explicit dependency shown is the **adapter module** (`lib/integrations/specstory-adapter.js`).  No other libraries or services are mentioned, so the integration surface is intentionally minimal.

## Usage Guidelines  

1. **Instantiate via Trajectory** – Developers should let the Trajectory component create and configure the SpecstoryAdapter.  Directly constructing the adapter inside SpecstoryIntegration bypasses the shared‑instance model and can lead to duplicate connections.

2. **Prefer the provided connection methods** – When initializing SpecstoryIntegration, call the appropriate adapter method (`connectViaHTTP` for HTTP, or the analogous IPC/file‑watch methods if needed).  Do not attempt to roll your own retry logic; the built‑in backoff already handles transient failures.

3. **Share the adapter across siblings** – If you need to add a new component that talks to Specstory, inject the same adapter instance rather than creating a new one.  This maintains a single source of truth for connection state and logging configuration.

4. **Handle async outcomes** – Since `connectViaHTTP` is asynchronous (it performs retries), ensure that any code depending on a live connection awaits the promise or registers the appropriate callback.  Attempting to send data before the connection resolves will result in errors.

5. **Do not modify the adapter internals** – The adapter’s modular design is intended for extension via additional transport methods, not for internal tweaks.  If a new transport is required, add a new method following the existing pattern rather than altering `connectViaHTTP`.

---

### Architectural patterns identified
- **Adapter pattern** – SpecstoryAdapter isolates external Specstory communication.
- **Retry‑with‑backoff** – Implemented in `connectViaHTTP` to improve robustness.

### Design decisions and trade‑offs
- **Centralised adapter instance** – simplifies sharing but creates a single point of failure; mitigated by retry logic.
- **Modular transport methods** – provides flexibility (HTTP, IPC, file watch) at the cost of a slightly larger abstraction surface.

### System structure insights
- **Trajectory** acts as the orchestrator, housing the adapter and distributing it to child sub‑components.
- **SpecstoryIntegration**, **ConversationLogger**, and **ConnectionManager** are sibling consumers of the same adapter, reinforcing a cohesive integration layer.

### Scalability considerations
- The modular adapter can be extended with additional transport mechanisms without affecting existing consumers, supporting horizontal scaling of integration points.
- Retry‑with‑backoff ensures that a surge of temporary network failures does not cascade into systemic downtime.

### Maintainability assessment
- High maintainability: the adapter’s isolated module and clear retry strategy localise changes.
- Shared‑instance model reduces code duplication, making updates (e.g., backoff tuning) propagate automatically.
- The lack of deep coupling between SpecstoryIntegration and the adapter means future refactoring of communication protocols can be done with minimal impact on the rest of the system.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component utilizes a modular architecture, with each language model having its own directory and configuration, allowing for easy maintenance and scalability. For instance, the SpecstoryAdapter (lib/integrations/specstory-adapter.js) is used to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a flexible approach to integrations. This adapter implements a retry-with-backoff pattern in the connectViaHTTP method (lib/integrations/specstory-adapter.js:123) to establish a connection with the Specstory extension, showcasing a robust approach to handling potential connection issues.

### Siblings
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger uses the SpecstoryAdapter to log conversations with the Specstory extension.
- [ConnectionManager](./ConnectionManager.md) -- ConnectionManager uses the SpecstoryAdapter to establish connections with the Specstory extension.


---

*Generated from 7 observations*
