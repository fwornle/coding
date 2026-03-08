# ViolationMetadataRepository

**Type:** Detail

The storage/graph-database-adapter.ts file could contain the implementation details of the ViolationMetadataRepository, including the schema for storing violation metadata and the methods for retrieving and updating this data.

## What It Is  

**ViolationMetadataRepository** is the concrete repository responsible for persisting and retrieving metadata about constraint‑violation events. The observations place its implementation in the same module that houses the **GraphDatabaseAdapter** – `storage/graph-database-adapter.ts`.  This file is expected to contain the schema definitions for violation metadata (e.g., node labels, relationship types, and property structures) as well as the CRUD‑style methods that the repository will expose.  

The repository is a child of **ViolationDetector** – the detector composes a `ViolationMetadataRepository` instance so that, once a rule‑based check flags a violation, the detector can delegate the storage concerns to the repository. In this way, the repository acts as the persistence layer for the detector’s higher‑level business logic.

---

## Architecture and Design  

The design follows a classic **Repository pattern** layered on top of a **GraphDatabaseAdapter**. The adapter abstracts the underlying graph database (Neo4j, JanusGraph, etc.) behind a thin, type‑safe API. `storage/graph-database-adapter.ts` therefore serves two roles:

1. **Adapter Layer** – exposes low‑level graph operations (create node, match relationship, update properties).  
2. **Repository Layer** – builds domain‑specific methods (e.g., `saveViolationMetadata`, `findViolationsByRule`, `updateViolationStatus`) that translate business concepts into graph queries.

The repository is likely rule‑oriented: the detector supplies a “violation rule” identifier, and the repository persists a node that captures the rule name, the offending entity, timestamps, and any contextual payload. Because the repository lives in the same file as the adapter, the coupling is tight but intentional: the repository can directly reuse the adapter’s connection handling, transaction management, and query‑building helpers without an extra indirection layer.

Interaction flow (as inferred from the hierarchy):

1. **ViolationDetector** executes its detection logic.  
2. Upon a detection, it calls into **ViolationMetadataRepository**.  
3. The repository uses **GraphDatabaseAdapter** (same file) to translate the request into a graph mutation or query.  
4. Results flow back to the detector, which may act on the persisted metadata (e.g., raise alerts, trigger remediation).

No other architectural styles (micro‑service, event‑driven, etc.) are mentioned, so the design is confined to a monolithic module with clear separation of concerns between detection (business rule) and persistence (graph storage).

---

## Implementation Details  

Although the source code is not present, the observations give a clear picture of the expected implementation surface:

| Component | Expected Role | Key Artifacts (from observations) |
|-----------|---------------|-----------------------------------|
| `storage/graph-database-adapter.ts` | Provides low‑level graph operations and houses the repository implementation. | GraphDatabaseAdapter class / object, schema definitions for violation metadata, CRUD methods. |
| **ViolationMetadataRepository** | Domain‑specific wrapper that the detector uses. | Methods such as `saveViolationMetadata(metadata)`, `getViolationById(id)`, `listViolations(filter)`, `updateViolationStatus(id, status)`. |
| **ViolationDetector** | Consumer of the repository; orchestrates detection and persistence. | Holds a reference to `ViolationMetadataRepository`; calls its methods when a rule is violated. |

The **schema** likely includes a node label such as `ViolationMetadata` with properties:

* `ruleId` – identifier of the violated rule.  
* `entityId` – the primary key of the entity that broke the rule.  
* `timestamp` – when the violation was recorded.  
* `payload` – optional JSON blob with extra context.  
* `status` – e.g., `open`, `acknowledged`, `resolved`.

The repository methods would construct Cypher (or the graph DB’s query language) strings using the adapter’s query builder, execute them within a transaction, and map the raw graph result back to TypeScript interfaces that the detector can consume.

Because the repository lives alongside the adapter, shared utilities (connection pooling, error handling, logging) are reused without duplication, keeping the implementation concise.

---

## Integration Points  

1. **ViolationDetector (Parent)** – instantiates or receives a `ViolationMetadataRepository`. The detector’s workflow depends on the repository for persisting detection outcomes.  
2. **GraphDatabaseAdapter (Sibling/Implementation Detail)** – the repository directly calls the adapter’s methods (`runQuery`, `createNode`, `updateNode`). This tight integration means any change to the adapter’s API (e.g., switching to a different graph engine) will ripple into the repository.  
3. **Potential Consumers (Future Siblings)** – other components that need to read violation data (reporting dashboards, audit services) could also import the same repository from `storage/graph-database-adapter.ts`. Because the repository is the sole façade over the graph store, all read‑side consumers share a consistent view.  

The only explicit dependency is the graph database client that the adapter wraps. No external services or message brokers are indicated in the observations.

---

## Usage Guidelines  

* **Instantiate via Dependency Injection** – the preferred pattern is for `ViolationDetector` to receive a pre‑configured `ViolationMetadataRepository` (or the underlying `GraphDatabaseAdapter`) from the application bootstrap. This keeps the detector testable and decouples it from concrete connection details.  
* **Follow the Rule‑Based Contract** – when calling repository methods, supply the rule identifier and a well‑structured metadata object that matches the repository’s schema (e.g., `ruleId`, `entityId`, `timestamp`). Avoid ad‑hoc property names; consistency ensures queries remain stable.  
* **Handle Transaction Boundaries** – the adapter likely manages transactions; callers should treat repository calls as atomic operations. If a detector workflow requires multiple repository actions, wrap them in a higher‑level transaction provided by the adapter.  
* **Read‑Only vs. Write‑Only** – use the repository’s read methods (`find`, `list`) for reporting and the write methods (`save`, `update`) only within detection pipelines to prevent accidental mutation of historic violation records.  
* **Testing** – mock the `GraphDatabaseAdapter` interface rather than the concrete repository implementation. Because the repository is thin, most unit tests should focus on the detector’s logic; integration tests can verify that the repository correctly translates to graph queries.

---

### Architectural Patterns Identified  

* **Repository Pattern** – encapsulates persistence logic behind a domain‑specific API.  
* **Adapter Pattern** – `GraphDatabaseAdapter` abstracts the underlying graph DB, allowing the repository to remain DB‑agnostic.  
* **Rule‑Based Design** – the repository is expected to store metadata keyed by violation rules, reflecting a rule‑engine style detection flow.

### Design Decisions & Trade‑offs  

* **Co‑location of Adapter & Repository** – placing both in `storage/graph-database-adapter.ts` reduces module sprawl and eases sharing of connection logic, but it introduces tighter coupling; swapping the adapter for a different storage technology would require changes in the same file.  
* **Graph‑Centric Schema** – using a graph DB enables natural modeling of relationships between violations, entities, and rules (e.g., “violates”, “resolvedBy”). The trade‑off is that developers must be comfortable with graph query languages and the performance characteristics of traversals.  
* **Rule‑Centric Metadata** – designing the schema around rule identifiers simplifies querying for “all violations of rule X”, but may limit flexibility if future metadata needs evolve beyond rule‑centric attributes.

### System Structure Insights  

* The system is organized around a **detection‑persistence** vertical: `ViolationDetector` (business logic) → `ViolationMetadataRepository` (persistence façade) → `GraphDatabaseAdapter` (storage driver).  
* All persistence concerns are funneled through a single file (`storage/graph-database-adapter.ts`), indicating a deliberate “single source of truth” for data‑access code.  
* No evidence of separate service boundaries or asynchronous pipelines; the flow appears synchronous and in‑process.

### Scalability Considerations  

* **Graph DB Scaling** – the repository’s scalability hinges on the underlying graph database’s ability to handle large numbers of violation nodes and relationship traversals. Proper indexing on `ruleId` and `entityId` will be crucial.  
* **Batch Operations** – if detectors generate many violations in a short window, the repository should expose bulk‑insert methods to reduce round‑trips. The current observations do not mention such methods, so they may be an area for future enhancement.  
* **Horizontal Scaling** – because the repository is tightly coupled to the adapter, scaling out the application will require the graph database itself to be clustered or sharded; the code does not introduce any distributed coordination layer.

### Maintainability Assessment  

* **Positive Aspects** – the clear separation between detection logic and persistence (via the repository) makes the core business rules easier to test and evolve. The adapter abstraction shields most of the graph‑specific syntax from higher layers.  
* **Risk Areas** – co‑locating the adapter and repository could lead to a “god file” where unrelated concerns accumulate, making future refactoring harder. Adding new persistence features (e.g., audit logging) may force modifications to the same file, increasing merge‑conflict risk.  
* **Documentation Needs** – since the repository’s schema and query signatures are not explicitly enumerated in the observations, thorough inline documentation (type definitions, query templates) will be essential to avoid misuse.  

Overall, **ViolationMetadataRepository** appears to be a focused, rule‑centric persistence component that leverages a graph‑database adapter to store violation metadata. Its design aligns with established repository and adapter patterns, offering a clean contract for the parent `ViolationDetector` while keeping the underlying storage implementation encapsulated.


## Hierarchy Context

### Parent
- [ViolationDetector](./ViolationDetector.md) -- ViolationDetector uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve violation metadata.


---

*Generated from 3 observations*
