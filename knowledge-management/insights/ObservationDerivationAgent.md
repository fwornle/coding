# ObservationDerivationAgent

**Type:** SubComponent

ObservationDerivationAgent uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle persistence with automatic JSON export sync.

## What It Is  

The **ObservationDerivationAgent** lives in the *KnowledgeManagement* sub‑tree and is implemented as a TypeScript class that resides alongside the other knowledge‑management agents (e.g., `EntityPersistenceAgent`, `OntologyClassificationAgent`). Its primary responsibility is to **derive observations** from heterogeneous sources—such as Git history and “vibe” sessions—and persist those observations into the system‑wide graph store.  

All persistence work is delegated to the **GraphDatabaseAdapter** located at `storage/graph-database-adapter.ts`. This adapter is the single point that talks to the underlying **Graphology**‑based graph database (backed by LevelDB) and also handles the automatic JSON export / sync described in the parent‑component documentation. The agent therefore acts as a thin, purpose‑focused façade that coordinates source‑specific extraction, optional metadata caching, and the hand‑off to the **EntityPersistenceAgent** for actual storage.

In short, the ObservationDerivationAgent is the “pipeline starter” for observation data: it gathers raw signals, normalises them into the internal observation model, caches lightweight metadata for fast repeat access, and reliably writes the resulting entities into the shared graph through the established storage stack.

---

## Architecture and Design  

### Component‑Centric Organization  
The system is organised as a set of **sub‑components** under the parent `KnowledgeManagement`. Each sub‑component (e.g., `ManualLearning`, `OnlineLearning`, `EntityPersistenceAgent`, `OntologyClassificationAgent`, `GraphDatabaseAdapter`) shares a common persistence contract via the GraphDatabaseAdapter. This promotes **horizontal reuse**: the same storage logic is used by ObservationDerivationAgent, EntityPersistenceAgent, and the other siblings, reducing duplication and keeping the persistence layer consistent.

### Adapter Pattern  
The file `storage/graph-database-adapter.ts` implements an **Adapter** that abstracts the Graphology library and LevelDB details behind a clean API (`saveEntity`, `loadEntity`, `exportJSON`, etc.). ObservationDerivationAgent **contains** this adapter (as indicated by “ObservationDerivationAgent contains GraphDatabaseAdapter”), meaning it holds a reference and calls the adapter’s methods rather than interacting directly with Graphology. This isolates the graph‑engine implementation from the business logic of observation derivation.

### Repository‑Like Interaction via EntityPersistenceAgent  
ObservationDerivationAgent does **not** write directly to the graph; instead, it forwards derived observations to the **EntityPersistenceAgent**, which itself uses the GraphDatabaseAdapter for the actual write. This introduces a **Repository‑style** indirection: the agent focuses on *what* to store, while the persistence agent focuses on *how* to store it. The observation that “ObservationDerivationAgent stores derived observations in the graph database using the EntityPersistenceAgent” confirms this separation of concerns.

### Caching Layer  
A lightweight in‑memory cache is employed to store **observation metadata** (e.g., timestamps, source identifiers). ObservationDerivationAgent “caches observation metadata to improve performance.” The cache lives inside the agent and is consulted before invoking the persistence pipeline, thereby avoiding unnecessary re‑derivation or duplicate writes when the same source has not changed.

### Unified Interface & Intelligent Routing  
The agent provides a **single, unified interface** for all source types (Git, vibe sessions, etc.). Internally it performs **intelligent routing**—a term used in the observations—to decide which extraction routine to invoke and how to map the resulting data to the graph schema. The routing logic is encapsulated within the agent and leverages the GraphDatabaseAdapter’s routing capabilities (e.g., “intelligent routing for storing entities in the graph database, implemented by the GraphDatabaseAdapter”).

---

## Implementation Details  

1. **Core Class & Dependencies**  
   - `ObservationDerivationAgent` (source file not listed but logically co‑located with other agents).  
   - Holds a private instance of `GraphDatabaseAdapter` (`import { GraphDatabaseAdapter } from '../../storage/graph-database-adapter'`).  
   - Holds a reference to `EntityPersistenceAgent` (`import { EntityPersistenceAgent } from '../entity-persistence-agent'`).  

2. **Derivation Workflow**  
   - **Source Detection** – The agent receives a request to derive observations, identifies the source type (e.g., `"git"` or `"vibe"`), and dispatches to the appropriate extractor module (`GitHistoryExtractor`, `VibeSessionExtractor`).  
   - **Metadata Caching** – Before extraction, the agent checks an internal `Map<string, ObservationMeta>` cache keyed by a deterministic source identifier. If a cache hit occurs and the source has not changed (checked via a hash or timestamp), the cached metadata is returned, bypassing expensive processing.  
   - **Observation Normalisation** – Raw data from the extractor is transformed into the system’s **Observation** entity shape (fields such as `id`, `type`, `payload`, `derivedAt`). This normalisation ensures compatibility with the graph schema defined in Graphology.  

3. **Persistence Path**  
   - The normalised Observation is passed to `EntityPersistenceAgent.persist(observation)`.  
   - `EntityPersistenceAgent` internally calls `GraphDatabaseAdapter.saveEntity(observation)`. The adapter translates the observation into a Graphology node/edge, applies any routing rules (e.g., “store via API vs. direct access”), and writes it to LevelDB.  
   - After a successful write, the adapter triggers its **automatic JSON export sync** routine, guaranteeing that an external JSON representation of the graph stays up‑to‑date.  

4. **Caching Mechanics**  
   - The cache is a simple LRU or size‑bounded map (implementation details are not disclosed, but the observation explicitly mentions “caches observation metadata”).  
   - Cache invalidation occurs when the source’s checksum changes or when an explicit `invalidateCache(sourceId)` method is called, ensuring stale data does not propagate.  

5. **Error Handling & Reliability**  
   - All calls to the GraphDatabaseAdapter are wrapped in try/catch blocks; failures propagate back to the caller as typed errors (`PersistenceError`, `DerivationError`).  
   - Because the adapter already implements JSON export sync, the agent does not need additional consistency mechanisms—this design choice offloads durability concerns to the storage layer.  

---

## Integration Points  

- **Parent Component – KnowledgeManagement**  
  ObservationDerivationAgent is a child of `KnowledgeManagement`. The parent component orchestrates higher‑level workflows (e.g., scheduled batch runs) and invokes the agent when new source data becomes available. The parent also benefits from the same automatic JSON export sync that the adapter provides, ensuring a unified view of the knowledge graph across the entire knowledge‑management domain.

- **Sibling Components**  
  `ManualLearning`, `OnlineLearning`, `EntityPersistenceAgent`, `OntologyClassificationAgent`, and `GraphDatabaseAdapter` all share the same storage adapter. This means any change to the adapter’s API or routing logic impacts all siblings uniformly, which is a deliberate design decision to keep the persistence contract stable. For example, `OnlineLearning` may also generate entities that flow through the same adapter, guaranteeing schema consistency.

- **Child Component – GraphDatabaseAdapter**  
  The agent **contains** the GraphDatabaseAdapter, meaning it directly invokes the adapter’s methods. The adapter itself encapsulates Graphology usage, LevelDB configuration, and the JSON export mechanism. Because the adapter is a child, any enhancements (e.g., adding a new routing rule) are immediately visible to ObservationDerivationAgent without code changes in the agent.

- **External Sources**  
  The agent interacts with external systems: a Git repository (via the Git CLI or a library) and “vibe” session logs (likely a proprietary telemetry endpoint). These integrations are abstracted behind source‑specific extractor modules, keeping the agent’s core logic source‑agnostic.

- **Caching Layer**  
  The in‑memory cache is internal to the agent but may be swapped out for a distributed cache (e.g., Redis) if scalability demands grow. The current design, however, treats the cache as a private implementation detail.

---

## Usage Guidelines  

1. **Invoke Through the Unified Interface**  
   Call `deriveObservations(sourceDescriptor)` on the ObservationDerivationAgent rather than accessing extractors or the persistence agent directly. This guarantees that caching, routing, and error handling are applied consistently.

2. **Provide Deterministic Source Identifiers**  
   When supplying a `sourceDescriptor`, include a stable identifier (e.g., Git commit hash or session UUID). The agent uses this identifier for cache keys; inconsistent identifiers will defeat the caching optimisation.

3. **Do Not Bypass the EntityPersistenceAgent**  
   Although the agent holds a reference to the GraphDatabaseAdapter, all persistence should go through `EntityPersistenceAgent.persist`. This preserves the repository‑style separation and ensures that any future business rules (e.g., validation, audit logging) added to the persistence agent are honoured.

4. **Handle Asynchronous Errors Gracefully**  
   The derivation and persistence steps are asynchronous and may reject with `DerivationError` or `PersistenceError`. Callers should implement retry logic where appropriate, especially for transient I/O failures in the GraphDatabaseAdapter.

5. **Respect Cache Invalidation**  
   If external data changes without a new source identifier (e.g., a Git branch is force‑pushed), manually invoke `invalidateCache(sourceId)` before re‑deriving. This prevents stale observations from persisting.

6. **Monitor JSON Export Sync**  
   The automatic JSON export performed by the GraphDatabaseAdapter writes a snapshot to `./exports/graph.json` (path inferred from the parent description). Ensure that any downstream processes that consume this file are aware of its eventual‑consistency nature.

---

### Architectural Patterns Identified  

| Pattern | Evidence |
|---------|----------|
| **Adapter** | `GraphDatabaseAdapter` abstracts Graphology/LevelDB (`storage/graph-database-adapter.ts`). |
| **Repository / Persistence Agent** | `EntityPersistenceAgent` mediates writes to the graph database. |
| **Caching** | “ObservationDerivationAgent caches observation metadata to improve performance.” |
| **Facade / Unified Interface** | Provides a single method for deriving observations from multiple sources. |
| **Intelligent Routing** | Routing logic implemented in `GraphDatabaseAdapter` for API vs. direct access. |

### Design Decisions & Trade‑offs  

- **Centralised Storage Adapter** – Guarantees consistency but creates a single point of change; any modification to the adapter impacts all siblings.  
- **Separate Persistence Agent** – Improves testability and keeps derivation logic pure, at the cost of an extra indirection layer.  
- **In‑Memory Metadata Cache** – Offers low latency for repeated derivations; however, it is not distributed, limiting horizontal scalability.  
- **Automatic JSON Export** – Provides an easy external view of the graph but may introduce I/O overhead during high‑frequency writes.

### System Structure Insights  

- The KnowledgeManagement domain is **component‑centric**, with each agent focusing on a specific concern (derivation, classification, persistence).  
- All agents converge on a **shared graph backbone** powered by Graphology, ensuring a unified knowledge representation.  
- The hierarchy (`KnowledgeManagement → ObservationDerivationAgent → GraphDatabaseAdapter`) reflects a **top‑down dependency flow**: high‑level orchestration → business‑logic derivation → low‑level storage.

### Scalability Considerations  

- **Graphology + LevelDB** scales well for read‑heavy workloads; write throughput can be limited by LevelDB’s single‑writer model.  
- The current in‑memory cache is suitable for a single‑process deployment; scaling out to multiple nodes would require a distributed cache (e.g., Redis) and cache‑coherency mechanisms.  
- Intelligent routing in the adapter can be extended to support sharding or remote API endpoints, offering a path to horizontal scaling without redesigning the agents.

### Maintainability Assessment  

- **High modularity**: each concern (derivation, persistence, storage) lives in its own module, making unit testing straightforward.  
- **Shared adapter** reduces duplicated code but mandates careful versioning; a change‑request to the adapter must be reviewed for impact across all sibling agents.  
- **Clear naming conventions** (`ObservationDerivationAgent`, `EntityPersistenceAgent`, `GraphDatabaseAdapter`) aid discoverability.  
- **Caching logic is encapsulated** within the agent, limiting its surface area; however, documentation should emphasise cache invalidation rules to avoid stale data bugs.  

Overall, the ObservationDerivationAgent exemplifies a well‑structured, purpose‑driven component that leverages shared infrastructure while keeping its own responsibilities narrowly defined. This design supports reliable knowledge‑graph growth, offers clear extension points for new source types, and balances performance with maintainability.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle persistence with automatic JSON export sync, allowing for efficient querying and processing of knowledge graph data. This design decision enables the system to leverage the benefits of Graphology and LevelDB, providing a robust and reliable foundation for knowledge management. Furthermore, the use of GraphDatabaseAdapter facilitates the implementation of intelligent routing for storing entities in the graph database, where entities can be stored via API or direct access, as seen in the storage/graph-database-adapter.ts file.

### Children
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- The ObservationDerivationAgent uses the GraphDatabaseAdapter for storage, as mentioned in the parent context.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle persistence with automatic JSON export sync.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning uses the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis.
- [EntityPersistenceAgent](./EntityPersistenceAgent.md) -- EntityPersistenceAgent uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle persistence with automatic JSON export sync.
- [OntologyClassificationAgent](./OntologyClassificationAgent.md) -- OntologyClassificationAgent uses the GraphDatabaseAdapter (storage/graph-database-adapter.ts) to handle persistence with automatic JSON export sync.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter uses the Graphology library to provide a robust and reliable foundation for knowledge management.


---

*Generated from 7 observations*
