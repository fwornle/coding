# ConnectionManager

**Type:** SubComponent

ConnectionManager uses the SpecstoryAdapter class (lib/integrations/specstory-adapter.js) to provide methods such as connectViaHTTP (lib/integrations/specstory-adapter.js:134) for establishing HTTP connections.

## What It Is  

**ConnectionManager** is a sub‑component that lives inside the **Trajectory** component. Its implementation is centred around the **SpecstoryAdapter** class located in `lib/integrations/specstory-adapter.js`. Through this adapter it exposes three concrete connection strategies – HTTP, IPC and file‑watch – each implemented as a dedicated method in the adapter (`connectViaHTTP` at line 134, `connectViaIPC` at line 193, and `connectViaFileWatch` at line 241). The sub‑component also owns an **HTTPConnectionHandler** child that encapsulates the HTTP‑specific logic used by `connectViaHTTP`. In the broader system, **IntegrationController** relies on ConnectionManager to open the required channel to the Specstory extension, while **LogManager** consumes the same extension for logging but does not directly interact with ConnectionManager.

---

## Architecture and Design  

The observable architecture follows a **Facade‑Adapter** style. ConnectionManager acts as a façade, presenting a simple, high‑level API for establishing a connection while delegating the actual protocol‑specific work to the **SpecstoryAdapter** (the adapter). This separation keeps the higher‑level Trajectory logic agnostic of the underlying transport mechanism.  

Within the adapter, the three `connectVia*` methods embody a **Strategy**‑like arrangement: each method implements a distinct algorithm for reaching the Specstory extension (HTTP, IPC, file‑watch). The presence of these parallel methods indicates that the system is designed to select the appropriate strategy at runtime based on the execution environment or configuration.  

The hierarchy is explicit: Trajectory (parent) → ConnectionManager (sub‑component) → HTTPConnectionHandler (child). Sibling components – **LogManager** and **IntegrationController** – share the same parent (Trajectory) but address different concerns (logging and orchestration). The fact that IntegrationController “uses the ConnectionManager sub‑component” (as observed) reinforces the façade role: higher‑level orchestration delegates connection responsibilities to ConnectionManager rather than handling protocol details itself.

---

## Implementation Details  

* **SpecstoryAdapter (lib/integrations/specstory-adapter.js)** – the core library that knows how to talk to the Specstory extension. It defines three public methods:
  * `connectViaHTTP` (line 134) – builds an HTTP request, negotiates the handshake, and returns a connection object that HTTPConnectionHandler can further manipulate.
  * `connectViaIPC` (line 193) – opens an inter‑process communication channel (e.g., a Unix socket or named pipe) to the extension.
  * `connectViaFileWatch` (line 241) – watches a file system location for changes that signal a ready connection, then establishes the link.

* **ConnectionManager** – does not implement the low‑level networking itself; instead it imports SpecstoryAdapter and forwards calls to the appropriate `connectVia*` method based on configuration or runtime detection. The manager also instantiates **HTTPConnectionHandler** when the HTTP path is chosen, allowing HTTP‑specific concerns (headers, retries, timeout handling) to be encapsulated away from the generic connection flow.

* **HTTPConnectionHandler** – a child component of ConnectionManager that receives the raw HTTP connection from `connectViaHTTP` and enriches it with higher‑level behaviour (e.g., request queuing, response parsing). Although the observations do not detail its internal API, its existence signals a clear separation between transport acquisition (adapter) and transport utilisation (handler).

* **IntegrationController** – consumes ConnectionManager to obtain a ready connection before orchestrating further integration tasks. It does not need to know whether the connection is HTTP, IPC, or file‑watch; it simply calls the façade provided by ConnectionManager.

* **LogManager** – operates alongside IntegrationController but focuses on logging. Its mention of “the Specstory extension” shows that multiple components share the same external dependency, yet only ConnectionManager directly manages the connection lifecycle.

---

## Integration Points  

1. **SpecstoryAdapter** – the primary external dependency. All connection attempts funnel through this file (`lib/integrations/specstory-adapter.js`). Any change to the adapter’s API would ripple through ConnectionManager and its children.  

2. **HTTPConnectionHandler** – tightly coupled to the HTTP path. It receives the object returned by `connectViaHTTP` and augments it. This handler is the only child explicitly mentioned, implying that IPC and file‑watch may either use lightweight wrappers or rely directly on the adapter’s return values.  

3. **Trajectory (parent)** – owns ConnectionManager and expects it to expose a stable interface for establishing a connection. Trajectory’s broader responsibilities (e.g., adapting to different environments) are satisfied by delegating to the three strategies within SpecstoryAdapter.  

4. **IntegrationController (sibling)** – calls ConnectionManager to acquire a connection before performing higher‑level integration work. The contract between IntegrationController and ConnectionManager is therefore a simple “connect” call that abstracts away transport specifics.  

5. **LogManager (sibling)** – does not directly use ConnectionManager but shares the same external Specstory extension. This parallel usage suggests that the extension provides both operational (connection) and observability (logging) services, and that the system’s modular design keeps these concerns separated.

---

## Usage Guidelines  

* **Select the appropriate strategy early** – When initializing ConnectionManager, determine which of the three integration methods (HTTP, IPC, file‑watch) best matches the deployment environment. Pass this decision to ConnectionManager so it can invoke the corresponding `connectVia*` method on SpecstoryAdapter.  

* **Prefer the façade API** – Call ConnectionManager’s public connection method rather than invoking SpecstoryAdapter directly. This preserves the abstraction barrier and protects callers from future changes in the adapter’s signature.  

* **Handle the returned connection object responsibly** – For HTTP, pass the connection to HTTPConnectionHandler before issuing any requests. For IPC and file‑watch, treat the returned handle according to the documentation of SpecstoryAdapter (e.g., close the socket or stop the file watcher when finished).  

* **Do not duplicate connection logic** – If a new component needs to talk to the Specstory extension, route the request through ConnectionManager. This avoids multiple implementations of the same protocol logic and keeps the system maintainable.  

* **Monitor for adapter updates** – Since all transport logic lives in `lib/integrations/specstory-adapter.js`, any modification (e.g., adding authentication headers to HTTP) must be reflected in ConnectionManager and possibly in HTTPConnectionHandler. Review changelogs of the adapter before upgrading.  

---

### Architectural Patterns Identified  

1. **Facade** – ConnectionManager provides a simplified interface over multiple connection strategies.  
2. **Adapter** – SpecstoryAdapter translates the generic “connect” request into concrete protocol implementations.  
3. **Strategy (implicit)** – Separate `connectViaHTTP`, `connectViaIPC`, and `connectViaFileWatch` methods act as interchangeable algorithms.

### Design Decisions and Trade‑offs  

* **Multiple integration methods** – Decision to support HTTP, IPC, and file‑watch gives the system flexibility across environments (e.g., browser‑based, desktop, CI pipelines). The trade‑off is added complexity in decision logic and testing across three code paths.  
* **Delegation to an external adapter** – Keeps ConnectionManager lightweight and focused on orchestration, but introduces a hard dependency on the adapter’s stability.  
* **Separate HTTP handler** – Isolates HTTP‑specific concerns, improving single‑responsibility adherence; however, it creates an additional class that must be kept in sync with the adapter’s HTTP contract.

### System Structure Insights  

* The hierarchy is cleanly layered: **Trajectory → ConnectionManager → SpecstoryAdapter / HTTPConnectionHandler**.  
* Sibling components (**LogManager**, **IntegrationController**) operate independently but converge on the same external Specstory extension, illustrating a modular approach where each component owns a distinct slice of functionality (logging vs integration orchestration).  
* The presence of a dedicated child (**HTTPConnectionHandler**) suggests that HTTP is a first‑class integration path, possibly the most commonly used in production.

### Scalability Considerations  

* Adding a new transport (e.g., WebSocket) would involve extending SpecstoryAdapter with a new `connectViaWebSocket` method and exposing a corresponding façade call in ConnectionManager. The existing pattern scales without disrupting current paths.  
* Because each strategy is encapsulated, the system can handle increased load on a particular transport (e.g., many concurrent HTTP connections) by scaling the HTTPConnectionHandler independently.  
* The file‑watch approach may have OS‑level limits; careful monitoring would be required if the number of watched files grows substantially.

### Maintainability Assessment  

* **High maintainability** – Clear separation of concerns (facade, adapter, handler) makes the codebase easier to understand and modify.  
* **Potential risk** – The central role of SpecstoryAdapter means any breaking change propagates to all three connection strategies; rigorous unit tests around the adapter are essential.  
* **Documentation alignment** – Since the observations provide explicit file paths and method names, developers can quickly locate the relevant implementation, further supporting maintainability.  

---  

*End of technical insight for **ConnectionManager**.*


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed to handle multiple integration methods, including HTTP, IPC, and file watch, as seen in the SpecstoryAdapter class (lib/integrations/specstory-adapter.js). This adapter class provides methods such as connectViaHTTP (lib/integrations/specstory-adapter.js:134), connectViaIPC (lib/integrations/specstory-adapter.js:193), and connectViaFileWatch (lib/integrations/specstory-adapter.js:241) to establish connections with the Specstory extension. The use of these multiple integration methods allows the Trajectory component to adapt to different environments and connection scenarios.

### Children
- [HTTPConnectionHandler](./HTTPConnectionHandler.md) -- The connectViaHTTP method in lib/integrations/specstory-adapter.js:134 is used to establish HTTP connections.

### Siblings
- [LogManager](./LogManager.md) -- LogManager uses a logging mechanism to format and log conversation entries via the Specstory extension.
- [IntegrationController](./IntegrationController.md) -- IntegrationController uses the ConnectionManager sub-component to establish connections with the Specstory extension.


---

*Generated from 7 observations*
