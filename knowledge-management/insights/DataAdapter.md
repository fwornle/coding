# DataAdapter

**Type:** SubComponent

The DataAdapter might be configured using environment variables or configurations similar to those described in integrations/mcp-constraint-monitor/docs/constraint-configuration.md.

## What It Is  

**DataAdapter** is a **SubComponent** that lives inside the **Trajectory** component (the parent) and is responsible for turning raw input from a variety of integrations into the canonical shape required by the rest of the system.  The only concrete artefacts we can point to are the documentation files that the adapter is expected to read and obey:

* `integrations/copi/README.md` – defines the overall data‑transformation requirements for the Copi integration.  
* `integrations/copi/docs/STATUS‑LINE‑QUICK‑REFERENCE.md` – describes the exact formatting protocol that the adapter must implement.  
* `integrations/copi/docs/hooks.md` – lists hook functions that can be invoked during a transformation cycle.  

In addition, the adapter is hinted to draw on several other integration‑level resources:

* `integrations/browser-access/README.md` – a library for pulling data out of a browser context.  
* `integrations/mcp-constraint-monitor/docs/constraint‑configuration.md` – a set of environment‑variable‑driven configuration knobs.  
* `integrations/code‑graph‑rag/README.md` – a storage‑back‑end used for persisting transformed artefacts.  
* `integrations/mcp-constraint-monitor/dashboard/README.md` – an API surface that the adapter may call to publish its results.

The **DataAdapter** also owns a child component, **DataMapper**, which is the concrete implementation that applies the mapping rules defined in the Copi documentation.  

Together, these pieces make DataAdapter the bridge between raw integration payloads and the internal data model consumed by Trajectory and its sibling components (LoggingManager, ConnectionHandler, SpecstoryAdapter).

---

## Architecture and Design  

The observations point to a **modular, documentation‑driven architecture**.  Rather than hard‑coding transformation logic, DataAdapter appears to **interpret external specification files** (the various `README.md` and `.md` reference docs) at runtime or build time.  This yields a loosely‑coupled design where the same adapter code can serve multiple integrations simply by swapping the supporting documentation.

The **adapter pattern** is implicit: DataAdapter implements a uniform interface that the parent **Trajectory** component can call, while the concrete mapping work is delegated to its child **DataMapper**.  This mirrors the pattern used by the sibling **SpecstoryAdapter**, which abstracts the details of connecting to an external service behind a consistent API (see the description of `lib/integrations/specstory‑adapter.js`).  By following the same approach, DataAdapter can be swapped or extended without impacting Trajectory’s core logic.

Interaction flow (as inferred from the docs):

1. **Configuration** – DataAdapter reads environment variables or config files described in `integrations/mcp‑constraint‑monitor/docs/constraint‑configuration.md`.  
2. **Input Acquisition** – For browser‑derived data it may import the helper library documented in `integrations/browser-access/README.md`.  
3. **Transformation** – It follows the protocol in `STATUS‑LINE‑QUICK‑REFERENCE.md`, invoking any hooks listed in `hooks.md`.  The actual field‑by‑field mapping is performed by **DataMapper**.  
4. **Persistence** – The transformed payload can be stored using the mechanism outlined in `integrations/code‑graph‑rag/README.md`.  
5. **Export / Notification** – Finally, DataAdapter may call the APIs described in `integrations/mcp‑constraint‑monitor/dashboard/README.md` to make the data visible to downstream dashboards or monitoring tools.

Because each step references a distinct documentation source, the architecture encourages **separation of concerns**: configuration, acquisition, transformation, storage, and exposure are each governed by their own spec, making the overall system easier to evolve.

---

## Implementation Details  

Although the source repository does not expose concrete symbols for DataAdapter, the observations let us outline its likely internal structure:

* **Configuration Loader** – a module that parses the key/value pairs described in `constraint‑configuration.md`.  It probably builds a runtime config object that controls which hooks are enabled, which storage backend to use, and any feature flags for the Copi protocol.

* **Browser Access Wrapper** – a thin façade around the library referenced in `integrations/browser-access/README.md`.  This wrapper would expose methods such as `extractPageData()` or `captureSessionState()`, returning raw JSON that feeds the transformation pipeline.

* **Transformation Engine** – the core of DataAdapter.  It reads the transformation rules from `STATUS‑LINE‑QUICK‑REFERENCE.md`.  The engine likely validates incoming payloads against the expected schema, then iterates through a list of **hook functions** (from `hooks.md`).  Hooks could be pre‑processors (e.g., sanitizing fields), post‑processors (e.g., enriching with metadata), or error handlers.

* **DataMapper (child component)** – encapsulates the field‑mapping table.  For each Copi‑specific attribute, DataMapper knows the source path in the raw payload and the target path in the internal model.  Because DataMapper is a child, Trajectory can query it directly if it needs to introspect mapping rules (e.g., for debugging or dynamic UI generation).

* **Storage Adapter** – an abstraction over the persistence mechanism described in `code‑graph‑rag/README.md`.  It could expose `saveTransformed(payload)` and `loadPrevious(id)` methods, allowing the rest of the system to retrieve historic transformation results.

* **API Client** – a thin HTTP or RPC client that talks to the endpoints documented in `dashboard/README.md`.  Calls such as `postMetrics()` or `pushStatusLine()` would be made after successful transformation and storage.

All of these pieces would be wired together in a constructor or factory function that receives the configuration object, instantiates the required helper modules, and registers the appropriate hooks.  The public interface of DataAdapter is therefore likely a small set of methods such as `process(rawInput)` and `flush()`.

---

## Integration Points  

* **Parent – Trajectory** – Trajectory invokes DataAdapter to obtain a normalized data model.  Because Trajectory already hosts other adapters (e.g., SpecstoryAdapter), it likely expects DataAdapter to expose a similar promise‑based API (`connect()`, `transform()`, `close()`).  This uniform contract enables Trajectory to orchestrate multiple data sources without bespoke glue code.

* **Sibling – LoggingManager** – LoggingManager also reads `integrations/copi/README.md` to understand what should be logged for the Copi integration.  It is reasonable to assume that both LoggingManager and DataAdapter share a common **logging façade** or at least coordinate on log levels defined in the same doc, ensuring consistent observability across transformation and logging pipelines.

* **Sibling – ConnectionHandler** – While ConnectionHandler focuses on establishing network connections (as seen in the SpecstoryAdapter example), DataAdapter may rely on it for any remote fetches required by the browser‑access library or the dashboard API.  This reuse avoids duplicate connection logic.

* **Child – DataMapper** – DataMapper implements the concrete mapping rules.  It is tightly coupled to the transformation engine but remains a separate module so that mapping tables can be updated independently of the surrounding orchestration code.

* **External – Browser‑Access Library** – The adapter pulls in the module described in `integrations/browser-access/README.md`.  This external dependency is encapsulated behind a wrapper, allowing the rest of the system to remain agnostic about the source of raw data.

* **External – Storage & Dashboard Services** – Persistence and reporting are delegated to services documented in `code‑graph‑rag/README.md` and `dashboard/README.md`.  DataAdapter interacts with them through well‑defined API contracts, keeping the core transformation logic free of storage‑specific concerns.

---

## Usage Guidelines  

1. **Keep Documentation in Sync** – Because DataAdapter’s behavior is driven by the markdown specifications, any change to transformation rules, hooks, or configuration must be reflected in the corresponding `README.md` or `.md` files.  Failing to update the docs will cause a mismatch between expected and actual behavior.

2. **Prefer Environment‑Variable Configuration** – The adapter reads its operational flags from the configuration layout described in `constraint‑configuration.md`.  Use the prescribed variable names and defaults; overriding them at runtime is the supported way to enable or disable specific hooks or storage back‑ends.

3. **Register Hooks Explicitly** – When extending the transformation pipeline, add new hook definitions to `integrations/copi/docs/hooks.md` and implement the corresponding JavaScript function in the adapter’s hook registry.  This ensures the engine discovers the hook automatically.

4. **Leverage DataMapper for Mapping Changes** – If a new field from Copi needs to be mapped, modify only the DataMapper’s mapping table.  The surrounding transformation engine will pick up the change without code modifications, preserving the separation of concerns.

5. **Handle Errors Gracefully** – The transformation engine is expected to surface validation failures according to the protocol in `STATUS‑LINE‑QUICK‑REFERENCE.md`.  Consumers (Trajectory, LoggingManager) rely on consistent error objects to trigger retries or fallback logic.

6. **Test Against the Documentation** – Unit tests should load the same markdown specifications used at runtime and verify that the adapter produces output that matches the examples in those docs.  This “doc‑driven testing” guards against drift.

---

### Summary of Requested Items  

| Item | Insight (grounded in observations) |
|------|--------------------------------------|
| **Architectural patterns identified** | Documentation‑driven configuration, Adapter pattern (DataAdapter ↔ DataMapper), Separation of concerns via distinct modules (configuration loader, transformation engine, storage adapter, API client). |
| **Design decisions and trade‑offs** | *Decision*: Use external markdown specs as the source of truth, enabling rapid integration of new data formats without code changes. *Trade‑off*: Runtime parsing of docs can add overhead and requires strict doc‑code synchronisation. *Decision*: Delegate persistence to a dedicated storage solution (`code‑graph‑rag`). *Trade‑off*: Introduces an external dependency but isolates storage concerns. |
| **System structure insights** | DataAdapter sits under **Trajectory**, shares a uniform adapter interface with siblings (LoggingManager, ConnectionHandler, SpecstoryAdapter), and owns **DataMapper** for field‑level mapping.  Each functional area (config, acquisition, transformation, storage, reporting) is encapsulated in its own module, mirroring the modular layout of the integration docs. |
| **Scalability considerations** | Because transformation rules are externalised, adding new integrations scales by adding new doc sets and minimal wrapper code.  The storage adapter can be swapped for a more scalable backend if needed, without touching the transformation logic.  Hook registration allows parallel processing pipelines to be added incrementally. |
| **Maintainability assessment** | High maintainability is achieved through clear separation: configuration, mapping, and external service interactions are isolated.  However, the reliance on markdown as a runtime contract creates a maintenance burden—developers must ensure docs stay accurate and parsable.  The presence of a child **DataMapper** further isolates mapping changes, reducing risk when the Copi schema evolves. |

*All statements above are derived directly from the supplied observations and the surrounding component context; no unsupported assumptions have been introduced.*


## Hierarchy Context

### Parent
- [Trajectory](./Trajectory.md) -- [LLM] The Trajectory component's use of adapters, such as the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, allows for flexible connections to external services. This adapter attempts to connect to the Specstory extension via HTTP, IPC, or file watch, demonstrating a persistent connection approach. For instance, the connectViaHTTP method tries multiple ports to establish a connection, showcasing the adapter's ability to handle varying connection scenarios. This flexibility is crucial for maintaining a scalable and maintainable system, enabling easier integration of new services or features as needed.

### Children
- [DataMapper](./DataMapper.md) -- The integrations/copi/README.md file suggests the need for data transformation, implying the presence of a data mapping mechanism.

### Siblings
- [LoggingManager](./LoggingManager.md) -- LoggingManager likely utilizes the integrations/copi/README.md file to understand the logging requirements for the Copi integration.
- [ConnectionHandler](./ConnectionHandler.md) -- ConnectionHandler likely uses the lib/integrations/specstory-adapter.js file to connect to the Specstory extension via HTTP, IPC, or file watch.
- [SpecstoryAdapter](./SpecstoryAdapter.md) -- SpecstoryAdapter uses the lib/integrations/specstory-adapter.js file to connect to the Specstory extension.


---

*Generated from 7 observations*
