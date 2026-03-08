# IPCManager

**Type:** SubComponent

The SpecstoryAdapter class, which is part of the IPCManager, may use a messaging interface like messaging-api to interact with the IPC channels.

## What It Is  

`IPCManager` is the sub‑component responsible for establishing and orchestrating inter‑process communication (IPC) inside the **Trajectory** domain.  The manager lives alongside its siblings—`ConnectionRetryManager`, `FileWatchManager`, and `SpecstoryAdapter`—and is instantiated wherever the parent component **Trajectory** needs to exchange messages across process or thread boundaries.  The implementation relies on a concrete library such as **ipc‑main** to create the underlying IPC channels, and it is driven by a declarative configuration file named **config.json** that enumerates each channel together with its runtime settings (e.g., channel name, direction, serialization format).  By design, `IPCManager` follows a message‑based architecture: producers emit typed messages onto a channel, and consumers listen for those messages, optionally using a JSON‑RPC envelope (via the **json‑rpc** library) to encode request/response semantics.  The `SpecstoryAdapter` class, located in `lib/integrations/specstory-adapter.js`, is a concrete consumer/producer that plugs into these channels through a generic **messaging‑api** interface, allowing the adapter to remain agnostic of the exact IPC transport.

## Architecture and Design  

The overall architecture of `IPCManager` is **message‑centric** and **configuration‑driven**.  The manager reads **config.json** at start‑up, iterates over the declared channel specifications, and uses **ipc‑main** to instantiate each channel.  This approach decouples the logical communication topology from the code that creates it, making it straightforward to add, remove, or re‑wire channels without touching the source.  

A **factory pattern** is evident in the way `SpecstoryAdapter` (and, by inheritance, `ConnectionRetryManager`) obtains concrete connection objects.  In `lib/integrations/specstory-adapter.js` the constructor receives a factory that can produce different “connection methods” (e.g., a WebSocket client, a local pipe, or a mock for testing).  The `initialize()` method then calls the factory to obtain the appropriate messenger, which is subsequently used to bind to the IPC channels created by `IPCManager`.  This factory usage yields **loose coupling** between the adapter and the transport implementation, mirroring the same design principle used by the sibling managers.

The presence of a **message cache** indicates an additional performance‑optimisation layer.  By caching recent messages (or perhaps the results of RPC calls), the manager can answer repeat requests locally, reducing the number of round‑trip IPC calls and thus lowering latency.  The cache is likely scoped per channel and may be configurable through the same **config.json** file.

Finally, the adoption of **json‑rpc** adds a request/response pattern on top of the raw message bus.  Calls are encoded as JSON‑RPC objects, dispatched over the ipc‑main channel, and the corresponding response is routed back through the same channel, preserving correlation identifiers.  This hybrid of fire‑and‑forget messages and RPC‑style calls gives the system flexibility while keeping the underlying transport uniform.

## Implementation Details  

1. **Configuration Loading** – At start‑up the manager reads **config.json** (the exact path is not listed but is typically co‑located with the component’s source).  The JSON structure defines each IPC channel, for example:  

   ```json
   {
     "channels": [
       { "name": "specstory", "type": "requestResponse", "rpc": true },
       { "name": "trajectoryUpdates", "type": "broadcast", "rpc": false }
     ]
   }
   ```  

   The manager parses this file, validates required fields, and stores the resulting descriptor objects for later channel creation.

2. **Channel Creation with ipc‑main** – Using the **ipc‑main** library, `IPCManager` iterates over the channel descriptors and calls the library’s API (e.g., `ipcMain.handle(name, handler)` for RPC channels or `ipcMain.on(name, listener)` for broadcast channels).  The handler functions are thin wrappers that forward the payload to the appropriate consumer, such as `SpecstoryAdapter`.

3. **SpecstoryAdapter Integration** – In `lib/integrations/specstory-adapter.js`, the class is constructed with a dependency‑injected factory.  The constructor stores the factory, while `initialize()` invokes it to obtain a concrete messenger that implements the **messaging‑api** contract (`send`, `onMessage`, `request`, etc.).  Once the messenger is ready, the adapter registers its own listeners on the channels created by `IPCManager`, for instance:  

   ```js
   this.messenger.onMessage('specstory', this.handleSpecstoryMessage.bind(this));
   ```

   Errors or warnings encountered during this handshake are reported via `logConversation()`, which centralises diagnostic logging for the adapter.

4. **Message Caching** – A simple in‑memory cache (e.g., a `Map` keyed by request ID or message content) sits between the messenger and the IPC handler.  When a request arrives, the cache is consulted first; a cache hit short‑circuits the RPC flow and returns the stored response instantly.  Cache eviction policies (TTL, size limit) are likely configurable, though the observations do not detail the exact algorithm.

5. **JSON‑RPC Handling** – For channels marked as RPC, the manager leverages **json‑rpc** to serialize the request, embed a unique `id`, and route it through the ipc‑main handler.  The response handler extracts the `id` and resolves the original promise held by the caller (often the `SpecstoryAdapter`).  This layer abstracts away low‑level serialization concerns and provides a standard error object when something goes wrong.

## Integration Points  

`IPCManager` sits at the heart of the **Trajectory** component’s internal communication fabric.  Its primary integration points are:  

* **Parent – Trajectory** – The parent component injects `IPCManager` (often via dependency injection) and expects it to expose an API such as `send(channel, payload)` and `request(channel, payload)`.  Trajectory uses these calls to broadcast state updates, request calculations, or retrieve cached data from other sub‑components.  

* **Sibling – SpecstoryAdapter** – The adapter consumes the channels created by `IPCManager`.  The adapter’s factory‑produced messenger implements the **messaging‑api**, which is the contract `IPCManager` expects for sending and receiving messages.  The `initialize()` and `logConversation()` methods of `SpecstoryAdapter` are directly tied to the lifecycle of the IPC channels.  

* **Sibling – ConnectionRetryManager** – Although its code lives in the same `specstory-adapter.js` file, this manager also relies on the factory pattern to obtain a connection object.  It may subscribe to the same IPC channels to listen for retry‑related events (e.g., “connectionFailed”, “retryScheduled”).  

* **Sibling – FileWatchManager** – While `FileWatchManager` uses **chokidar** for file‑system events, it could publish file‑change notifications over an IPC channel managed by `IPCManager`, enabling other processes (including `SpecstoryAdapter`) to react without direct file‑system coupling.  

* **External Libraries** – The manager’s runtime dependencies are explicitly listed: **ipc‑main** for channel plumbing, **json‑rpc** for request/response semantics, and a generic **messaging‑api** that abstracts the concrete transport.  The presence of a caching layer suggests an internal module (e.g., `messageCache.js`) that other components may import if they need direct cache access.

## Usage Guidelines  

Developers working within the **Trajectory** ecosystem should treat `IPCManager` as the single source of truth for all inter‑process messaging.  First, define any new channel in **config.json** with the appropriate `type` and `rpc` flag; avoid hard‑coding channel names in code to preserve configurability.  When adding a consumer or producer, follow the established **factory pattern**: create a factory method that returns an object adhering to the **messaging‑api**, inject it into the consumer’s constructor (as `SpecstoryAdapter` does), and call `initialize()` during the component’s start‑up sequence.  

Because a message cache is present, be mindful of cache invalidation: if the payload’s semantics change (e.g., a version bump), either clear the cache programmatically or use a cache key that incorporates a version token.  For RPC‑style calls, always handle the promise rejection path; the JSON‑RPC layer will surface transport errors as rejected promises with a standard error object.  Logging should be routed through `logConversation()` (or the equivalent logger used by the parent) to keep diagnostics consistent across the sub‑components.  

Finally, when testing, replace the real messenger with a mock implementation of **messaging‑api** supplied by the factory.  This preserves the loose coupling and allows unit tests to verify message handling without spawning actual IPC channels.

---

### Architectural patterns identified  
* **Message‑based architecture** – communication is expressed as discrete messages over named channels.  
* **Factory pattern** – used by `SpecstoryAdapter` (and `ConnectionRetryManager`) to obtain concrete messenger/connection objects, enabling loose coupling and easy substitution.  
* **Configuration‑driven channel creation** – channel definitions live in **config.json**, separating topology from code.  
* **Caching layer** – a simple message cache sits between the messenger and the handler to improve performance.  
* **JSON‑RPC overlay** – adds request/response semantics on top of the raw message bus.

### Design decisions and trade‑offs  
* **Decoupling via factories** improves testability and extensibility but adds a level of indirection that developers must understand.  
* **Configuration‑driven channels** make the system flexible; however, runtime errors may arise if the JSON file is malformed or out of sync with the code.  
* **Message caching** reduces latency for repeat requests but introduces cache‑coherency concerns; developers must decide appropriate TTLs.  
* **Using ipc‑main** ties the implementation to Electron‑style IPC; swapping to a different transport would require changes in the factory and possibly the JSON‑RPC wrapper.

### System structure insights  
`IPCManager` is the hub of the **Trajectory** sub‑system, with its children (channels) exposed to siblings (`SpecstoryAdapter`, `ConnectionRetryManager`, `FileWatchManager`).  The hierarchy is: **Trajectory** → `IPCManager` → channels → adapters/handlers.  All communication funnels through the manager, ensuring a single point for policy enforcement (e.g., security, logging).

### Scalability considerations  
Because channels are created dynamically from a JSON file, scaling to many processes simply requires adding entries to **config.json**.  The underlying **ipc‑main** library may become a bottleneck if the number of concurrent messages grows dramatically; in that case, sharding channels or moving to a dedicated message broker would be a future architectural evolution.  The cache helps mitigate load but must be sized appropriately for larger workloads.

### Maintainability assessment  
The combination of a clear configuration file, well‑defined factory interfaces, and a thin wrapper around a standard library (**ipc‑main**) yields high maintainability.  The explicit separation of concerns—channel provisioning (`IPCManager`), transport abstraction (`messaging‑api`), and business logic (`SpecstoryAdapter`)—makes it easy to locate bugs or extend functionality.  The main maintenance risk lies in the reliance on external libraries (ipc‑main, json‑rpc); version upgrades of those libraries must be tested against the factory contracts and cache behavior.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's use of dependency injection is evident in the SpecstoryAdapter class, where it utilizes a factory pattern to create instances of different connection methods. This is seen in the lib/integrations/specstory-adapter.js file, where the constructor() function is used to initialize the adapter with the required dependencies. The initialize() function is then used to set up the connection, and the logConversation() function is used to log any errors or warnings that occur during the connection process. This pattern allows for loose coupling between the adapter and the connection methods, making it easier to switch between different connection methods or add new ones.

### Siblings
- [ConnectionRetryManager](./ConnectionRetryManager.md) -- ConnectionRetryManager utilizes a factory pattern in lib/integrations/specstory-adapter.js to create instances of different connection methods, allowing for loose coupling between the adapter and the connection methods.
- [FileWatchManager](./FileWatchManager.md) -- FileWatchManager uses a library like chokidar to watch file system events, providing a standardized way of handling file system notifications.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter uses a factory pattern to create instances of different connection methods, allowing for loose coupling between the adapter and the connection methods.


---

*Generated from 6 observations*
