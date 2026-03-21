# OntologyMapper

**Type:** Detail

The OntologyClassificationAgent sub-component utilizes the GraphDatabaseAdapter to persist classified observations in a graph database, as mentioned in the parent context.

## What It Is  

**OntologyMapper** is the core translation component that bridges raw observation data with the graph‑based persistence layer used by the system. It lives inside the **OntologyClassificationAgent** sub‑component (the parent) and is tightly coupled to the **GraphDatabaseAdapter** implementation found in `storage/graph-database-adapter.ts`. Its primary responsibility is to take the classification results produced by the agent and map them into the node‑edge structures expected by the graph database, enabling seamless storage and later retrieval for query and analysis. Because the only concrete artifact we have is the reference to `storage/graph-database-adapter.ts`, we know that OntologyMapper’s contract is defined in terms of the adapter’s public API (e.g., methods for creating nodes, relationships, and executing queries).

---

## Architecture and Design  

The limited observations reveal a **layered architecture** built around clear separation of concerns:

1. **Domain Layer – OntologyClassificationAgent**  
   - Performs the heavy‑lifting of classifying incoming observations.  
   - Delegates persistence to the **GraphDatabaseAdapter**.

2. **Mapping Layer – OntologyMapper**  
   - Sits between the classification logic and the persistence adapter.  
   - Transforms domain objects (e.g., `ClassifiedObservation`) into the graph‑specific schema.

3. **Infrastructure Layer – GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`)  
   - Encapsulates all direct interactions with the underlying graph database (e.g., Neo4j, JanusGraph).  
   - Exposes a stable API that the mapper can call without knowing the concrete driver details.

From these relationships we can infer the use of the **Adapter pattern** (the `GraphDatabaseAdapter` abstracts the external graph store) and a **Mapper/Translator pattern** (the `OntologyMapper` converts between internal domain models and the adapter’s data contracts). The parent‑child relationship (“OntologyClassificationAgent contains OntologyMapper”) indicates composition: the agent owns an instance of the mapper and, through it, indirectly owns the adapter.

No micro‑service boundaries, event‑driven pipelines, or other high‑level patterns are mentioned, so the design remains monolithic and in‑process, which aligns with the observation that the mapper works *in conjunction* with the adapter for “seamless data storage and retrieval”.

---

## Implementation Details  

Even though the source files for `OntologyMapper` are not provided, the observations give us enough to outline its mechanics:

* **Dependency on GraphDatabaseAdapter** – The mapper must import the adapter class from `storage/graph-database-adapter.ts`. It likely holds a reference (`private readonly dbAdapter: GraphDatabaseAdapter`) that is injected at construction time, allowing the mapper to call methods such as `createNode`, `createRelationship`, or generic `runQuery`.

* **Mapping Logic** – For each classified observation, the mapper extracts ontology identifiers (e.g., concept URIs, relationship types) and constructs the corresponding graph entities. This may involve:
  * Building a node payload (`{ label: 'Observation', properties: {...} }`)  
  * Determining edge semantics (e.g., `OBSERVED_IN`, `HAS_TAG`) based on classification results.  
  * Invoking the adapter’s batch write API to reduce round‑trips.

* **Error Handling & Idempotency** – Because the mapper interacts directly with a persistence layer, it probably wraps adapter calls in try/catch blocks and returns status objects to the calling agent. Idempotent writes (e.g., `MERGE` statements) would be a sensible design decision to avoid duplicate nodes when the same observation is processed multiple times.

* **Extensibility Hooks** – The mapper may expose a small set of overridable methods (e.g., `transformNode`, `transformRelationship`) that allow future extensions without changing the core adapter contract. This is a common practice when a mapping component sits between a domain model and a generic persistence adapter.

---

## Integration Points  

1. **OntologyClassificationAgent → OntologyMapper**  
   - The agent calls the mapper after it finishes classifying an observation. The contract is likely a single method such as `mapAndPersist(classifiedObs: ClassifiedObservation): Promise<void>`.

2. **OntologyMapper → GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)**  
   - The mapper uses the adapter’s public API to persist the transformed graph entities. Because the adapter abstracts the underlying driver, the mapper does not need to know whether Neo4j, JanusGraph, or another store is used.

3. **GraphDatabaseAdapter → External Graph Store**  
   - The adapter handles connection pooling, transaction management, and query execution against the actual graph database. This isolates the rest of the system from connection‑level concerns.

4. **Potential Sibling Components** – While not explicitly listed, any other mapper‑like components that also depend on `GraphDatabaseAdapter` would share the same persistence contract, promoting reuse and consistency across the code base.

---

## Usage Guidelines  

* **Inject the Adapter** – Always construct `OntologyMapper` with a fully‑initialized instance of `GraphDatabaseAdapter`. Prefer dependency injection (constructor injection) to keep the mapper testable and to allow swapping adapters in the future.

* **Batch When Possible** – If the classification agent processes many observations in a single run, batch the mapper’s calls to the adapter to reduce network overhead. The adapter likely provides a bulk‑write method; use it instead of issuing one query per observation.

* **Respect Idempotency** – When mapping the same observation more than once, rely on the adapter’s `MERGE` semantics (or equivalent) to avoid duplicate nodes. The mapper should generate deterministic identifiers (e.g., hash of the observation payload) for nodes that must be unique.

* **Handle Failures Gracefully** – Propagate adapter errors up to the `OntologyClassificationAgent` so that the agent can decide whether to retry, log, or abort the classification pipeline. Do not swallow exceptions inside the mapper.

* **Keep Mapping Logic Pure** – The mapper should avoid side effects beyond calling the adapter. Complex business rules belong in the classification agent; the mapper’s job is purely structural translation.

---

### Summary of Key Insights  

1. **Architectural patterns identified** – Adapter pattern (`GraphDatabaseAdapter`) and Mapper/Translator pattern (`OntologyMapper`). The system follows a layered architecture separating classification, mapping, and persistence.  

2. **Design decisions and trade‑offs** –  
   * **Separation of concerns** improves maintainability but introduces an extra indirection layer (mapper).  
   * **Adapter abstraction** enables swapping the underlying graph store without touching the mapper or agent, at the cost of a thin performance overhead for each call.  

3. **System structure insights** – `OntologyClassificationAgent` owns `OntologyMapper`, which in turn depends on `GraphDatabaseAdapter` located at `storage/graph-database-adapter.ts`. This composition chain ensures that classification results are immediately ready for graph persistence.  

4. **Scalability considerations** –  
   * Graph databases are naturally suited for highly connected data; the adapter must support connection pooling and batch writes to scale with volume.  
   * The mapper could become a bottleneck if it performs per‑observation writes; batching and asynchronous processing are recommended for high‑throughput scenarios.  

5. **Maintainability assessment** – The clear division between domain logic (agent), transformation (mapper), and infrastructure (adapter) yields high maintainability. Adding new ontology concepts only requires updates in the mapper, while changing the graph engine only touches `GraphDatabaseAdapter`. The primary risk is the lack of concrete unit tests for the mapper; injecting a mock adapter can mitigate this.

## Hierarchy Context

### Parent
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- OntologyClassificationAgent utilizes the GraphDatabaseAdapter to persist classified observations in a graph database, enabling efficient querying and analysis of the data in storage/graph-database-adapter.ts

---

*Generated from 3 observations*
