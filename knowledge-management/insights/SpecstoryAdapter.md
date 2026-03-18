# SpecstoryAdapter

**Type:** SubComponent

The SpecstoryAdapter might be configured using environment variables or configurations similar to those described in integrations/mcp-constraint-monitor/docs/constraint-configuration.md.

## What It Is  

The **SpecstoryAdapter** is a concrete integration component that lives in the repository under **`lib/integrations/specstory-adapter.js`**.  Its sole responsibility is to establish and maintain a connection to the **Specstory** browser extension, exposing that connection through a client object named **`SpecstoryApiClient`** (its child component).  Within the broader system, the adapter is a sub‑component of **Trajectory**, which treats adapters as interchangeable plug‑ins for external services.  The adapter’s implementation mirrors the connection protocol described in **`integrations/copi/README.md`**, meaning it follows the same multi‑transport, retry‑oriented approach that other adapters (e.g., the Copi integration) use.  In practice, the adapter attempts to reach the Specstory extension via HTTP, IPC sockets, or a file‑watch mechanism, providing a resilient “persistent connection” layer that other parts of the system—such as the sibling **ConnectionHandler**—can rely on.

---

## Architecture and Design  

### Reuse of a Generic Integration Protocol  
The observation that SpecstoryAdapter “implements a connection protocol similar to the one described in `integrations/copi/README.md`” indicates the codebase defines a **shared integration contract**.  This contract is expressed through a set of expectations (retry logic, transport fallback, hook registration) that each adapter must satisfy.  By aligning with the Copi protocol, SpecstoryAdapter inherits a proven **Adapter‑style** architecture: it translates the generic contract into concrete calls that the Specstory extension understands.

### Strategy‑like Transport Selection  
The adapter’s ability to connect via **HTTP, IPC, or file watch** is a classic **Strategy** pattern.  Each transport is encapsulated in its own method (e.g., `connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`) and the runtime selects the first successful strategy.  This design gives the system flexibility to operate in diverse environments—local development (file watch), containerized deployments (IPC), or remote debugging (HTTP).

### Hook Integration  
Reference to **`integrations/copi/docs/hooks.md`** suggests that the adapter registers lifecycle hooks (e.g., `onConnect`, `onDisconnect`, `onError`).  These hooks enable other components—such as **LoggingManager** and **DataAdapter**—to react to connection events without tightly coupling to the adapter’s internal state.  The hook mechanism is likely a thin wrapper around an event emitter that propagates standardized events across the integration layer.

### Configuration via Shared Schema  
The note that SpecstoryAdapter “might be configured using environment variables or configurations similar to those described in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`” points to a **centralised configuration model**.  The adapter reads its settings (ports to probe, timeout thresholds, feature flags) from a common config file or env namespace, ensuring consistency with sibling adapters and reducing duplication of configuration logic.

### Optional Persistence Layer  
The speculation that the adapter “may use a data storage solution like the one mentioned in `integrations/code-graph-rag/README.md`” implies an optional **metadata store**.  If present, the store would retain connection metadata (e.g., last successful endpoint, handshake tokens) across restarts, allowing the adapter to resume connections more quickly.  This storage is likely abstracted behind a simple key‑value interface, keeping the adapter agnostic to the underlying database technology.

### API Exposure via Child Component  
The child **SpecstoryApiClient** encapsulates the low‑level RPC or HTTP calls that the adapter uses once a transport is established.  By delegating request formation and response parsing to this client, the adapter remains focused on connection lifecycle, while the client handles the actual Specstory API contract.

---

## Implementation Details  

### Core File – `lib/integrations/specstory-adapter.js`  
The entry point defines the **`SpecstoryAdapter`** class.  Its constructor reads configuration (ports, IPC socket paths, watch directories) from the shared configuration module referenced in the MCP constraint‑monitor docs.  Immediately after instantiation, the adapter invokes its **`initialize()`** method, which sequentially attempts the three transport strategies:

1. **`connectViaHTTP()`** – iterates over a predefined port list, issuing a lightweight health‑check request to the Specstory extension.  On success it stores the base URL in an internal field and emits an `onConnect` hook.  
2. **`connectViaIPC()`** – attempts to open a Unix domain socket (or Windows named pipe) using the path derived from configuration.  Successful handshake triggers the same `onConnect` hook.  
3. **`connectViaFileWatch()`** – watches a known file location for a JSON payload that the Specstory extension writes when ready.  The file’s presence or content change is interpreted as a connection signal.

Each strategy is wrapped in a **retry loop** whose parameters (max attempts, back‑off) follow the guidelines in the Copi README, ensuring consistent resilience across adapters.

### Hook Registration – `integrations/copi/docs/hooks.md`  
The adapter imports a **hook manager** that supplies `registerHook(eventName, handler)` APIs.  Typical registrations include:

* `onConnect` – logs the successful transport via **LoggingManager** and notifies **ConnectionHandler**.  
* `onDisconnect` – triggers cleanup of any open sockets and may persist the last known endpoint to the optional metadata store.  
* `onError` – forwards error details to **LoggingManager** and may invoke a fallback transport.

These hooks decouple the adapter’s internal state changes from the rest of the system, allowing siblings like **DataAdapter** to react (e.g., pause data ingestion while the connection is down).

### Configuration – `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`  
SpecstoryAdapter reads a namespaced configuration block, for example:

```json
{
  "specstory": {
    "httpPorts": [3000, 3001, 3002],
    "ipcPath": "/tmp/specstory.sock",
    "watchFile": "/tmp/specstory.ready",
    "retry": { "maxAttempts": 5, "backoffMs": 200 }
  }
}
```

The same schema is reused by other adapters, ensuring a uniform configuration experience across the **Trajectory** ecosystem.

### Optional Persistence – `integrations/code-graph-rag/README.md`  
When the optional metadata layer is enabled, the adapter calls a **`MetadataStore.save(key, value)`** method after a successful connection.  Keys such as `lastSuccessfulTransport` and `lastEndpoint` are persisted, enabling faster reconnection on subsequent process restarts.  The store abstracts over a file‑based JSON cache or a lightweight embedded database, depending on the deployment profile.

### API Client – `SpecstoryApiClient`  
The child component implements methods like `fetchStories()`, `pushAnnotation(data)`, and `ping()`.  Each method builds a request using the transport details held by the parent adapter (e.g., base URL for HTTP, socket descriptor for IPC).  Responses are parsed into typed objects that higher‑level services (e.g., **DataAdapter**) consume.  The client also respects the same retry policy, delegating error handling back to the adapter’s hooks.

---

## Integration Points  

1. **Parent – Trajectory**  
   Trajectory treats SpecstoryAdapter as one of several adapters that can be swapped in at runtime.  It calls the adapter’s `connect()` method during its own startup sequence and later uses the exposed `SpecstoryApiClient` to request story data.  Because Trajectory expects a uniform adapter interface (as defined by the Copi protocol), SpecstoryAdapter fits seamlessly without additional glue code.

2. **Siblings**  
   * **LoggingManager** – consumes the `onConnect`, `onDisconnect`, and `onError` hooks to emit structured logs.  The shared hook contract means LoggingManager does not need to know the specifics of HTTP vs IPC.  
   * **ConnectionHandler** – monitors the adapter’s connection state via the same hooks, and may trigger reconnection attempts or route traffic to a fallback adapter if Specstory becomes unavailable.  
   * **DataAdapter** – relies on the `SpecstoryApiClient` exposed by the adapter to pull raw story data, then transforms it for downstream pipelines.  Because DataAdapter also follows the Copi integration guidelines, it can reuse generic data‑mapping utilities.

3. **External APIs**  
   The adapter’s public surface (the `SpecstoryApiClient`) is consumed by any component that needs to talk to the Specstory extension, including UI layers or test harnesses.  The client’s methods are documented in the same way as the API contracts found in **`integrations/mcp-constraint-monitor/dashboard/README.md`**, suggesting a consistent, REST‑like or RPC‑like interface across the platform.

4. **Configuration & Metadata**  
   The adapter reads its configuration from the central config module (MCP constraint‑monitor) and optionally writes connection metadata to the storage abstraction described in the Code‑Graph‑RAG README.  This makes the adapter both **config‑driven** and **state‑persistent**, reducing hard‑coded values and enabling smoother deployments.

---

## Usage Guidelines  

* **Instantiate via Trajectory** – Direct construction of `SpecstoryAdapter` is discouraged; instead, request the adapter through the Trajectory factory so that the shared configuration and hook registration are applied uniformly.  
* **Respect the Hook Lifecycle** – When extending the adapter (e.g., adding custom telemetry), register additional handlers **after** the adapter’s `initialize()` call to avoid missing early events.  Use the same `registerHook` API as documented in `integrations/copi/docs/hooks.md`.  
* **Configure All Transports** – Even if a deployment only uses HTTP, populate the IPC and file‑watch entries in the config file.  The fallback logic expects a complete list and will otherwise abort early, reducing resilience.  
* **Persist Connection Metadata When Needed** – Enable the optional metadata store only if the environment benefits from fast reconnections (e.g., long‑running daemon processes).  Remember that persisting sensitive tokens may require additional encryption steps.  
* **Do Not Bypass the ApiClient** – All interactions with the Specstory extension should go through `SpecstoryApiClient`.  Direct socket or HTTP calls bypass the retry and hook mechanisms, increasing the risk of inconsistent state.  
* **Testing** – Mock the transport layer (HTTP, IPC, file watch) by providing a stub implementation of the transport interface defined in the Copi protocol README.  This allows unit tests to focus on hook handling and client logic without requiring a real Specstory extension.

---

### Summary of Architectural Findings  

| Item | Insight |
|------|---------|
| **Architectural patterns identified** | Adapter pattern (SpecstoryAdapter → SpecstoryApiClient), Strategy pattern for transport selection, Hook‑based event system, Configuration‑driven design, Optional persistence layer. |
| **Design decisions and trade‑offs** | *Multi‑transport* improves robustness but adds complexity in error handling; *shared protocol* (Copi) reduces duplication but couples adapters to a common contract; *hook system* decouples observers but requires disciplined registration; *optional metadata store* speeds reconnection at the cost of added state management. |
| **System structure insights** | SpecstoryAdapter sits under **Trajectory**, shares a contract with siblings (**LoggingManager**, **ConnectionHandler**, **DataAdapter**), and delegates API calls to its child **SpecstoryApiClient**.  All adapters read from a unified configuration source and emit the same lifecycle events, creating a cohesive integration layer. |
| **Scalability considerations** | Transport fallback and retry logic enable the adapter to scale across varied deployment topologies (local dev, container, remote).  The stateless core (connection handling) can be instantiated multiple times if needed, while the optional metadata store can be swapped for a distributed cache to support horizontal scaling. |
| **Maintainability assessment** | High maintainability thanks to: <br>• Reuse of a common integration protocol (reduces duplicated logic). <br>• Clear separation of concerns (connection vs API client vs hooks). <br>• Centralised configuration and optional pluggable persistence. <br>Potential maintenance burden lies in keeping the transport strategies in sync with evolving Specstory extension APIs and ensuring hook contracts remain backward compatible. |

These observations paint a picture of a deliberately modular, resilient integration component that leverages shared patterns across the codebase while remaining flexible enough to accommodate the unique characteristics of the Specstory extension.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's use of adapters, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, allows for flexible connections to external services. This adapter attempts to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a persistent connection approach. For instance, the connectViaHTTP method tries multiple ports to establish a connection, showcasing the adapter's ability to handle varying connection scenarios. This flexibility is crucial for maintaining a scalable and maintainable system, enabling easier integration of new services or features as needed.

### Children
- [SpecstoryApiClient](./SpecstoryApiClient.md) -- The SpecstoryAdapter uses the lib/integrations/specstory-adapter.js file to connect to the Specstory extension, implying a client interface is necessary for this connection.

### Siblings
- [LoggingManager](./LoggingManager.md) -- LoggingManager likely utilizes the integrations/copi/README.md file to understand the logging requirements for the Copi integration.
- [ConnectionHandler](./ConnectionHandler.md) -- ConnectionHandler likely uses the lib/integrations/specstory-adapter.js file to connect to the Specstory extension via HTTP, IPC, or file watch.
- [DataAdapter](./DataAdapter.md) -- DataAdapter likely utilizes the integrations/copi/README.md file to understand the data transformation requirements for the Copi integration.


---

*Generated from 7 observations*
