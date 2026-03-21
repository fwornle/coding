# DataFormatter

**Type:** SubComponent

DataFormatter uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to format data according to Specstory's requirements

## What It Is  

**DataFormatter** is a dedicated sub‑component that lives inside the **Trajectory** module.  Its implementation resides in the same logical layer as the other Trajectory children and is wired to the **SpecstoryAdapter** class found at `lib/integrations/specstory-adapter.js`.  The primary responsibility of DataFormatter is to take raw payloads generated elsewhere in the system and transform them so that they conform to the data contract expected by the Specstory extension.  By centralising this transformation logic, the component provides a single source of truth for all Specstory‑bound data, which is then handed off to the **ConnectionManager** for transmission.

The component is built as a class‑based object, enabling encapsulation and reuse across the codebase.  It is invoked by sibling components such as **ConversationLogger**, which delegates its own logging payloads to DataFormatter before they are sent downstream.  Because DataFormatter is a child of **Trajectory**, it inherits the same modular design philosophy that the parent component exhibits – namely, the use of well‑defined adapters, asynchronous initialization, and promise‑based flow control.

## Architecture and Design  

The architecture around DataFormatter follows a **modular component pattern** reinforced by the **Adapter pattern**.  The `SpecstoryAdapter` acts as the concrete adapter that knows the exact shape of Specstory’s API; DataFormatter composes this adapter rather than embedding Specstory‑specific logic directly.  This composition keeps the formatting code agnostic of transport concerns and isolates any future changes to the Specstory contract within a single file (`lib/integrations/specstory-adapter.js`).  

Interaction between components is orchestrated through **promise‑based asynchronous programming**.  When DataFormatter receives a formatting request, it returns a promise that resolves with the formatted payload.  This non‑blocking approach mirrors the pattern used in the parent **Trajectory** component’s `initialize` method, where promises ensure that initialization does not stall other system activity.  Errors that arise during formatting are not handled locally; instead, they are delegated to the **ErrorManager** sub‑component, establishing a clear **separation‑of‑concerns** boundary between data transformation and error reporting.  

Finally, the **ConnectionManager** sub‑component is consulted to determine the appropriate channel (e.g., WebSocket, HTTP, or native extension) for sending the formatted data.  By abstracting the transport layer, DataFormatter remains focused on its core duty—formatting—while still participating in the overall data‑flow pipeline that includes **SpecstoryConnector**, **ConversationLogger**, and other siblings.

## Implementation Details  

At its core, DataFormatter is a class that exposes one or more public methods such as `format(payload)` (the exact method name is not enumerated in the observations but is implied by its purpose).  Inside this method the component performs the following steps:

1. **Adapter Invocation** – It calls into `SpecstoryAdapter` (imported from `lib/integrations/specstory-adapter.js`) to apply the Specstory‑specific schema.  The adapter encapsulates field renaming, type coercion, and any required nesting, ensuring that the output matches the extension’s contract.  

2. **Asynchronous Execution** – The call to the adapter, as well as any subsequent I/O (e.g., reading configuration or fetching auxiliary data), is wrapped in a promise.  This design lets callers `await` the result without blocking the event loop, a pattern also visible in the parent Trajectory’s asynchronous initialization flow.  

3. **Error Propagation** – Should the adapter throw or a promise reject, DataFormatter catches the exception and forwards it to **ErrorManager**.  This hand‑off is likely performed via a method such as `ErrorManager.handle(error)`, keeping the formatting logic clean and allowing a centralized error‑logging strategy.  

4. **Connection Coordination** – Once the payload is successfully formatted, DataFormatter does not send it directly.  Instead, it delegates the transmission decision to **ConnectionManager**, which determines the active connection method (e.g., a WebSocket opened by **SpecstoryConnector**).  This delegation is performed through an interface like `ConnectionManager.send(formattedPayload)`.  

Because DataFormatter is used by **ConversationLogger**, any logging routine that needs to persist conversation data will first invoke DataFormatter, guaranteeing that all logged entries share the same Specstory‑compatible shape.

## Integration Points  

DataFormatter sits at the intersection of three major subsystems:

* **SpecstoryAdapter** (`lib/integrations/specstory-adapter.js`) – Provides the concrete transformation rules.  Any change to the Specstory API will be reflected here, and DataFormatter will automatically adopt the new schema without code changes.  

* **ErrorManager** – Acts as the error‑handling sink.  DataFormatter forwards any formatting‑related exceptions, ensuring that failures are captured consistently across the system.  

* **ConnectionManager** – Supplies the transport abstraction.  By invoking ConnectionManager’s send routine, DataFormatter remains agnostic of whether the data travels over a native extension, HTTP endpoint, or any other channel established by sibling components like **SpecstoryConnector**.  

Additionally, the **Trajectory** parent component orchestrates the lifecycle of DataFormatter.  When Trajectory is instantiated, it likely creates a DataFormatter instance and injects the required adapter, error manager, and connection manager references.  This wiring mirrors the pattern used by other siblings (e.g., **TrajectoryInitializer** also relies on `SpecstoryAdapter`), reinforcing a consistent dependency graph throughout the module.

## Usage Guidelines  

Developers should treat DataFormatter as a **pure formatting service**—its only responsibility is to accept raw data and return a Specstory‑ready object.  When invoking the component, always handle the returned promise and propagate any errors to **ErrorManager** rather than swallowing them.  For example:

```js
await dataFormatter.format(rawPayload)
  .then(formatted => connectionManager.send(formatted))
  .catch(err => errorManager.handle(err));
```

Do not embed Specstory‑specific field mappings inside calling code; rely on the adapter‑driven implementation to keep those details centralized.  When extending the system (e.g., adding a new logging sibling), simply inject the existing DataFormatter instance rather than duplicating formatting logic.  Finally, because DataFormatter is asynchronous, avoid blocking the event loop with long‑running synchronous operations inside the `format` method; any heavy computation should be off‑loaded to worker threads or broken into smaller promise‑chained steps.

---

### Architectural Patterns Identified
1. **Adapter Pattern** – `SpecstoryAdapter` isolates external Specstory schema details.  
2. **Modular Component Architecture** – DataFormatter is a self‑contained sub‑component under Trajectory with clear boundaries.  
3. **Asynchronous / Promise‑Based Concurrency** – Non‑blocking formatting and integration with other async components.  
4. **Separation of Concerns** – Error handling delegated to ErrorManager; transport delegated to ConnectionManager.

### Design Decisions & Trade‑offs  
* **Centralised Formatting** improves consistency but introduces a single point of failure; mitigated by ErrorManager.  
* **Adapter Isolation** keeps Specstory changes localized, at the cost of an extra indirection layer.  
* **Promise‑Based API** enables concurrency and scalability, yet requires careful error handling to avoid unhandled rejections.  
* **Delegating Transport** to ConnectionManager decouples formatting from networking, but adds runtime dependency on the connection state.

### System Structure Insights  
The system is organized around a **parent‑child hierarchy** where Trajectory coordinates several specialized siblings.  Each sibling (SpecstoryConnector, ConversationLogger, etc.) shares common infrastructure—SpecstoryAdapter, ConnectionManager, ErrorManager—promoting reuse.  DataFormatter acts as a bridge between raw domain data and the Specstory‑oriented downstream pipeline.

### Scalability Considerations  
Because formatting is asynchronous and promise‑driven, the component can handle many concurrent requests without blocking the event loop.  Scaling horizontally (e.g., spawning multiple Node.js worker processes) would be straightforward as long as the underlying `SpecstoryAdapter` and `ConnectionManager` are stateless or correctly synchronized.  Potential bottlenecks include the connection bandwidth managed by ConnectionManager and any synchronous CPU‑heavy transformations inside the adapter.

### Maintainability Assessment  
Encapsulation via classes and clear delegation to adapter, error, and connection managers yields high maintainability.  Changes to the Specstory contract are isolated to `lib/integrations/specstory-adapter.js`.  The promise‑based API enforces a uniform error‑handling contract across the codebase.  The main maintenance risk lies in the implicit coupling to the adapter’s interface; thorough unit tests around DataFormatter’s `format` method and the adapter’s schema mapping are essential to guard against regression as Specstory evolves.

## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's modular design pattern is evident in its use of classes and objects, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which enables encapsulation and reuse of code. This modularity is further enhanced by the component's asynchronous programming model, which allows for efficient and concurrent execution of tasks. For instance, the initialize method in the Trajectory class utilizes asynchronous programming to initialize the component without blocking other tasks. The use of promises in this method, as seen in the return statement, ensures that the component's initialization is non-blocking and efficient.

### Siblings
- [SpecstoryConnector](./SpecstoryConnector.md) -- SpecstoryConnector uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to establish a connection to the Specstory extension
- [ConversationLogger](./ConversationLogger.md) -- ConversationLogger uses the DataFormatter sub-component to format data according to Specstory's requirements
- [ErrorManager](./ErrorManager.md) -- ErrorManager uses the ConnectionManager sub-component to oversee the connection methods used to log errors
- [ConnectionManager](./ConnectionManager.md) -- ConnectionManager uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to establish a connection to the Specstory extension
- [TrajectoryInitializer](./TrajectoryInitializer.md) -- TrajectoryInitializer uses the SpecstoryAdapter class in lib/integrations/specstory-adapter.js to initialize the Trajectory component

---

*Generated from 7 observations*
