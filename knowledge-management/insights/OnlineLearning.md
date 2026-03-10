# OnlineLearning

**Type:** SubComponent

The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) can be used to generate detailed trace reports of UKB workflow runs, which can inform OnlineLearning.

**## What It Is**  

OnlineLearning is a *sub‑component* of the **KnowledgeManagement** suite that orchestrates the automated extraction of development‑knowledge artefacts and feeds them into the system’s graph database. The core of its implementation lives inside the **batch analysis pipeline** that pulls data from three distinct sources – git history, LSL (Live‑Session‑Log) recordings, and static code analysis – and converts each stream into graph entities. The pipeline re‑uses concrete agents that already exist in the repository:  

* **CodeGraphAgent** (`integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts`) – builds code‑knowledge graphs from the static analysis of source files.  
* **PersistenceAgent** (`integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts`) – persists the generated entities and applies ontology classification.  
* **GraphDatabaseAdapter** (`integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`) – abstracts the underlying graph store where all knowledge is finally recorded.  

Additionally, the **ukb‑trace‑report** utility (`integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts`) can be invoked to produce detailed trace logs of the batch run, giving developers visibility into what was learned and how it was stored. In short, OnlineLearning is the glue that binds raw development artefacts to the semantic graph used by the broader KnowledgeManagement platform.

---

**## Architecture and Design**  

The design of OnlineLearning follows a **modular, agent‑based pipeline** architecture. Each source of knowledge (git, LSL, code analysis) is treated as a separate stage that produces a stream of domain objects. Those objects are handed off to the **PersistenceAgent**, which encapsulates two responsibilities: (1) persisting the entities via the **GraphDatabaseAdapter**, and (2) classifying them against the platform’s ontology. This separation of concerns mirrors the modular pattern described for the parent **KnowledgeManagement** component, where adapters, agents, and utilities are kept in distinct directories (`src/agents`, `src/storage`, `src/utils`).  

The **CodeGraphAgent** acts as a specialized *semantic analysis* agent. It parses source files, extracts symbols, relationships, and higher‑level constructs, and emits a graph‑ready representation. Because OnlineLearning can also ingest LSL session data, the pipeline likely contains a lightweight transformer that normalises LSL events into the same graph schema before they reach the PersistenceAgent.  

Traceability is built in through the **ukb‑trace‑report** utility, which logs each step of the batch run (e.g., “git commit X processed”, “LSL session Y ingested”, “code graph node Z persisted”). This aligns with the parent component’s emphasis on detailed workflow reporting and supports debugging and auditability without imposing a separate logging framework.  

Overall, the architecture can be summarised as:

```
[Git History] ──\
[LSL Sessions] ──►  Batch Pipeline (transform → CodeGraphAgent) ──► PersistenceAgent ──► GraphDatabaseAdapter
[Code Analysis] ──/
                │
                └─► ukb‑trace‑report (side‑car logging)
```

No higher‑level patterns such as micro‑services or event‑driven messaging are introduced; the system remains a single‑process, batch‑oriented pipeline that leverages clear module boundaries.

---

**## Implementation Details**  

1. **Source Extraction** – The pipeline begins by invoking git commands (or using a library) to walk the repository’s commit history. Each commit is transformed into a set of *knowledge events* (e.g., file added, function renamed). LSL sessions are read from their log files, parsed, and mapped to temporal events that describe developer actions.  

2. **CodeGraphAgent** (`code-graph-agent.ts`) – This agent receives the raw source snapshots and performs static analysis. It builds a **code knowledge graph** where nodes represent entities such as classes, functions, and modules, while edges capture relationships like “calls”, “inherits”, or “imports”. The agent’s public API likely exposes a method such as `generateGraph(sourceTree: SourceTree): GraphModel`.  

3. **PersistenceAgent** (`persistence-agent.ts`) – After the graph model is produced, the PersistenceAgent takes each node/edge, determines its ontology class (e.g., `CodeEntity`, `DeveloperAction`), and forwards the payload to the **GraphDatabaseAdapter**. The adapter abstracts the underlying graph store (Neo4j, JanusGraph, etc.) and offers CRUD‑style methods (`saveNode`, `saveEdge`). The PersistenceAgent also handles batch writes, ensuring that large git histories or long LSL sessions do not overwhelm the database.  

4. **GraphDatabaseAdapter** (`graph-database-adapter.ts`) – This adapter isolates the rest of the pipeline from the specifics of the graph database driver. It implements a thin wrapper around connection handling, transaction management, and query execution. By keeping the adapter in `src/storage`, the design makes it straightforward to swap the backing store if needed.  

5. **Trace Reporting** (`ukb-trace-report.ts`) – Throughout the run, the pipeline emits structured trace entries (timestamp, stage, status). The utility aggregates these entries into a final report that can be stored alongside the graph data or presented in UI dashboards.  

The sibling components illustrate reuse: **ManualLearning** also uses the PersistenceAgent for its own ontology‑driven persistence, while **TraceReportModule** directly consumes the ukb‑trace‑report utility. This shared usage reinforces a consistent contract across the KnowledgeManagement domain.

---

**## Integration Points**  

- **Parent Component – KnowledgeManagement**: OnlineLearning is one of several learning modalities (ManualLearning, TraceReportModule, Persistence) that feed the central graph. All of them rely on the same **GraphDatabaseAdapter** and **PersistenceAgent**, guaranteeing a unified data model across the suite.  

- **Sibling – Persistence**: The Persistence sub‑component provides the concrete implementation of entity storage; OnlineLearning does not implement its own storage logic but delegates to this sibling, adhering to the “single source of truth” principle for persistence.  

- **Sibling – ManualLearning**: While ManualLearning ingests knowledge from explicit user actions, OnlineLearning complements it with automated, batch‑derived knowledge. Both pipelines converge on the same ontology, meaning that downstream consumers (search, recommendation, analytics) see a seamless graph.  

- **Utility – ukb‑trace‑report**: The trace utility is invoked by OnlineLearning to produce run‑time diagnostics. Other components (TraceReportModule) may consume the same reports for monitoring or compliance purposes.  

- **External Sources**: Git repositories, LSL log files, and the static code base are the only external dependencies. The pipeline treats each as a read‑only input, keeping side‑effects confined to the graph database.  

All interactions are synchronous within the batch run; there is no asynchronous messaging layer observed, which simplifies deployment but also means that scaling must be addressed at the batch‑process level (e.g., parallelizing per‑commit or per‑session processing).

---

**## Usage Guidelines**  

1. **Run the Batch Pipeline Only in Controlled Environments** – Because OnlineLearning walks the entire git history and may ingest large LSL logs, it should be executed on a machine with sufficient CPU, memory, and I/O bandwidth. Prefer CI/CD or scheduled jobs rather than ad‑hoc developer machines.  

2. **Do Not Modify the PersistenceAgent Directly** – All ontology classification and graph writes are encapsulated in `persistence-agent.ts`. Extensions should be added as new agents or adapters rather than altering the existing agent, preserving the contract used by ManualLearning and other siblings.  

3. **Leverage ukb‑trace‑report for Debugging** – When a batch run fails or yields unexpected graph structures, inspect the generated trace report. It provides a chronological view of which source (git, LSL, code) was processed and where the pipeline may have halted.  

4. **Keep the Graph Schema Consistent** – Since multiple learning components share the same graph, any change to node or edge types must be reflected in the ontology used by the PersistenceAgent. Coordinate schema updates through the KnowledgeManagement team to avoid fragmentation.  

5. **Monitor Batch Duration and Database Load** – The PersistenceAgent performs bulk writes via the GraphDatabaseAdapter; monitor transaction sizes and database latency. If batch times grow linearly with repository size, consider sharding the commit history into smaller windows or adding pagination inside the adapter.  

---

### Architectural Patterns Identified  
1. **Modular/Component‑Based Architecture** – Clear separation of agents, adapters, and utilities.  
2. **Pipeline (Batch Processing) Pattern** – Sequential stages (extract → transform → load) applied to multiple data sources.  
3. **Agent Pattern** – Dedicated agents (`CodeGraphAgent`, `PersistenceAgent`) encapsulate distinct responsibilities.  
4. **Adapter Pattern** – `GraphDatabaseAdapter` abstracts the concrete graph store implementation.

### Design Decisions and Trade‑offs  
- **Single‑Process Batch vs. Distributed Processing** – Simplicity and deterministic ordering are gained, but scalability is limited to the resources of a single node.  
- **Shared PersistenceAgent Across Siblings** – Promotes consistency and reduces duplication, but couples ManualLearning and OnlineLearning tightly to the same persistence logic, making independent evolution harder.  
- **Explicit Trace Utility** – Improves observability without adding a full‑blown logging framework; however, it introduces an extra side‑car component that must be maintained.  

### System Structure Insights  
- The **KnowledgeManagement** parent acts as a container for learning‑related sub‑components, each exposing a focused agent set.  
- **OnlineLearning** sits alongside **ManualLearning** and **TraceReportModule**, sharing the same persistence and reporting infrastructure, which creates a unified knowledge graph across automated and manual inputs.  

### Scalability Considerations  
- Since the pipeline processes the entire git history and potentially large LSL logs, execution time grows with repository size. Horizontal scaling is not inherent; to improve throughput, developers could parallelise per‑commit or per‑session processing inside the pipeline or split the workload across multiple batch jobs.  
- The **GraphDatabaseAdapter** should support bulk write operations and transaction batching to avoid overwhelming the graph store.  

### Maintainability Assessment  
- The modular layout (agents, adapters, utils) makes the codebase approachable; each concern lives in its own directory, easing navigation and unit testing.  
- Reuse of the **PersistenceAgent** across siblings reduces code duplication but creates a single point of change; any modification must be vetted against all consumers.  
- Absence of dynamic configuration (e.g., plugin registries) means adding new knowledge sources requires code changes rather than declarative extensions, slightly increasing the effort for future growth.  

Overall, OnlineLearning is a well‑encapsulated, batch‑oriented sub‑component that leverages the existing agent‑based infrastructure of KnowledgeManagement to enrich the system’s semantic graph with automatically extracted development knowledge.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes a modular architecture, with separate modules for graph database adaptation, persistence, and semantic analysis. This is evident in the way the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) is used for persistence, and the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) is used for managing entity persistence and ontology classification. The CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) is also used for constructing code knowledge graphs and providing semantic code search capabilities. The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) is used for generating detailed trace reports of UKB workflow runs. This modular design allows for flexibility and maintainability of the component.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning utilizes the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) for managing entity persistence and ontology classification.
- [TraceReportModule](./TraceReportModule.md) -- The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) is used to generate detailed trace reports of UKB workflow runs.
- [Persistence](./Persistence.md) -- The PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) is used for managing entity persistence and ontology classification.


---

*Generated from 7 observations*
