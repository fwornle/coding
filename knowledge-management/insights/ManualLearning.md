# ManualLearning

**Type:** SubComponent

ManualLearning uses the ensureLLMInitialized() method, likely defined in the Wave agent classes, to ensure that the LLM instance is properly initialized before manual entity creation or editing

## What It Is  

ManualLearning is a **SubComponent** of the larger **KnowledgeManagement** module. Its implementation lives alongside the graph‑persistence layer found in `storage/graph-database-adapter.ts`. Within this file the `GraphDatabaseAdapter` class provides the low‑level API that ManualLearning calls to **store and retrieve manual knowledge entities**. The sub‑component does not introduce its own storage implementation; instead it delegates all graph‑database interactions to the shared adapter used by its siblings (e.g., `EntityPersistenceManager`, `DataLossTracker`, `KnowledgeGraphQueryEngine`).  

In practice, ManualLearning is the runtime façade that lets users create, edit, and persist **manually authored knowledge objects** (e.g., documentation snippets, design decisions, or ad‑hoc annotations). Before any operation that touches the graph, ManualLearning invokes the same **LLM‑initialisation contract** that the Wave agents use: a three‑step flow of `constructor(repoPath, team) → ensureLLMInitialized() → execute(input)`. This guarantees that the large language model (LLM) backing the knowledge‑creation UI is ready, while also keeping the cost of LLM startup lazy and on‑demand.

---

## Architecture and Design  

### Design Patterns Evident  

1. **Factory Pattern for LLM Instances** – ManualLearning relies on the same LLM factory employed by the Wave agents. The factory abstracts the concrete LLM class (e.g., OpenAI, Anthropic) and creates an instance only when `ensureLLMInitialized()` is called. This avoids eager allocation of heavyweight model resources.  

2. **Lazy Initialization (Constructor + ensureLLMInitialized + execute)** – The sub‑component follows the “constructor‑then‑ensure‑initialized‑then‑execute” pattern that the Wave agents expose. The constructor only records contextual data (`repoPath`, `team`) and defers any heavy work until the first call that actually needs the LLM.  

3. **Data‑Access Object (DAO) via GraphDatabaseAdapter** – All persistence actions are funneled through `GraphDatabaseAdapter` (located in `storage/graph-database-adapter.ts`). This adapter acts as a DAO, shielding ManualLearning from the specifics of LevelDB‑backed graph storage and providing a uniform CRUD interface.  

4. **Cross‑Cutting Concern – DataLossTracker** – ManualLearning wires in the `DataLossTracker` (a sibling component) to monitor any gaps between intended manual edits and what actually lands in the graph. This is an example of an observability concern that is injected rather than baked into the core logic.  

### Component Interaction  

- **ManualLearning → EntityPersistenceManager** – When a manual entity is created or edited, ManualLearning forwards the entity object to `EntityPersistenceManager`, which in turn uses `GraphDatabaseAdapter` to write the node/edge payload into the graph.  
- **ManualLearning → DataLossTracker** – After each persistence operation, ManualLearning reports success/failure to `DataLossTracker`. The tracker records the event in the same graph store, enabling downstream analytics (e.g., “how many manual edits were lost due to concurrency”).  
- **ManualLearning ↔ KnowledgeManagement (Parent)** – KnowledgeManagement orchestrates the overall lifecycle of knowledge assets. ManualLearning contributes the “human‑in‑the‑loop” path, complementing the automated pipelines of its sibling `OnlineLearning`. Both share the same LLM factory and graph‑storage backbone, ensuring a consistent data model across manual and automated knowledge ingestion.  

---

## Implementation Details  

### Core Classes & Functions  

- **`GraphDatabaseAdapter` (storage/graph-database-adapter.ts)** – Exposes methods such as `saveEntity(entity)`, `fetchEntity(id)`, and `queryGraph(criteria)`. ManualLearning never touches LevelDB directly; it calls these high‑level adapters.  

- **`EntityPersistenceManager`** – Acts as a service layer that validates manual entities, enriches them with metadata (e.g., timestamps, author IDs), and then delegates to `GraphDatabaseAdapter.saveEntity`.  

- **`DataLossTracker`** – Provides `recordLoss(event)` and `queryLosses(filter)` APIs. ManualLearning invokes `recordLoss` after each persistence attempt, passing context like `entityId`, `operationType`, and any error payload.  

- **LLM Initialisation Flow** – The sub‑component’s constructor stores `repoPath` and `team`. The first call to `execute(input)` triggers `ensureLLMInitialized()`, which internally calls the shared LLM factory (`LLMFactory.create(repoPath, team)`). The resulting LLM instance is cached for the lifetime of the ManualLearning instance, enabling subsequent calls to reuse the model without re‑initialisation.  

### Execution Path  

1. **User Input** – A developer or knowledge‑worker submits a manual entry via UI or CLI.  
2. **ManualLearning.execute(input)** – The input is parsed, and the LLM (if needed for augmentation or validation) is guaranteed to be ready via `ensureLLMInitialized()`.  
3. **Entity Construction** – ManualLearning builds a domain entity object (e.g., `{ id, type, content, author, timestamps }`).  
4. **Persistence** – The entity is handed to `EntityPersistenceManager.persist(entity)`, which validates and then calls `GraphDatabaseAdapter.saveEntity`.  
5. **Loss Tracking** – Upon success or failure, ManualLearning notifies `DataLossTracker.recordLoss` with the operation outcome.  

Because the observations do not list any concrete method signatures beyond the high‑level pattern, the above flow is derived directly from the described interactions and the known responsibilities of each sibling component.

---

## Integration Points  

- **Graph Storage Layer** – The sole external dependency is `storage/graph-database-adapter.ts`. Any change to the underlying LevelDB schema or query language must be reflected in the adapter’s contract; ManualLearning will automatically benefit because it never bypasses the adapter.  

- **LLM Factory (Wave agents)** – ManualLearning re‑uses the LLM factory defined for the Wave agents. This means that configuration files governing model selection, API keys, and rate‑limit handling are shared across the entire KnowledgeManagement subsystem.  

- **EntityPersistenceManager & DataLossTracker** – Both are injected services (likely via constructor or a simple service locator). Their public APIs are the only integration surface ManualLearning touches; they encapsulate validation, metadata enrichment, and observability respectively.  

- **Parent KnowledgeManagement** – At a higher level, KnowledgeManagement may orchestrate batch imports (via `OnlineLearning`) and manual edits (via ManualLearning). The parent component likely provides the `repoPath` and `team` context that ManualLearning’s constructor expects, ensuring consistent scoping across all knowledge ingestion paths.  

---

## Usage Guidelines  

1. **Instantiate with Context** – Always create a ManualLearning instance using the pattern `new ManualLearning(repoPath, team)`. The `repoPath` should point to the repository root that the knowledge graph represents, and `team` must be a valid identifier recognized by the LLM factory.  

2. **Let Lazy Init Do Its Work** – Do not manually call the LLM factory; rely on `ensureLLMInitialized()` being invoked automatically the first time `execute` runs. This prevents unnecessary model loading and respects the resource‑conscious design of the Wave agents.  

3. **Validate Before Persisting** – While `EntityPersistenceManager` performs validation, callers should still perform basic sanity checks (e.g., non‑empty content, correct entity type) to avoid unnecessary round‑trips to the graph store.  

4. **Handle Data‑Loss Signals** – After each `execute` call, inspect the response from `DataLossTracker`. If a loss is reported, surface it to the user or trigger a retry. This aligns with the system’s emphasis on tracking manual‑edit fidelity.  

5. **Do Not Bypass the Adapter** – Direct interaction with LevelDB or the underlying graph engine is discouraged. All reads and writes must go through `GraphDatabaseAdapter` (via the persistence manager) to guarantee schema consistency and future compatibility.  

---

## Architectural Patterns Identified  

| Pattern | Where It Appears | Rationale |
|---------|------------------|-----------|
| Factory (LLM creation) | Wave agents, reused by ManualLearning | Centralises model selection and configuration, enables lazy instantiation |
| Lazy Initialization (constructor → ensureLLMInitialized → execute) | ManualLearning, Wave agents | Defers heavyweight LLM startup until truly needed, saving memory and CPU |
| Data‑Access Object (GraphDatabaseAdapter) | `storage/graph-database-adapter.ts` | Provides a single, stable API for all graph operations across siblings |
| Cross‑cutting Observability (DataLossTracker) | ManualLearning ↔ DataLossTracker | Separates loss‑monitoring concerns from core business logic |
| Service Layer (EntityPersistenceManager) | ManualLearning → EntityPersistenceManager | Encapsulates validation and enrichment before persisting entities |

---

## Design Decisions and Trade‑offs  

* **Shared LLM Factory vs. Independent Instances** – Reusing the same factory reduces duplication and guarantees that all agents (Wave, ManualLearning, OnlineLearning) operate against the same model version. The trade‑off is a tighter coupling: a change in the factory’s configuration impacts every consumer.  

* **Lazy LLM Initialization** – Saves resources in environments where manual edits are infrequent, but introduces a small latency on the first manual operation (model load time). This is acceptable because manual edits are typically user‑driven and can tolerate a one‑time delay.  

* **Single GraphDatabaseAdapter** – Centralising persistence logic simplifies schema evolution and testing. However, it creates a single point of failure; any performance bottleneck in the adapter propagates to all knowledge‑ingestion paths.  

* **Explicit DataLoss Tracking** – By surfacing potential loss events, the system gains transparency at the cost of additional write traffic (each edit generates a loss‑tracking record). In practice, the overhead is modest compared to the value of auditability.  

---

## System Structure Insights  

The KnowledgeManagement hierarchy follows a **vertical layering**: a parent component (`KnowledgeManagement`) defines the overall knowledge‑graph contract and common services (LLM factory, graph adapter). Beneath it sit **parallel ingestion pipelines** – `OnlineLearning` (automated batch extraction) and `ManualLearning` (human‑driven entry). Both pipelines share the same persistence and observability services (`EntityPersistenceManager`, `DataLossTracker`, `GraphDatabaseAdapter`). This design yields a **coherent data model** while allowing each pipeline to evolve its own business rules.  

Because all siblings depend on the same adapter, any new entity type introduced by ManualLearning can be immediately queried by `KnowledgeGraphQueryEngine` without additional glue code. Conversely, improvements to the adapter (e.g., index creation) benefit the entire knowledge ecosystem.

---

## Scalability Considerations  

* **Graph Store Scaling** – The underlying graph database (LevelDB‑based) is the primary scalability bottleneck. Since ManualLearning only writes individual entities, write contention is low, but a surge of simultaneous manual edits could stress the adapter’s transaction handling. Horizontal scaling would require sharding or moving to a more distributed graph store.  

* **LLM Instance Contention** – The lazy‑initialized LLM is cached per `ManualLearning` instance. In a multi‑process deployment (e.g., many CLI workers), each process will load its own model, potentially exhausting GPU/CPU resources. A shared LLM service (e.g., via RPC) could mitigate this but would break the current factory‑based lazy pattern.  

* **DataLossTracker Overhead** – Recording loss events for every edit adds write amplification. If the volume of manual edits grows dramatically, consider batching loss records or moving them to a lightweight time‑series store.  

Overall, the current architecture is well‑suited for moderate manual‑editing workloads typical of developer tooling; scaling beyond that would require re‑architecting the persistence layer and LLM hosting model.

---

## Maintainability Assessment  

* **High Cohesion, Low Coupling** – ManualLearning’s responsibilities (LLM‑assisted manual entry, delegating persistence, reporting loss) are clearly delineated. It depends only on three well‑defined services, making the codebase easy to reason about.  

* **Centralised Persistence Logic** – By funnelling all graph interactions through `GraphDatabaseAdapter`, changes to storage (schema migrations, index additions) are isolated to a single file, reducing the maintenance surface.  

* **Pattern Consistency Across Siblings** – The reuse of the constructor → ensureLLMInitialized → execute flow across Wave agents, OnlineLearning, and ManualLearning ensures that developers only need to learn one initialization idiom.  

* **Potential Technical Debt** – The reliance on lazy LLM creation means that debugging initialization failures can be non‑deterministic (they only surface on first use). Adding explicit health‑check hooks in the parent component could alleviate this.  

* **Observability Integration** – `DataLossTracker` provides built‑in audit trails, which simplifies future compliance or debugging work, further enhancing maintainability.  

In summary, ManualLearning exhibits a clean, pattern‑driven design that aligns with its siblings, leverages shared infrastructure, and isolates concerns effectively, positioning it for straightforward evolution and low maintenance overhead.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a factory pattern for creating LLM instances, as seen in the Wave agents, which follow the constructor(repoPath, team) + ensureLLMInitialized() + execute(input) pattern for lazy LLM initialization. This pattern allows for efficient initialization of LLM instances only when required, reducing unnecessary resource allocation. The ensureLLMInitialized() method, likely defined in the Wave agent classes, ensures that the LLM instance is properly initialized before execution. This approach enables the component to manage resources effectively and optimize performance. The GraphDatabaseAdapter, employed for Graphology+LevelDB persistence, also plays a crucial role in storing and retrieving knowledge graph data, as defined in storage/graph-database-adapter.ts.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning utilizes the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis
- [EntityPersistenceManager](./EntityPersistenceManager.md) -- EntityPersistenceManager utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve entities in the graph database
- [DataLossTracker](./DataLossTracker.md) -- DataLossTracker utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to store and retrieve data loss information
- [KnowledgeGraphQueryEngine](./KnowledgeGraphQueryEngine.md) -- KnowledgeGraphQueryEngine utilizes the GraphDatabaseAdapter in storage/graph-database-adapter.ts to query and retrieve knowledge entities from the graph database


---

*Generated from 7 observations*
