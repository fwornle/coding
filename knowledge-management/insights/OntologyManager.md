# OntologyManager

**Type:** GraphDatabase

OntologyManager is responsible for handling ontology classification, including loading ontology definitions and performing entity classification, as described in the KnowledgeManagement component's description.

## What It Is  

**OntologyManager** is the core logic component that lives inside the *KnowledgeManagement* domain.  The most plausible implementation file, based on the observations, is **`ontology-manager.ts`** (the naming follows the convention used by sibling components such as `entity-persistence.ts` and `graph-database-manager.ts`).  Its responsibility is to load ontology definitions, keep them in sync with the underlying graph store, and perform entity‑classification operations against those ontologies.  To achieve this, OntologyManager does **not** talk to the storage layer directly; instead it re‑uses the **`GraphDatabaseAdapter`** located at **`storage/graph-database-adapter.ts`**.  The adapter supplies the low‑level Graphology + LevelDB interaction and the automatic JSON‑export synchronization that the whole KnowledgeManagement suite relies on.

The component therefore sits at the intersection of *knowledge representation* (the ontology definitions) and *graph persistence* (the graph database).  It is a child of the **KnowledgeManagement** component and works alongside siblings such as **EntityPersistence**, **GraphDatabaseManager**, **ManualLearning**, and **OnlineLearning**, all of which also depend on the same `GraphDatabaseAdapter` for storage concerns.

---

## Architecture and Design  

The design that emerges from the observations is a **layered, adapter‑centric architecture**.  The lowest layer is the **graph‑storage stack** – Graphology (the in‑memory graph library) backed by LevelDB for durability.  The **`GraphDatabaseAdapter`** (in `storage/graph-database-adapter.ts`) is the sole gateway to that stack.  It encapsulates the details of opening the LevelDB instance, wiring Graphology, and exposing a **JSON‑export sync** capability.  The adapter also implements an **`initialize`** method that performs *intelligent routing*: when a VKB (Virtual Knowledge Base) API endpoint is reachable it proxies calls through that service; otherwise it falls back to direct local access.  This routing logic is a concrete example of the **Adapter pattern** combined with a **Strategy‑like routing decision**.

Ontologically‑focused logic lives in **OntologyManager**.  Rather than embed database calls, OntologyManager **delegates** all persistence concerns to the adapter (or, optionally, to the higher‑level **EntityPersistence** sub‑component).  This delegation creates a **Facade** for the rest of the KnowledgeManagement domain: callers of OntologyManager need only request “load ontology” or “classify entity” without caring whether the underlying data comes from a remote VKB service or a local LevelDB file.  The component also shares the **initialization contract** of the adapter, meaning it can be started in the same bootstrap sequence as its siblings (ManualLearning, OnlineLearning, etc.).

The sibling components (ManualLearning, OnlineLearning, CodeKnowledgeGraphBuilder, DataImporter, QueryEngine) all **reuse the same adapter**, which guarantees consistent data format, transaction semantics, and JSON export behavior across the entire KnowledgeManagement subsystem.  This uniformity is a deliberate architectural decision to avoid “multiple ways of talking to the graph” and to keep the system’s data‑flow predictable.

---

## Implementation Details  

1. **`storage/graph-database-adapter.ts`** – The adapter class exposes at least two public members that OntologyManager relies on:  
   * **`initialize()`** – Called during system start‑up; it detects the presence of a VKB API and decides whether to route queries through that service or to use the local LevelDB instance directly.  The method also sets up the automatic JSON export synchronization, which periodically writes the in‑memory Graphology graph to a JSON file for backup or external consumption.  
   * **Graphology‑LevelDB bindings** – Internally the adapter creates a Graphology instance, registers LevelDB as the persistence backend, and provides CRUD‑style methods (e.g., `addNode`, `addEdge`, `findNode`) that higher‑level components call.

2. **`ontology-manager.ts`** (presumed location) – This file contains the concrete class **`OntologyManager`**.  Its key responsibilities are:  
   * **Ontology loading** – Reads ontology definition files (likely JSON or Turtle) and inserts the concepts, relationships, and classification rules into the graph via the adapter’s node/edge APIs.  
   * **Entity classification** – When an entity is presented (perhaps from the **EntityPersistence** layer), OntologyManager traverses the graph to locate matching ontology nodes, applying the classification logic defined in the ontology schema.  The traversal is performed using Graphology’s query utilities, which the adapter exposes.  
   * **Synchronization hooks** – Because the adapter already runs a JSON export, OntologyManager may register listeners to trigger a re‑export whenever the ontology graph changes (e.g., after a new ontology version is loaded).

3. **Interaction with **EntityPersistence** and **GraphDatabaseManager** –  
   * **EntityPersistence** provides higher‑level CRUD for domain entities (e.g., source‑code symbols, learning artifacts).  OntologyManager may request persisted entities from this sub‑component, classify them, and then write back classification results.  
   * **GraphDatabaseManager** is a sibling that orchestrates broader database lifecycle concerns (e.g., backup/restore, connection pooling).  OntologyManager can invoke its public methods when it needs to ensure the graph is in a consistent state before performing a bulk classification run.

All of these interactions are mediated through **method calls**; no direct file‑system or network code appears in OntologyManager itself, keeping its responsibilities narrowly focused on knowledge logic.

---

## Integration Points  

* **Parent – KnowledgeManagement** – OntologyManager is instantiated by the KnowledgeManagement bootstrap routine.  During that phase the `GraphDatabaseAdapter.initialize()` method is called first, establishing the routing decision (VKB vs. local).  Once the adapter is ready, OntologyManager is constructed with a reference to the adapter (or to EntityPersistence, which already holds the adapter).  

* **Siblings – EntityPersistence, GraphDatabaseManager** – OntologyManager consumes the **entity‑persistence API** to fetch raw entities that need classification.  It may also invoke **GraphDatabaseManager** methods for tasks such as flushing pending writes before a bulk classification job or triggering a manual JSON export.  

* **External – VKB API** – When the VKB service is reachable, the `initialize` routing logic in the adapter transparently forwards all graph operations (including those originated by OntologyManager) to the remote API.  This means OntologyManager does not need to contain any conditional network code; the adapter abstracts that away.  

* **Data Flow** – The typical flow is:  
  1. **Load ontology** → OntologyManager parses definition → calls adapter to create graph nodes/edges.  
  2. **Classify entity** → OntologyManager requests entity from EntityPersistence → traverses graph via adapter → writes classification result back via EntityPersistence.  
  3. **Export** → Adapter’s automatic JSON sync writes the updated graph to disk; optionally OntologyManager can trigger an immediate export after a major ontology update.

These integration points ensure that OntologyManager remains a thin knowledge‑logic layer while leveraging the robust storage and routing capabilities already provided by the rest of the KnowledgeManagement subsystem.

---

## Usage Guidelines  

1. **Instantiate after adapter initialization** – Always create or activate OntologyManager **after** `GraphDatabaseAdapter.initialize()` has completed.  This guarantees that the routing (VKB vs. local) is settled and that the JSON export thread is running.  

2. **Prefer the adapter’s API over direct graph manipulation** – Even though OntologyManager could technically import Graphology directly, doing so would bypass the routing logic and the automatic export mechanism.  All node/edge creation, deletion, or queries should go through the adapter (or through EntityPersistence, which itself delegates to the adapter).  

3. **Version ontology definitions carefully** – Loading a new ontology overwrites or augments the existing graph structure.  Because the adapter continuously syncs the graph to JSON, any breaking change will be reflected in the exported file.  Follow a “load‑then‑validate‑then‑activate” pattern: load the ontology, run a quick sanity‑check (e.g., ensure required root concepts exist), and only then mark the ontology as active for classification.  

4. **Leverage the automatic JSON export** – The JSON export is not just a backup; downstream tools (e.g., visualization dashboards, external analytics pipelines) may consume it.  Do not disable the export unless you have a compelling reason, and be aware that frequent ontology updates will generate more export activity, which could affect I/O performance on constrained environments.  

5. **Handle VKB unavailability gracefully** – The routing logic inside `initialize` already falls back to local LevelDB when the VKB API is unreachable.  However, developers should still be prepared for transient network failures during runtime; catching adapter‑level errors and possibly retrying or switching to a local fallback is advisable.  

---

### Summary of Architectural Insights  

| Aspect | Insight (grounded in observations) |
|--------|-------------------------------------|
| **Architectural pattern** | Adapter pattern (GraphDatabaseAdapter) + Facade (OntologyManager) + Strategy‑like routing in `initialize`. |
| **Design decisions** | Centralize all graph storage behind a single adapter to guarantee consistent JSON export and routing; keep ontology logic separate from persistence; reuse EntityPersistence for entity CRUD. |
| **Trade‑offs** | Tight coupling to Graphology + LevelDB limits swapping the storage engine; reliance on VKB API introduces a network dependency but is mitigated by fallback. |
| **System structure** | KnowledgeManagement → OntologyManager (child) ↔ GraphDatabaseAdapter (shared) ↔ EntityPersistence / GraphDatabaseManager (siblings). |
| **Scalability** | Graphology + LevelDB scales well for moderate‑size knowledge graphs; automatic JSON export may become a bottleneck for very large graphs; routing allows off‑loading to a remote VKB service when needed. |
| **Maintainability** | Clear separation of concerns (ontology logic vs. storage) and a single adapter reduce duplicated code; however, any change to the adapter’s contract propagates to all siblings, so versioning must be managed carefully. |

These observations paint a picture of a deliberately modular knowledge‑management subsystem where **OntologyManager** serves as the specialist that applies ontological rules, while all storage, routing, and export responsibilities are centralized in the **GraphDatabaseAdapter** and shared sibling components.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's utilization of the GraphDatabaseAdapter in storage/graph-database-adapter.ts enables seamless interaction with the Graphology+LevelDB database, facilitating automatic JSON export synchronization. This design choice allows for efficient data storage and retrieval, as evidenced by the adapter's initialize method, which implements intelligent routing for database access. By leveraging the VKB API when available and direct access otherwise, the component optimizes database interactions, as seen in the GraphDatabaseAdapter's initialize method.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis, as described in the KnowledgeManagement component's description.
- [EntityPersistence](./EntityPersistence.md) -- EntityPersistence uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [GraphDatabaseManager](./GraphDatabaseManager.md) -- GraphDatabaseManager uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [CodeKnowledgeGraphBuilder](./CodeKnowledgeGraphBuilder.md) -- CodeKnowledgeGraphBuilder uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [DataImporter](./DataImporter.md) -- DataImporter uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.
- [QueryEngine](./QueryEngine.md) -- QueryEngine uses the GraphDatabaseAdapter in storage/graph-database-adapter.ts to interact with the Graphology+LevelDB database, enabling automatic JSON export synchronization.


---

*Generated from 7 observations*
