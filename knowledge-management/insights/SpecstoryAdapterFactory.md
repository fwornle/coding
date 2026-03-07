# SpecstoryAdapterFactory

**Type:** Detail

The connectViaHTTP, connectViaIPC, and connectViaFileWatch methods are implemented in the SpecstoryAdapter class to establish connections.

## What It Is  

**SpecstoryAdapterFactory** is the factory component that lives inside the *SpecstoryConnector* package and is responsible for instantiating concrete **SpecstoryAdapter** objects. The concrete adapter implementation resides in `lib/integrations/specstory-adapter.js`. The adapter itself exposes three connection primitives – `connectViaHTTP`, `connectViaIPC`, and `connectViaFileWatch` – that the rest of the system uses to open a link to a Specstory service. In practice, a consumer of **SpecstoryConnector** does not instantiate the adapter directly; instead it asks the connector to create an adapter through **SpecstoryAdapterFactory**, specifying the desired connection method (HTTP, IPC, or file‑watch). The factory then returns a ready‑to‑use adapter instance that implements the requested method.

---

## Architecture and Design  

The observable design is built around a **Factory pattern**. The **SpecstoryAdapterFactory** encapsulates the logic that decides *which* concrete adapter to supply based on a configuration value (the connection method). This isolates the creation logic from the rest of the code base and gives **SpecstoryConnector** a single, stable entry point for obtaining a connection‑capable object.

The **SpecstoryAdapter** itself behaves like an **Adapter** (in the classic GoF sense) that translates the higher‑level connector API into three concrete transport mechanisms – HTTP, inter‑process communication (IPC), and file‑system watching. Each of those transports is expressed as a separate method (`connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch`) inside the same class, which hints at a **Strategy‑like** organization: the adapter holds multiple strategies for establishing a link, and the factory selects the appropriate one at instantiation time.

Interaction flow (derived from the observations):

1. **SpecstoryConnector** receives a request to connect using a particular method.  
2. It delegates to **SpecstoryAdapterFactory**, passing the method identifier.  
3. **SpecstoryAdapterFactory** creates a **SpecstoryAdapter** (or a subclass, if future extensions require it) and returns it to the connector.  
4. The connector then invokes the matching `connectVia*` method on the returned adapter to establish the actual connection.

Because the factory is *contained* within **SpecstoryConnector**, the connector owns the lifecycle of its adapters, reinforcing a clear ownership boundary and reducing the risk of orphaned connections.

---

## Implementation Details  

The only concrete implementation we can reference is the file `lib/integrations/specstory-adapter.js`. Inside this module lives the **SpecstoryAdapter** class, which defines three public methods:

* `connectViaHTTP(options)`: Opens a network socket to a Specstory endpoint using standard HTTP semantics. The method likely accepts an options object containing host, port, headers, etc., although the exact signature is not disclosed in the observations.
* `connectViaIPC(path)`: Establishes an inter‑process communication channel, probably using a Unix domain socket or named pipe identified by `path`. This method is suited for local‑only deployments where low latency is required.
* `connectViaFileWatch(filePath)`: Sets up a file‑system watcher on `filePath` and treats file changes as a signalling mechanism for communication with Specstory. This is a lightweight, file‑based integration useful in environments where network or IPC primitives are unavailable.

The **SpecstoryAdapterFactory** (implicitly part of the *SpecstoryConnector* codebase) contains a simple decision table or switch statement that maps a string such as `"http"`, `"ipc"`, or `"fileWatch"` to the corresponding method on a newly created **SpecstoryAdapter** instance. Because no separate subclass hierarchy is mentioned, the factory most likely returns the same **SpecstoryAdapter** class each time, leaving the caller to invoke the correct `connectVia*` method based on the original request.

The separation of concerns is evident: the adapter knows *how* to talk to Specstory via each transport, while the factory knows *which* transport the caller wants. This keeps the connector code tidy and prevents it from being littered with transport‑specific conditionals.

---

## Integration Points  

* **Parent – SpecstoryConnector**: The connector holds a reference to **SpecstoryAdapterFactory**. All external callers interact with the connector; they never import the adapter or the factory directly. This encapsulation ensures that any change to the underlying transport logic does not ripple out to consumer code.
* **Sibling – Other adapters** (not observed but implied): If the system later introduces additional adapters (e.g., a WebSocket‑based adapter), they would be created by the same factory, preserving a uniform creation interface.
* **Child – SpecstoryAdapter**: The factory’s only child is the **SpecstoryAdapter** class defined in `lib/integrations/specstory-adapter.js`. The adapter implements the three connection methods that other parts of the system rely on.
* **External dependencies**: While not explicitly listed, the three `connectVia*` methods are expected to depend on standard Node.js modules (`http`, `net`, `fs`/`fs.watch`) or third‑party libraries that provide HTTP, IPC, and file‑watch capabilities. The factory itself likely has no external dependencies beyond the adapter module.

---

## Usage Guidelines  

1. **Never instantiate SpecstoryAdapter directly** – always go through **SpecstoryConnector**. The connector will internally call **SpecstoryAdapterFactory** to obtain the correctly configured adapter.
2. **Specify the connection method explicitly** when invoking the connector’s connect routine. The method string (e.g., `"http"`, `"ipc"`, `"fileWatch"`) determines which `connectVia*` implementation the factory will expose.
3. **Pass transport‑specific options to the connector** that will be forwarded to the adapter’s method. For HTTP, include host/port; for IPC, include the socket path; for file‑watch, include the file path.
4. **Handle lifecycle events** (open, error, close) on the returned connection object. Because the adapter abstracts the transport, the same event‑handling pattern can be used regardless of the underlying mechanism.
5. **Extend via the factory** if a new transport is required. Add a new case to the factory’s selection logic and implement the corresponding `connectVia*` method in `lib/integrations/specstory-adapter.js` (or a new subclass). This preserves the existing API contract.

---

### Architectural Patterns Identified  

| Pattern | Where It Appears | Rationale |
|---------|------------------|-----------|
| **Factory** | `SpecstoryAdapterFactory` inside *SpecstoryConnector* | Centralises creation of adapters based on a connection‑method key. |
| **Adapter** | `SpecstoryAdapter` (`lib/integrations/specstory-adapter.js`) | Provides a uniform interface (`connectVia*`) that translates higher‑level calls into transport‑specific logic. |
| **Strategy (implicit)** | Separate `connectViaHTTP`, `connectViaIPC`, `connectViaFileWatch` methods | Each method encapsulates a distinct algorithm for establishing a connection. |

---

### Design Decisions & Trade‑offs  

* **Indirection vs. Simplicity** – Introducing a factory adds an extra layer of indirection, which can seem unnecessary for only three connection types. However, it isolates creation logic, making future extensions (new transports) painless and keeping the connector’s public API stable.  
* **Single Adapter vs. Subclass per Transport** – The current design keeps all three transports in one class. This reduces class proliferation but can lead to a larger, more complex class file. If transport logic diverges significantly, a subclass per transport could improve separation at the cost of more files.  
* **Method‑Based Strategy vs. Polymorphic Strategy Objects** – Using separate methods (`connectVia*`) is straightforward but forces callers (or the factory) to know which method to call. A polymorphic strategy object (e.g., `HttpAdapter`, `IpcAdapter`) would allow the caller to treat every adapter uniformly (`adapter.connect()`). The chosen approach favours minimal code overhead.

---

### System Structure Insights  

* **Vertical hierarchy** – *SpecstoryConnector* → **SpecstoryAdapterFactory** → **SpecstoryAdapter** → transport‑specific code.  
* **Horizontal cohesion** – All transport implementations are co‑located in a single file (`lib/integrations/specstory-adapter.js`), indicating a tightly coupled adapter module.  
* **Encapsulation boundary** – The connector is the sole public façade; the factory and adapter remain internal implementation details, which protects the system from accidental misuse.

---

### Scalability Considerations  

* **Adding new transports** scales linearly: a new `connectViaXYZ` method plus a factory case. Because the factory abstracts creation, the rest of the system does not need to change.  
* **Concurrent connections** – Since each adapter instance encapsulates its own transport, the system can spawn many adapters in parallel without interference, assuming the underlying Node.js primitives (HTTP agents, IPC sockets, file watchers) are used responsibly.  
* **Resource consumption** – File‑watch based connections can be heavy on the OS if many files are monitored; the design should ensure that `connectViaFileWatch` is used sparingly or with proper throttling.

---

### Maintainability Assessment  

* **Clear separation of concerns** – The factory isolates object creation, and the adapter isolates transport logic, both of which are classic, well‑understood patterns that aid maintainability.  
* **Low code duplication** – All transport methods share the same class, reducing duplicated scaffolding (constructor, error handling). However, if the methods grow in complexity, the single class could become a maintenance hotspot.  
* **Testability** – The factory can be unit‑tested by mocking the adapter and verifying that the correct method is selected for each connection type. Each `connectVia*` method can be tested in isolation with stubs for the underlying Node.js APIs.  
* **Documentation surface** – Because the public API is funneled through the connector, developers only need to learn one entry point, which simplifies onboarding and reduces the chance of misuse.  

Overall, **SpecstoryAdapterFactory** provides a concise, extensible mechanism for selecting among a small but well‑defined set of connection strategies, leveraging established design patterns without unnecessary complexity.


## Hierarchy Context

### Parent
- [SpecstoryConnector](./SpecstoryConnector.md) -- SpecstoryConnector uses the SpecstoryAdapter class (lib/integrations/specstory-adapter.js) to provide methods such as connectViaHTTP, connectViaIPC, and connectViaFileWatch for establishing connections


---

*Generated from 3 observations*
