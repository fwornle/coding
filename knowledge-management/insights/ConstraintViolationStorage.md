# ConstraintViolationStorage

**Type:** Detail

The integrations/mcp-constraint-monitor/docs/constraint-configuration.md file provides a guide for constraint configuration, which might be relevant to the storage of constraint violations.

## What It Is  

**ConstraintViolationStorage** is the persistence layer that lives inside the **ViolationCaptureModule**.  The only concrete locations that mention this component are the documentation files under the *integrations* folder:  

* `integrations/mcp-constraint-monitor/README.md` – introduces the MCP Constraint Monitor, a subsystem that consumes constraint‑violation data.  
* `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` – describes how constraints are configured for the monitor, implying that the monitor expects a store of violations to query.  
* `integrations/copi/docs/STATUS-LINE-QUICK-REFERENCE.md` – talks about the Copi Status Line Integration, which can surface constraint‑violation information on a user‑facing status line.  

From the hierarchy note we know that **ViolationCaptureModule** “captures constraint violations from tool interactions and stores them in a database.”  Therefore, **ConstraintViolationStorage** is the concrete implementation that writes those captured violations to that database and makes them queryable for downstream consumers such as the MCP Constraint Monitor and the Copi status line.  No source files or class definitions are listed in the current snapshot, but the naming and placement strongly suggest a dedicated storage abstraction (e.g., a repository or DAO) that hides the underlying DB technology from its callers.

---

## Architecture and Design  

The limited evidence points to a **modular, layered architecture**.  The *ViolationCaptureModule* acts as a high‑level service that orchestrates the capture of violations, while **ConstraintViolationStorage** provides the data‑access layer.  This separation follows the classic **Service‑Repository pattern**: the service (ViolationCaptureModule) contains business logic, and the repository (ConstraintViolationStorage) is responsible for persisting and retrieving domain objects (the violations).  

Interaction flows can be inferred from the documentation hierarchy:

1. **Tool integrations** emit raw constraint‑violation events.  
2. **ViolationCaptureModule** receives those events, performs any necessary enrichment (e.g., adding timestamps, source identifiers), and forwards the enriched objects to **ConstraintViolationStorage**.  
3. **ConstraintViolationStorage** writes the records into a database (the exact DB is not disclosed).  
4. Consumers such as the **MCP Constraint Monitor** (documented in `integrations/mcp-constraint-monitor/README.md`) and the **Copi Status Line Integration** (`integrations/copi/docs/STATUS-LINE-QUICK-REFERENCE.md`) query the storage to display or act on violations.

Because the only concrete artefacts are markdown files, we cannot point to a specific implementation pattern (e.g., ORM, NoSQL driver).  However, the presence of a dedicated storage component indicates an intention to keep persistence concerns isolated, which eases substitution of the underlying store and supports testability via mock implementations.

---

## Implementation Details  

No code symbols were discovered in the supplied snapshot, so we cannot list concrete classes, methods, or SQL statements.  What we can assert from the naming and surrounding documentation is:

* **ConstraintViolationStorage** is likely an interface or abstract class that defines operations such as `saveViolation(violation)`, `findByConstraintId(id)`, and `listRecentViolations()`.  
* The **ViolationCaptureModule** probably holds a reference to an implementation of this interface—either injected via a constructor or looked up via a service locator, following typical dependency‑injection practices.  
* The database schema (not shown) would contain at least columns for the constraint identifier, violation message, severity, timestamp, and source tool.  The configuration guide in `constraint-configuration.md` may contain keys that map constraint definitions to storage policies (e.g., retention periods, indexing).  

Because the MCP Constraint Monitor reads configuration from the same `constraint-configuration.md`, it is reasonable to infer that the monitor and the storage share a **contract** defined by that configuration file.  The contract likely includes the names of tables or collections, query parameters, and possibly pagination rules.  The Copi status line integration, on the other hand, probably uses a lightweight query (e.g., “latest N violations”) to render a concise view for the user.

---

## Integration Points  

1. **MCP Constraint Monitor** – The README (`integrations/mcp-constraint-monitor/README.md`) positions the monitor as a consumer of constraint‑violation data.  The monitor will call into **ConstraintViolationStorage** (or a service that wraps it) to retrieve violations that match the configured constraints.  The `constraint-configuration.md` file is the shared source of truth for which constraints are monitored, meaning that any change in configuration directly influences the queries issued against the storage layer.

2. **Copi Status Line Integration** – The quick‑reference guide (`integrations/copi/docs/STATUS-LINE-QUICK-REFERENCE.md`) indicates that Copi can surface violation information on a status line.  This integration likely performs a read‑only query against **ConstraintViolationStorage**, perhaps using a cached view to keep UI latency low.  The status line’s “quick reference” nature suggests that the integration only needs a subset of fields (e.g., constraint name and severity).

3. **Parent Module – ViolationCaptureModule** – The parent module owns the lifecycle of **ConstraintViolationStorage**.  When a new tool integration reports a violation, the module validates the payload against the constraint definitions (as described in the configuration docs) and then delegates persistence to the storage component.  This tight coupling ensures that all captured violations follow a uniform schema before they are stored.

No other sibling components are mentioned, but any future module that needs historical violation data (e.g., reporting dashboards, audit services) would naturally hook into **ConstraintViolationStorage** using the same read APIs.

---

## Usage Guidelines  

* **Configure constraints centrally** – All consumers rely on the `integrations/mcp-constraint-monitor/docs/constraint-configuration.md` file.  Keep this file up‑to‑date; adding or removing a constraint there automatically changes what the monitor and any UI integrations will see.  Do not duplicate constraint definitions elsewhere.

* **Write‑through via ViolationCaptureModule** – Direct calls to **ConstraintViolationStorage** should be avoided by application code.  All writes must pass through the **ViolationCaptureModule** so that validation, enrichment, and logging occur consistently.  This also guarantees that any future business rules (e.g., de‑duplication, throttling) are applied uniformly.

* **Read‑only contracts for consumers** – Consumers such as the MCP monitor and Copi status line should treat the storage as a read‑only data source.  If a consumer needs to modify a violation (e.g., to acknowledge it), it should request the **ViolationCaptureModule** to perform that operation, preserving a single point of mutation.

* **Performance considerations** – Since the storage backs real‑time monitoring dashboards, queries should be indexed on constraint identifiers and timestamps.  Although the exact DB is unknown, the configuration documentation likely contains recommendations for indexing; follow those to avoid latency spikes in the monitor.

* **Testing** – When unit‑testing modules that depend on **ConstraintViolationStorage**, replace the concrete implementation with a mock or in‑memory stub that respects the same method signatures.  Because the storage is isolated behind an interface, this substitution should be straightforward.

---

### Architectural Patterns Identified  

* **Service‑Repository (or Service‑DAO) pattern** – Separation of business logic (ViolationCaptureModule) from persistence (ConstraintViolationStorage).  
* **Configuration‑driven integration** – Both the MCP monitor and Copi status line rely on the same constraint‑configuration markdown file, indicating a declarative integration style.

### Design Decisions & Trade‑offs  

* **Isolation of persistence** – By encapsulating DB access in **ConstraintViolationStorage**, the system can swap the underlying database without touching capture logic.  The trade‑off is the extra indirection layer, which adds minimal overhead but improves testability.  
* **Shared configuration file** – Using a single markdown file for constraint definitions reduces duplication but couples all consumers to the file’s format and location.  Any parsing errors could affect multiple integrations simultaneously.

### System Structure Insights  

* **Parent‑child relationship** – **ViolationCaptureModule** → **ConstraintViolationStorage**.  
* **Sibling consumers** – MCP Constraint Monitor and Copi Status Line both act as read‑only clients of the storage, forming a fan‑out pattern from a single data source.  
* **Potential extension points** – New monitoring tools or UI widgets can be added by reusing the same read APIs, provided they adhere to the configuration contract.

### Scalability Considerations  

* **Write volume** – If many tools generate violations concurrently, the storage must handle high insert rates.  Choosing a DB with efficient batch inserts or partitioning by constraint ID can mitigate contention.  
* **Read patterns** – The monitor may poll for recent violations; indexing on timestamps and constraint IDs will keep these reads fast.  Caching recent results (e.g., in an in‑memory store) could further reduce load.  
* **Horizontal scaling** – Because the storage is abstracted, scaling out can be achieved by moving to a distributed database or adding read replicas without changing the capture module.

### Maintainability Assessment  

* **High cohesion, low coupling** – The clear separation between capture, storage, and consumer modules makes each piece independently maintainable.  
* **Documentation‑driven contracts** – Reliance on markdown configuration files simplifies onboarding but requires disciplined documentation practices.  
* **Lack of visible code** – The current snapshot provides no concrete code, which hampers deep static analysis.  Introducing a small set of well‑named interfaces and unit tests would improve traceability and future refactoring confidence.  

Overall, **ConstraintViolationStorage** appears to be a deliberately isolated persistence component that enables multiple monitoring and UI integrations to share a consistent view of constraint violations while allowing the underlying storage technology to evolve independently.

## Hierarchy Context

### Parent
- [ViolationCaptureModule](./ViolationCaptureModule.md) -- ViolationCaptureModule captures constraint violations from tool interactions and stores them in a database.

---

*Generated from 3 observations*
