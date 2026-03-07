# ConstraintViolationStorage

**Type:** Detail

The implementation of constraint violation storage in the ViolationPersistenceModule implies a design pattern focused on data consistency and integrity within the ConstraintSystem component.

## What It Is  

`ConstraintViolationStorage` lives inside the **ViolationPersistenceModule** and is the concrete implementation that persists constraint‑violation records into the graph database. The only concrete entry point that we can see from the observations is the `createConstraintViolation` function defined in **`graphdb-adapter.ts`**. Whenever the system detects a rule breach, the higher‑level `ViolationPersistenceModule` invokes this adapter method, and the call is routed through `ConstraintViolationStorage` to materialise the violation as a node (or relationship) in the underlying graph store. In short, `ConstraintViolationStorage` is the persistence façade that bridges the **ConstraintSystem** domain objects with the graph‑DB‑backed storage layer.

## Architecture and Design  

The architecture that emerges from the observations is a **graph‑database‑centric persistence layer** wrapped in a dedicated module. The `ViolationPersistenceModule` acts as a bounded context that encapsulates all persistence concerns for constraint violations; within that context, `ConstraintViolationStorage` is the primary component responsible for the actual write operations. The call flow can be summarised as:

1. **ConstraintSystem** (or any validation component) detects a violation.  
2. It hands the violation object to the **ViolationPersistenceModule**.  
3. The module delegates to `ConstraintViolationStorage`, which internally calls `createConstraintViolation` in **`graphdb-adapter.ts`**.  

This separation mirrors the **Repository / Data‑Access Object (DAO)** pattern: `ConstraintViolationStorage` provides a domain‑friendly API while the adapter (`graphdb‑adapter.ts`) hides the low‑level graph‑DB driver calls. The design also reflects an **integrity‑first** stance—by funnelling every write through a single method (`createConstraintViolation`), the system can enforce consistency rules (e.g., unique identifiers, required properties) in one place. No evidence of alternative storage strategies (relational, document) is present, indicating a deliberate decision to treat the graph model as the canonical source of truth for violations.

## Implementation Details  

The only concrete implementation artefact mentioned is the **`createConstraintViolation`** method in **`graphdb-adapter.ts`**. Although the file’s full path is not disclosed, the naming convention suggests it resides in the adapter layer that translates domain calls into graph‑DB queries (likely Cypher or Gremlin). `ConstraintViolationStorage` does not expose its own low‑level query logic; instead, it acts as a thin wrapper that forwards the violation payload to the adapter. This indirection enables:

* **Encapsulation of graph‑specific syntax** – the rest of the codebase never sees raw query strings.  
* **Centralised error handling** – any failure to persist a violation can be caught and transformed into domain‑level exceptions within the adapter.  
* **Future extensibility** – swapping the underlying graph engine (e.g., from Neo4j to JanusGraph) would only require changes inside `graphdb-adapter.ts`, leaving `ConstraintViolationStorage` untouched.

Because the observations do not list additional methods, we infer that `ConstraintViolationStorage` is purpose‑built for *create* operations. Retrieval, update, or deletion of violations is either handled elsewhere or not needed for the current use‑case, reinforcing a **write‑once, immutable‑record** philosophy that bolsters data integrity.

## Integration Points  

`ConstraintViolationStorage` is tightly coupled with two surrounding entities:

* **Parent – ViolationPersistenceModule** – This module orchestrates persistence activities and decides when a violation should be stored. It likely exposes a higher‑level API (e.g., `storeViolation`) that internally calls `ConstraintViolationStorage`. The module’s responsibility is to coordinate with other persistence concerns (perhaps audit logging or batch processing) while keeping the storage logic isolated.

* **Sibling – Other storage components** – While not explicitly mentioned, the module’s placement suggests that other sibling components could exist for different persistence concerns (e.g., `ConstraintDefinitionStorage`). All such siblings would share the same adapter (`graphdb-adapter.ts`) to maintain a uniform interaction model with the graph database.

* **Child – GraphDB Adapter (`graphdb-adapter.ts`)** – The adapter is the concrete implementation that knows how to translate a `ConstraintViolation` domain object into the graph schema (node labels, properties, relationships). It is the only external dependency visible from the observations, meaning that `ConstraintViolationStorage` does not directly depend on any graph‑driver libraries; it delegates that responsibility.

The integration flow is therefore linear and deterministic: violation detection → `ViolationPersistenceModule` → `ConstraintViolationStorage` → `graphdb-adapter.ts` → graph database.

## Usage Guidelines  

1. **Always route violation writes through the parent module.** Direct calls to `graphdb-adapter.ts` bypass the consistency checks baked into `ConstraintViolationStorage` and should be avoided. Use the `ViolationPersistenceModule` API that internally delegates to the storage component.  

2. **Treat stored violations as immutable records.** The current design only exposes a creation path; mutating an existing violation could break the integrity guarantees that the module enforces. If updates become necessary, they should be introduced as new violation entries rather than in‑place edits.  

3. **Handle persistence errors at the module level.** Since `createConstraintViolation` encapsulates low‑level graph errors, callers should catch exceptions thrown by the `ViolationPersistenceModule` and decide whether to retry, log, or abort the surrounding transaction.  

4. **Do not assume alternative storage back‑ends.** The architecture is deliberately built around a graph database; any attempt to replace it with a relational store would require substantial redesign of the adapter and possibly the storage façade.  

5. **Keep the violation payload minimal and schema‑aligned.** Because the adapter maps the payload to graph nodes, adding ad‑hoc fields can lead to schema drift. Follow the domain model defined for constraint violations and let the adapter handle any necessary transformations.

---

### Architectural patterns identified  
* Repository / DAO pattern (via `ConstraintViolationStorage` → `graphdb-adapter.ts`).  
* Bounded Context (the `ViolationPersistenceModule` encapsulates all persistence concerns for violations).  

### Design decisions and trade‑offs  
* **Graph‑DB choice** – offers natural representation of relationships between constraints, but ties the system to graph‑specific query languages.  
* **Single‑method write façade** – simplifies consistency enforcement but limits flexibility for read/update operations.  

### System structure insights  
* `ConstraintViolationStorage` is a child of `ViolationPersistenceModule` and a parent to the low‑level adapter.  
* The module likely sits alongside other persistence components that share the same adapter, promoting reuse.  

### Scalability considerations  
* Graph databases scale well for traversals and relationship‑heavy queries, which can be advantageous if future features need to explore violation dependencies.  
* The current “create‑only” API minimizes write contention; however, bulk ingestion may require batching logic in the parent module to avoid overwhelming the graph engine.  

### Maintainability assessment  
* Clear separation of concerns (domain → module → adapter) makes the codebase easy to understand and evolve.  
* Centralising all graph interactions in `graphdb-adapter.ts` reduces duplication and isolates driver‑specific changes, enhancing long‑term maintainability.  
* The lack of read/update APIs could become a maintenance burden if new requirements emerge, necessitating careful extension of the storage façade.


## Hierarchy Context

### Parent
- [ViolationPersistenceModule](./ViolationPersistenceModule.md) -- ViolationPersistenceModule uses the createConstraintViolation method in graphdb-adapter.ts to store constraint violations in the graph database.


---

*Generated from 3 observations*
