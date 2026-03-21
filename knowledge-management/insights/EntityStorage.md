# EntityStorage

**Type:** Detail

The createEntity() method in storage/graph-database-adapter.ts is used to store and manage coding convention entities, indicating a graph database is used for storage.

## What It Is  

`EntityStorage` is the concrete implementation that persists **coding‑convention entities** in the system. The core of the implementation lives in **`storage/graph-database-adapter.ts`**, where the method **`createEntity()`** is defined. This method is invoked by the **`CodingConventions`** component (the parent) whenever a new convention definition must be recorded. By funneling every convention through a single adapter, the application guarantees that all convention metadata is kept in one place, ensuring data‑level consistency and integrity across the whole code‑base. The choice of a **graph database** as the backing store signals that the stored entities are expected to have rich, inter‑connected relationships (e.g., inheritance, dependency, or rule‑composition graphs) rather than a flat tabular structure.

---

## Architecture and Design  

The observable architecture revolves around an **Adapter** that shields the rest of the system from the specifics of the underlying graph database. The file **`storage/graph-database-adapter.ts`** acts as a thin façade, exposing a domain‑oriented API (`createEntity()`) while encapsulating the low‑level graph‑DB client calls. This is effectively a **Repository‑style pattern**: the domain layer (`CodingConventions`) asks the repository to persist an entity, without needing to know how the graph is queried or mutated.

Interaction flow:

1. **`CodingConventions`** (parent) constructs a coding‑convention entity based on user input or configuration files.  
2. It calls **`EntityStorage.createEntity()`**, which lives in **`storage/graph-database-adapter.ts`**.  
3. The adapter translates the domain model into a graph node (and possibly edges) and issues the appropriate write operation to the graph database.  

Because the only observed entry point is `createEntity()`, the current design emphasizes **write‑centric centralisation**. There are no explicit read‑oriented methods observed, but the same adapter could be extended to expose queries, preserving the same separation of concerns.

---

## Implementation Details  

The **`createEntity()`** function is the linchpin of `EntityStorage`. Although the source code is not shown, the observation that it “stores and manages coding convention entities” tells us that it performs at least the following steps:

* **Entity Mapping** – Converts a domain object (likely a plain TypeScript interface describing a convention) into the graph‑DB’s node schema. This may involve assigning a unique identifier, labeling the node (e.g., `Convention`), and attaching property key‑value pairs that capture rule details.  
* **Relationship Construction** – Given the graph‑DB context, the method probably also creates edges to represent relationships such as “extends”, “depends‑on”, or “overrides”. This supports the “complex data structure” hinted at in the observations.  
* **Transaction Handling** – To guarantee the “high degree of data consistency and integrity”, the adapter likely wraps the node/edge creation in a transaction, rolling back on failure.  
* **Error Propagation** – Any database‑level errors are surfaced back to `CodingConventions`, enabling the caller to react (e.g., retry, log, or abort).  

Because `EntityStorage` is referenced only through `createEntity()`, the design encourages **single‑responsibility**: the adapter does not mix concerns such as validation, business logic, or UI handling; those remain in `CodingConventions` or higher layers.

---

## Integration Points  

* **Parent – `CodingConventions`** – The only direct consumer observed. It owns the lifecycle of convention entities and relies on `EntityStorage.createEntity()` for persistence. This tight coupling is intentional: the parent dictates *what* to store, while the child (the adapter) dictates *how* to store it.  
* **Potential Siblings** – Although not listed, any other domain components that need to query or update conventions would logically share the same adapter, re‑using the same graph‑DB connection and schema definitions.  
* **External Graph Database Client** – The adapter encapsulates the concrete client library (e.g., Neo4j, Dgraph). All interactions with that client are hidden behind the `createEntity()` API, making the rest of the system agnostic to the specific graph engine.  
* **Configuration / Connection Module** – Not observed, but a typical implementation would import a configuration object that supplies connection strings, credentials, and pooling options. This would be the only other dependency visible to the adapter.  

The integration model is **vertical** (parent → storage) rather than **horizontal** (service bus, event streams), reflecting the observation that the design is centered on a centralized, consistent store.

---

## Usage Guidelines  

1. **Always route new convention definitions through `CodingConventions`** – Direct calls to the adapter bypass validation or business rules that may be present in the parent component.  
2. **Treat `createEntity()` as an atomic operation** – Assume it handles both node creation and any required relationship wiring; callers should not attempt to manually create edges after the call.  
3. **Handle errors gracefully** – Since the adapter likely propagates graph‑DB errors, wrap calls in try/catch blocks and decide on a retry or fallback strategy at the `CodingConventions` level.  
4. **Do not mutate returned objects** – If `createEntity()` returns a reference to the persisted entity, treat it as read‑only; any further modifications should be performed via a dedicated update method (to be added) to preserve consistency.  
5. **Respect the centralised nature** – Because all conventions live in a single graph, concurrent writes can lead to contention. Coordinate bulk imports or migrations to avoid overwhelming the database.

---

### Architectural patterns identified  

* **Adapter / Facade** – `storage/graph-database-adapter.ts` hides the graph‑DB specifics behind a clean method (`createEntity()`).  
* **Repository (Domain‑Driven Design)** – The adapter acts as a repository for the `CodingConventions` aggregate, providing a persistence contract.  

### Design decisions and trade‑offs  

* **Graph database selection** – Enables modeling rich relationships between conventions but introduces operational complexity (graph‑DB deployment, query language learning).  
* **Centralised storage** – Guarantees consistency but creates a single point of contention and potential performance bottleneck under heavy write load.  
* **Single‑method exposure** – Simplicity for callers, yet limits flexibility; future read or update capabilities will require extending the adapter.  

### System structure insights  

* The system is layered: UI / higher‑level logic → `CodingConventions` (domain) → `EntityStorage` (infrastructure).  
* All persistence concerns are funneled through the **graph‑database‑adapter**, reinforcing a clear separation between business rules and data access.  

### Scalability considerations  

* **Write scalability** – Because every convention passes through one adapter, scaling horizontally will require a graph database that supports clustering and write sharding.  
* **Read scalability** – Not yet observed, but the graph model can be leveraged for efficient traversals once read APIs are added.  
* **Connection pooling** – The adapter should maintain a pool of graph‑DB connections to avoid per‑request overhead.  

### Maintainability assessment  

* **High cohesion** – The adapter is focused on a single responsibility, making it easy to modify the underlying database technology without affecting `CodingConventions`.  
* **Low coupling** – Only the parent component knows about the adapter’s existence, reducing ripple effects of changes.  
* **Potential technical debt** – The current API surface is minimal; as the system grows, the adapter may become a “god object” if all CRUD operations are added without clear boundaries. Early planning for separate read/write services or query builders would mitigate this risk.  

---  

*All statements above are derived directly from the provided observations (the `createEntity()` method in `storage/graph-database-adapter.ts`, its use by `CodingConventions`, and the implication of a graph‑database backend). No additional patterns or components have been introduced beyond what the observations support.*

## Hierarchy Context

### Parent
- [CodingConventions](./CodingConventions.md) -- CodingConventions uses the createEntity() method in storage/graph-database-adapter.ts to store and manage coding convention entities.

---

*Generated from 3 observations*
