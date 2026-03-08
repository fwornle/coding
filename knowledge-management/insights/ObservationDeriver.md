# ObservationDeriver

**Type:** SubComponent

ObservationDeriver's derivation process involves calling the getEntityRelationships method in entity-relationships.ts to retrieve the relationships between entities

## What It Is  

**ObservationDeriver** is the sub‑component that materialises “observations” from the knowledge graph. Its core logic lives in `observation-deriver.ts`, where the public method `deriveObservations` orchestrates the whole derivation flow. The component pulls the current graph topology via the helper `getEntityRelationships` (implemented in `entity-relationships.ts`) and applies the rule set defined in `observation-derivation-rules.ts`. Once the observations have been calculated they are persisted back into the graph through the **GraphDatabaseAdapter** (`storage/graph-database-adapter.ts`). The adapter also takes care of the “automatic JSON export sync” – every change to the graph, including the newly‑derived observations, is written out to a JSON file for downstream consumption.  

Derivation is not a stand‑alone batch job; it is invoked automatically as part of two upstream processes. When a new entity is created by **ManualLearning**, the creation pipeline calls into ObservationDeriver so that fresh observations are immediately available. Likewise, the **OnlineLearning** knowledge‑extraction pipeline triggers the same derivation step after it has harvested new knowledge from sources such as Git history or LSL sessions. In the component hierarchy, ObservationDeriver sits under **KnowledgeManagement**, which owns the graph database and the JSON export mechanism, and it shares the same storage layer with sibling components such as **EntityClassifier**, **InsightGenerator**, and **CodeGraphConstructor**.

---

## Architecture and Design  

The architecture exposed by the observations follows a **rule‑driven processing pipeline** that is tightly coupled to the graph‑storage layer. The pipeline can be visualised as:

1. **Trigger source** – either `ManualLearning` (entity creation) or `OnlineLearning` (knowledge extraction).  
2. **Data retrieval** – `getEntityRelationships` pulls the current set of entity‑relationship tuples from the graph.  
3. **Derivation engine** – `deriveObservations` iterates over the retrieved relationships and consults `observationDerivationRules` to decide which observations to generate.  
4. **Persistence** – `GraphDatabaseAdapter` writes the observations back into the graph and, via its built‑in JSON export sync, mirrors the updated graph to a JSON file.

The **GraphDatabaseAdapter** acts as an **Adapter** (in the classic GoF sense) that hides the concrete graph implementation (Graphology + LevelDB) behind a simple API used by ObservationDeriver and its siblings. This isolates the derivation logic from storage‑specific concerns and enables the automatic JSON export without additional code in the derivation component.

The rule set (`observation-derivation-rules.ts`) implements a **Strategy‑like** approach: the derivation engine does not embed hard‑coded logic but delegates the decision‑making to a collection of rule objects/functions. This makes the observation generation behaviour extensible – new rules can be added without touching `deriveObservations`.

Finally, the component is **event‑triggered** rather than scheduled. The observations are derived **synchronously** as part of the upstream workflows, ensuring that the graph always reflects the most recent state after each creation or extraction step.

---

## Implementation Details  

- **`observation-deriver.ts` – `deriveObservations`**  
  This method is the entry point for the sub‑component. It receives either a newly created entity identifier (from ManualLearning) or a batch of extracted knowledge (from OnlineLearning). Internally it calls `getEntityRelationships` to obtain a map of each entity to its outgoing and incoming edges. It then iterates over this map, feeding each relationship into the rule engine defined in `observation-derivation-rules.ts`. For every rule that matches, a concrete observation object is instantiated (the shape of the object is defined by the rule’s output contract) and collected in a temporary list.

- **`entity-relationships.ts` – `getEntityRelationships`**  
  This helper abstracts the graph query required to fetch relationships. It likely uses the GraphDatabaseAdapter’s read API to perform a neighbourhood lookup, returning a data structure that the derivation engine can traverse efficiently (e.g., `Map<EntityId, Relationship[]>`). By keeping this logic in a dedicated file, the derivation component stays focused on *what* to do with the relationships rather than *how* to fetch them.

- **`observation-derivation-rules.ts`**  
  The file houses a collection of rule definitions. Each rule encapsulates a predicate (e.g., “if entity A depends on entity B and B is of type X”) and an associated observation creator. The rules are pure functions – they accept a relationship (or a pair of entities) and return either an observation payload or `null`. Because the rules are isolated, developers can add, remove, or reorder them without altering the core derivation loop.

- **`storage/graph-database-adapter.ts` – Persistence & Export**  
  The adapter exposes methods such as `saveObservations(observations: Observation[])`. After persisting the new nodes/edges, the same module runs the “automatic JSON export sync” routine. This routine serialises the entire graph (or the delta) to a JSON file on disk, guaranteeing that any external consumer that watches the JSON file sees an up‑to‑date view of the knowledge graph. The export is triggered automatically; no explicit call is required from ObservationDeriver.

- **Trigger Integration**  
  Both **ManualLearning** and **OnlineLearning** contain hooks that invoke `deriveObservations`. In ManualLearning the hook is placed after a successful call to `GraphDatabaseAdapter.saveEntity`, while in OnlineLearning the hook follows the batch analysis defined in `batch-analysis.yaml`. This ensures that observation derivation is part of the canonical data‑ingestion pipeline.

---

## Integration Points  

ObservationDeriver sits at the intersection of three major system concerns:

1. **Graph Storage** – All read/write operations go through `GraphDatabaseAdapter`. Any change in the underlying graph engine (e.g., swapping LevelDB for another KV store) would only require updates inside the adapter, leaving ObservationDeriver untouched.

2. **Rule Engine** – `observation-derivation-rules.ts` is a shared artefact that could be reused by other components (e.g., a future “RecommendationEngine”). The rules are exposed as a plain collection, making them easy to import.

3. **Upstream Triggers** – The component receives its execution signal from **ManualLearning** (entity creation) and **OnlineLearning** (knowledge extraction). Consequently, any modification to the creation or extraction pipelines must preserve the contract of calling `deriveObservations` with the appropriate context.

Downstream, the generated observations are consumed by **InsightGenerator** (`insight-generator.ts`), which reads the graph (including the newly added observation nodes) to produce higher‑level insights. Because the observations are persisted in the same graph database, InsightGenerator can query them using the same adapter without additional integration work.

---

## Usage Guidelines  

- **Do not call `deriveObservations` directly from UI code or unrelated services.** The component is designed to be invoked only by the sanctioned triggers in ManualLearning and OnlineLearning, ensuring that the graph’s state remains consistent.

- **When extending the rule set, keep each rule pure and side‑effect free.** Rules should only inspect the supplied relationship and return an observation object; they must not perform additional graph writes. This preserves the deterministic nature of the derivation loop.

- **If you need to add a new relationship type, first update `getEntityRelationships`** so that the new edges are included in the returned structure. Afterwards, add a corresponding rule (or modify an existing one) to handle the new semantics.

- **Do not modify the JSON export behaviour inside ObservationDeriver.** The export is handled centrally by `GraphDatabaseAdapter`. If you require a custom export format, extend the adapter rather than inserting export logic into the derivation component.

- **Testing:** Unit‑test each rule in isolation, and write integration tests that simulate a full trigger flow (e.g., create an entity via ManualLearning and assert that the expected observation appears in the graph and in the exported JSON).

---

### Architectural Patterns Identified  

1. **Adapter Pattern** – `GraphDatabaseAdapter` abstracts the concrete graph database implementation.  
2. **Strategy/Rule‑Based Processing** – `observationDerivationRules` encapsulate interchangeable decision logic.  
3. **Event‑Triggered (Synchronous) Pipeline** – Derivation is invoked automatically by upstream processes rather than by a scheduler.  

### Design Decisions and Trade‑offs  

- **Centralised Persistence vs. Loose Coupling** – Using a single adapter for all graph interactions simplifies code reuse but creates a single point of failure; any bug in the adapter impacts all siblings.  
- **Rule‑Based Extensibility** – Placing the business logic in external rule files makes it easy to evolve the observation model, at the cost of potentially scattering related logic across many small functions.  
- **Synchronous Triggering** – Immediate derivation guarantees up‑to‑date observations but can increase latency for entity creation or knowledge extraction. An asynchronous queue could improve throughput but would sacrifice instant consistency.  

### System Structure Insights  

ObservationDeriver is a leaf node under **KnowledgeManagement**, sharing the storage layer with siblings such as **EntityClassifier** and **InsightGenerator**. All siblings read/write the same graph, which promotes a unified data model but requires careful coordination of write conflicts. The component’s only outward‑facing artifact is the persisted observations, which become inputs for InsightGenerator.  

### Scalability Considerations  

- **Graph Size:** As the number of entities and relationships grows, `getEntityRelationships` may become a bottleneck if it loads large neighbourhoods into memory. Pagination or selective fetching could mitigate this.  
- **Rule Evaluation:** The derivation loop iterates over every relationship; the computational cost scales linearly with edge count. Optimising rule predicates (e.g., early exits) and possibly parallelising rule checks could improve throughput.  
- **JSON Export:** Automatic export of the entire graph after each derivation may become I/O‑heavy. Introducing incremental delta exports would reduce disk pressure for large graphs.  

### Maintainability Assessment  

The component is well‑partitioned: retrieval, rule evaluation, and persistence are isolated in distinct files, which eases independent testing and future refactoring. The reliance on a single adapter for storage promotes code reuse across siblings, but it also means that changes to storage semantics ripple through many components; versioning the adapter interface could help manage this risk. Rule files are straightforward to extend, yet without a central registry or naming convention they could become disorganised as the rule set expands. Overall, the design favours clarity and extensibility, provided that developers adhere to the usage guidelines and keep the rule base disciplined.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for storing and retrieving data from a graph database, which is implemented using Graphology and LevelDB. This allows for efficient querying and retrieval of entities and relationships within the knowledge graph. The automatic JSON export sync feature ensures that data is consistently updated across the system. For example, when a new entity is added to the graph, the GraphDatabaseAdapter will automatically export the updated graph data to a JSON file, which can then be used by other components or services.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store manually created entities
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline in batch-analysis.yaml to extract knowledge from git history, LSL sessions, and code analysis
- [EntityClassifier](./EntityClassifier.md) -- EntityClassifier uses the classifyEntity method in entity-classifier.ts to classify entities in the graph
- [InsightGenerator](./InsightGenerator.md) -- InsightGenerator uses the generateInsights method in insight-generator.ts to generate insights from observations and entities in the graph
- [CodeGraphConstructor](./CodeGraphConstructor.md) -- CodeGraphConstructor uses the constructCodeGraph method in code-graph-constructor.ts to construct the code graph
- [TraceReportGenerator](./TraceReportGenerator.md) -- TraceReportGenerator uses the generateTraceReport method in trace-report-generator.ts to generate trace reports
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the Graphology library to interact with the graph database


---

*Generated from 7 observations*
