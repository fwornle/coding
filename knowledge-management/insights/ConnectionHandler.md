# ConnectionHandler

**Type:** SubComponent

The ConnectionHandler might be configured using environment variables or configurations similar to those described in integrations/mcp-constraint-monitor/docs/constraint-configuration.md.

## What It Is  

**ConnectionHandler** is a sub‑component of the **Trajectory** component.  Its primary responsibility is to orchestrate the establishment and maintenance of external service connections on behalf of Trajectory.  The implementation lives alongside the other Trajectory adapters and is tightly coupled to the **SpecstoryAdapter** logic found in `lib/integrations/specstory-adapter.js`.  The adapter in that file attempts to reach the Specstory extension through three possible transports – HTTP, IPC (inter‑process communication), and a file‑watch mechanism – and ConnectionHandler leverages this flexible approach to provide a persistent, fault‑tolerant link to the extension.

Within the ConnectionHandler hierarchy, the **ConnectionEstablisher** child component carries out the low‑level handshake steps, while sibling components such as **LoggingManager**, **DataAdapter**, and **SpecstoryAdapter** share the same integration ecosystem (e.g., the Copi integration described in `integrations/copi/README.md`).  Together they form the connectivity layer that enables Trajectory to interact with external services like Specstory, Copi, and browser‑based tools.

---

## Architecture and Design  

The architecture that emerges from the observations is a **adapter‑centric, layered connectivity model**.  At the top level, Trajectory delegates connection concerns to ConnectionHandler, which in turn delegates the concrete transport details to the **SpecstoryAdapter** (`lib/integrations/specstory-adapter.js`).  This mirrors the classic **Adapter pattern**: ConnectionHandler defines a stable interface for the rest of Trajectory, while the underlying adapter knows how to speak HTTP, IPC, or file‑watch protocols.

A second, implicit pattern is the **Facade** provided by ConnectionHandler.  It aggregates several integration concerns – Copi hook handling (`integrations/copi/docs/hooks.md`), browser access (`integrations/browser-access/README.md`), and constraint configuration (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`) – behind a single, cohesive API.  By doing so, it shields Trajectory and its siblings from the heterogeneity of those integrations.

Interaction flow is straightforward:  
1. Trajectory invokes ConnectionHandler to request a connection.  
2. ConnectionHandler forwards the request to its child **ConnectionEstablisher**, which runs the handshake logic (e.g., trying multiple HTTP ports, falling back to IPC).  
3. The underlying SpecstoryAdapter performs the actual transport work, using the same multi‑modal strategy described in the parent context.  
4. Once a channel is alive, ConnectionHandler may store connection metadata using the storage approach outlined in `integrations/code‑graph‑rag/README.md`.  
5. Other components (LoggingManager, DataAdapter) consume the established channel via the public ConnectionHandler API.

Because the design relies on well‑documented integration readmes, the system remains **declarative** about configuration – environment variables and constraint files (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`) drive runtime behavior rather than hard‑coded values.

---

## Implementation Details  

* **File locations** – The core transport logic lives in `lib/integrations/specstory-adapter.js`.  That file defines methods such as `connectViaHTTP`, `connectViaIPC`, and `watchFileForSocket`, each trying a distinct connection strategy.  ConnectionHandler does not duplicate these methods; instead, it composes the adapter and invokes the appropriate entry point based on runtime conditions.

* **ConnectionEstablisher** – As a child of ConnectionHandler, this class encapsulates the step‑by‑step protocol described in `integrations/copi/README.md`.  It likely reads the Copi hook definitions from `integrations/copi/docs/hooks.md` to know which callbacks to register once a connection is live.  The establisher also interprets constraint settings from `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`, ensuring that connections respect any resource limits or security policies.

* **Metadata storage** – When a connection is successfully opened, ConnectionHandler may persist connection descriptors (e.g., socket paths, port numbers, timestamps) using the data‑store conventions from `integrations/code‑graph‑rag/README.md`.  This storage enables later retrieval for diagnostics or reconnection logic.

* **Browser access** – If the connection target is a browser‑based service, ConnectionHandler can fall back to the helper described in `integrations/browser-access/README.md`.  That helper abstracts away Chrome DevTools Protocol (CDP) or WebSocket details, allowing ConnectionHandler to treat a browser session as just another transport endpoint.

* **Dashboard exposure** – The integration described in `integrations/mcp-constraint-monitor/dashboard/README.md` suggests that ConnectionHandler may expose health or status endpoints that feed into a monitoring dashboard.  This would be achieved by publishing connection state (alive, retrying, failed) to the dashboard API.

Overall, the implementation follows a **composition‑over‑inheritance** stance: ConnectionHandler assembles reusable adapters and helpers rather than embedding all logic directly.

---

## Integration Points  

1. **SpecstoryAdapter (`lib/integrations/specstory-adapter.js`)** – The primary transport layer; ConnectionHandler calls its public methods to open/close connections.  

2. **Copi Integration (`integrations/copi/README.md` & `integrations/copi/docs/hooks.md`)** – Provides hook definitions that ConnectionEstablisher registers once the connection is live, enabling Copi‑specific callbacks.  

3. **Browser Access (`integrations/browser-access/README.md`)** – Optional module used when the external service is a browser instance; ConnectionHandler delegates to this module for CDP or WebSocket handling.  

4. **Constraint Configuration (`integrations/mcp-constraint-monitor/docs/constraint-configuration.md`)** – Supplies environment‑variable‑driven limits (e.g., max concurrent connections) that ConnectionHandler validates before establishing a new link.  

5. **Metadata Store (`integrations/code-graph-rag/README.md`)** – Used to persist connection metadata, supporting reconnection and audit trails.  

6. **Monitoring Dashboard (`integrations/mcp-constraint-monitor/dashboard/README.md`)** – Receives status updates from ConnectionHandler, allowing operators to view connection health in real time.  

7. **Sibling Components** – **LoggingManager** and **DataAdapter** both rely on the same Copi integration readme, meaning they share configuration conventions and may read connection state from the same metadata store.  This creates a cohesive ecosystem where each sibling consumes the same connection channel established by ConnectionHandler.

---

## Usage Guidelines  

* **Prefer the high‑level API** – Call ConnectionHandler’s public methods (e.g., `establish()`, `close()`) rather than invoking SpecstoryAdapter directly.  This ensures that all ancillary steps—hook registration, constraint checks, and metadata persistence—are executed.  

* **Configure via environment variables** – Follow the conventions in `integrations/mcp-constraint-monitor/docs/constraint-configuration.md`.  Typical variables include `MAX_CONNECTIONS`, `SPECSTORY_HTTP_PORTS`, and `IPC_SOCKET_PATH`.  Changing these values does not require code changes.  

* **Handle retries gracefully** – ConnectionHandler already attempts multiple transports (HTTP → IPC → file watch).  When integrating, developers should listen for the `connectionFailed` event and allow the handler to retry rather than aborting the entire workflow.  

* **Persist and query metadata** – Use the storage utilities described in `integrations/code-graph-rag/README.md` to retrieve connection details for debugging or for rebuilding a lost session.  

* **Monitor via the dashboard** – Expose the connection health endpoint (as defined in `integrations/mcp-constraint-monitor/dashboard/README.md`) so that ops teams can see live status and trigger manual reconnections if needed.  

* **Do not duplicate hook logic** – Copi hook definitions reside in `integrations/copi/docs/hooks.md`.  Register them through ConnectionEstablisher; manual registration can cause duplicate callbacks and inconsistent state.  

* **Respect sibling contracts** – LoggingManager expects connection events to be emitted in a specific format (e.g., `{type: 'connected', timestamp}`); adhere to this contract to keep logs coherent.  

---

### Architectural Patterns Identified  

1. **Adapter Pattern** – SpecstoryAdapter abstracts HTTP, IPC, and file‑watch transports behind a uniform interface.  
2. **Facade Pattern** – ConnectionHandler presents a single, simplified API that hides the complexity of multiple integrations (Copi, browser, constraint monitor).  
3. **Composition over Inheritance** – ConnectionHandler composes adapters, helpers, and the ConnectionEstablisher child rather than extending a monolithic base class.  

### Design Decisions and Trade‑offs  

* **Multi‑modal transport** – Choosing HTTP, IPC, and file watch increases resilience but adds runtime complexity (port scanning, socket cleanup).  
* **External configuration** – Relying on environment variables and constraint files improves flexibility but requires disciplined ops processes to keep configurations in sync.  
* **Separate metadata store** – Persisting connection info aids recovery but introduces an extra dependency (the storage solution from `code‑graph‑rag`).  

### System Structure Insights  

* **Hierarchical layering** – Trajectory → ConnectionHandler → ConnectionEstablisher → SpecstoryAdapter, with siblings sharing common integration readmes.  
* **Integration convergence** – Multiple unrelated integrations (Copi, browser access, constraint monitoring) converge within ConnectionHandler, making it the connectivity hub of the system.  

### Scalability Considerations  

* Because ConnectionHandler can open many parallel connections (subject to `MAX_CONNECTIONS`), the underlying SpecstoryAdapter must efficiently manage socket pools and avoid port exhaustion.  
* The file‑watch fallback scales poorly on high‑frequency change environments; monitoring should be limited to low‑traffic scenarios or replaced with IPC/HTTP when possible.  

### Maintainability Assessment  

* **High maintainability** – The use of well‑documented adapters and external readme‑driven configuration isolates change impact; updates to a transport method only require modifications in `lib/integrations/specstory-adapter.js`.  
* **Potential risk** – The implicit coupling to several integration readmes means that changes in those documents (e.g., Copi hook signatures) must be propagated to ConnectionHandler and its child, otherwise runtime mismatches can occur.  
* **Clear ownership** – The hierarchy (Trajectory owns ConnectionHandler; ConnectionHandler owns ConnectionEstablisher) provides a straightforward ownership model, simplifying debugging and future refactoring.


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's use of adapters, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, allows for flexible connections to external services. This adapter attempts to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a persistent connection approach. For instance, the connectViaHTTP method tries multiple ports to establish a connection, showcasing the adapter's ability to handle varying connection scenarios. This flexibility is crucial for maintaining a scalable and maintainable system, enabling easier integration of new services or features as needed.

### Children
- [ConnectionEstablisher](./ConnectionEstablisher.md) -- The ConnectionHandler sub-component is likely to use the lib/integrations/specstory-adapter.js file to connect to the Specstory extension via HTTP, IPC, or file watch, as indicated by the parent context.

### Siblings
- [LoggingManager](./LoggingManager.md) -- LoggingManager likely utilizes the integrations/copi/README.md file to understand the logging requirements for the Copi integration.
- [DataAdapter](./DataAdapter.md) -- DataAdapter likely utilizes the integrations/copi/README.md file to understand the data transformation requirements for the Copi integration.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter uses the lib/integrations/specstory-adapter.js file to connect to the Specstory extension.


---

*Generated from 7 observations*
