# OntologyMapping

**Type:** Detail

The GraphDatabaseAdapter, mentioned in the parent context, may be used in conjunction with the OntologyMapping node to store and retrieve ontology mappings.

## What It Is  

`OntologyMapping` is a logical node that encapsulates the relationships between source data elements and the target ontology used by the **OntologyClassificationAgent**. Although the repository does not expose a concrete file for this node, the parent‑component description makes it clear that the mapping layer exists as a distinct entity that the agent relies on when classifying incoming information. Its primary responsibility is to hold, retrieve, and update the mapping definitions that drive the classification logic. Because the **OntologyClassificationAgent** persists its state through the **GraphDatabaseAdapter** (found at `storage/graph-database-adapter.ts`), the `OntologyMapping` node is expected to be stored in the same graph database, benefiting from the same automatic JSON export‑sync mechanism described for the agent.

## Architecture and Design  

The architecture follows a **graph‑oriented persistence** style. The `OntologyClassificationAgent` acts as a higher‑level service that orchestrates classification work, while `OntologyMapping` is a subordinate node that supplies the semantic translation rules. The presence of `GraphDatabaseAdapter` indicates an **Adapter pattern**: the agent (and by extension the mapping node) interact with a generic interface that hides the concrete graph‑database implementation details. This decouples the classification logic from storage concerns, allowing the mapping data to be swapped out or migrated without touching the agent’s core code.  

Interaction is hierarchical: the parent **OntologyClassificationAgent** contains an instance or reference to `OntologyMapping`. When the agent needs to resolve a term, it queries the mapping node, which in turn uses the `GraphDatabaseAdapter` to read or write the corresponding graph edges and vertices. The automatic JSON export sync mentioned for the adapter suggests a **synchronisation mechanism** that keeps the persisted graph representation aligned with an external JSON snapshot, providing a simple backup and version‑control strategy.

## Implementation Details  

* **Node definition** – Although no source file is listed, the node is likely defined as a class or interface named `OntologyMapping` that models a collection of mapping entries (e.g., source‑term → ontology‑concept).  
* **Persistence** – All read/write operations on the mapping data are delegated to `storage/graph-database-adapter.ts`. The adapter exposes methods such as `saveNode`, `loadNode`, and `exportToJson` (names inferred from typical adapter responsibilities). `OntologyMapping` therefore does not implement its own storage logic; it merely prepares data structures that the adapter can serialize into the underlying graph.  
* **Lifecycle** – The parent **OntologyClassificationAgent** creates or retrieves an `OntologyMapping` instance during its initialization phase. Because the agent uses automatic JSON export sync, any change to the mapping (addition, removal, or modification of a rule) triggers the adapter’s sync routine, ensuring the graph and the JSON representation stay consistent.  
* **Error handling** – The adapter likely surfaces graph‑database errors (e.g., connection loss, constraint violations) back to the mapping node, which then propagates them up to the agent. This keeps the mapping logic simple and focused on semantic concerns rather than low‑level I/O handling.

## Integration Points  

1. **Parent – OntologyClassificationAgent**: The agent owns the mapping node and calls its methods whenever a classification decision requires ontology lookup. The relationship is explicit: “OntologyClassificationAgent contains OntologyMapping.”  
2. **Storage – GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)**: All persistence actions for `OntologyMapping` flow through this adapter. The mapping node does not interact directly with the database driver; instead, it passes structured data to the adapter’s API.  
3. **Export/Sync Layer**: The automatic JSON export sync tied to the adapter means that any external system that consumes the JSON snapshot (e.g., documentation generators, CI pipelines) indirectly receives up‑to‑date ontology mappings without additional code.  
4. **Potential Siblings** – If other agents (e.g., a `RelationExtractionAgent`) also need ontology information, they would likely share the same `OntologyMapping` node, promoting reuse and consistency across the system.

## Usage Guidelines  

* **Instantiate via the agent** – Developers should never construct an `OntologyMapping` object directly. Instead, obtain it from the `OntologyClassificationAgent` to guarantee that the mapping is correctly wired to the `GraphDatabaseAdapter`.  
* **Treat mappings as immutable during a classification run** – Because the adapter synchronises changes to JSON immediately, mutating mappings while the agent is processing a batch can lead to race conditions. Apply bulk updates between classification cycles.  
* **Leverage the adapter’s bulk operations** – When adding or removing many mapping entries, use the adapter’s batch‑write capabilities (if exposed) to minimise round‑trips to the graph database and to keep the JSON export efficient.  
* **Validate before persisting** – Ensure that each mapping entry conforms to the expected ontology schema. Validation logic should live in the mapping node, not in the adapter, to keep storage concerns separate.  
* **Monitor sync health** – Since the JSON export is automatic, monitor the adapter’s sync logs for failures; a broken sync could leave the persisted graph and the external JSON out of step, causing classification mismatches.

---

### 1. Architectural patterns identified  
* **Adapter pattern** – `GraphDatabaseAdapter` abstracts the underlying graph database.  
* **Hierarchical composition** – `OntologyClassificationAgent` composes `OntologyMapping`.  
* **Automatic synchronisation** – JSON export sync ties persistence to an external representation.

### 2. Design decisions and trade‑offs  
* **Separation of concerns** – Mapping logic is isolated from storage, simplifying both domains but adding an indirection layer.  
* **Immediate JSON sync** – Guarantees up‑to‑date external snapshots at the cost of potential performance overhead on frequent updates.  
* **Single source of truth** – Storing mappings in the graph database avoids duplication, but requires the graph to be highly available.

### 3. System structure insights  
* The system is organised around a **graph‑centric core** where agents and domain nodes (like `OntologyMapping`) are first‑class citizens.  
* Persistence is centrally managed by `storage/graph-database-adapter.ts`, which all domain nodes share, promoting uniform data handling.

### 4. Scalability considerations  
* Because mappings live in a graph database, scaling horizontally depends on the database’s clustering capabilities.  
* Bulk‑write support in the adapter will be essential as the number of ontology terms grows; otherwise, per‑entry writes could become a bottleneck.  
* The automatic JSON export may need sharding or incremental diff generation for very large ontologies to keep sync times reasonable.

### 5. Maintainability assessment  
* **High maintainability** – Clear separation between classification, mapping, and storage reduces the surface area for bugs.  
* **Potential fragility** – Reliance on the automatic sync means that any change to the adapter’s contract must be reflected across all nodes that depend on it; thorough integration testing is required.  
* **Extensibility** – New agents can reuse `OntologyMapping` without duplication, and alternative storage adapters could be introduced with minimal impact on the classification logic.


## Hierarchy Context

### Parent
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- OntologyClassificationAgent uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle persistence with automatic JSON export sync.


---

*Generated from 3 observations*
