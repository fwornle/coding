# ManualLearning

**Type:** SubComponent

The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) can be used to generate detailed trace reports of UKB workflow runs, which can inform ManualLearning.

## What It Is  

**ManualLearning** is the sub‑component of the **KnowledgeManagement** domain that deals with human‑crafted knowledge artifacts.  All of the source code that supports this capability lives under the *integrations/mcp‑server‑semantic‑analysis* tree.  In practice, a user creates or edits an entity (for example a concept, observation, or classification) by hand; the entity is then handed off to the **PersistenceAgent** (`integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts`) which writes the data into the underlying graph store through the **GraphDatabaseAdapter** (`integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts`).  When the learning activity requires a richer view of code, the **CodeGraphAgent** (`integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts`) can be invoked to enrich the manual entities with a code‑knowledge graph.  Optional traceability information can be generated with the **ukb‑trace‑report** utility (`integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts`).  

In short, ManualLearning orchestrates the flow from **manual authoring** → **persistence & ontology classification** → **optional graph enrichment** → **trace reporting**, all within the broader KnowledgeManagement component.

---

## Architecture and Design  

The observations reveal a **modular, agent‑centric architecture**.  Each responsibility is encapsulated in a dedicated module:

* **PersistenceAgent** – the façade that coordinates entity persistence and ontology classification.  
* **GraphDatabaseAdapter** – the low‑level adapter that translates persistence requests into operations against the graph database.  
* **CodeGraphAgent** – a specialised agent that builds code‑knowledge graphs and can be called from ManualLearning to provide semantic context.  
* **ukb‑trace‑report** – a utility module that produces detailed execution traces for UKB (the underlying reasoning engine).

The interaction pattern is essentially **Facade + Adapter**: ManualLearning calls the PersistenceAgent (the façade) which, in turn, delegates the actual storage work to the GraphDatabaseAdapter (the adapter).  This separation keeps the high‑level learning logic independent of the concrete graph‑store implementation, making it straightforward to swap the storage backend if required.

Because ManualLearning shares the same agents and utilities with its siblings—**OnlineLearning**, **TraceReportModule**, and **Persistence**—the architecture promotes **reuse**.  For instance, OnlineLearning also relies on the PersistenceAgent for persisting batch‑derived entities, while TraceReportModule directly uses `ukb-trace-report`.  The common parent **KnowledgeManagement** therefore provides a cohesive “knowledge pipeline” where each sub‑component plugs into the same persistence and tracing infrastructure.

No higher‑level architectural styles (e.g., micro‑services, event‑driven) are mentioned, so the design is best described as a **single‑process, modular system** that isolates concerns through well‑named agents and adapters.

---

## Implementation Details  

1. **Manual entity creation** – Developers or domain experts construct entity objects (the exact class is not listed, but they are “manually authored”).  These objects are handed to the **PersistenceAgent** (`src/agents/persistence-agent.ts`).  The agent is responsible for two tasks: persisting the raw entity and invoking the ontology classification logic that tags the entity with appropriate semantic types.

2. **Persistence flow** – Inside `persistence-agent.ts`, the agent likely exposes a method such as `saveEntity(entity)` (the exact signature is not provided).  This method calls into the **GraphDatabaseAdapter** (`src/storage/graph-database-adapter.ts`).  The adapter implements the concrete CRUD operations against the graph database (e.g., Cypher queries for Neo4j or Gremlin for JanusGraph).  By confining all graph‑specific code to this file, the rest of the system remains agnostic to the underlying storage engine.

3. **Editing existing entities** – When a user edits an entity, the same pathway is used: the edited object is sent to the PersistenceAgent, which updates the node/relationship in the graph via the GraphDatabaseAdapter.  This ensures that both creation and mutation share a consistent persistence contract.

4. **Code knowledge graph enrichment** – If ManualLearning needs to relate a manual observation to code artefacts, it invokes the **CodeGraphAgent** (`src/agents/code-graph-agent.ts`).  The agent traverses the codebase, extracts symbols, and creates a knowledge graph that can be linked back to the manually created entity.  Although the exact linking mechanism is not described, the presence of this agent indicates that ManualLearning can augment human‑crafted knowledge with automatically derived code semantics.

5. **Trace reporting** – The utility `ukb-trace-report.ts` can be called after a UKB workflow (e.g., after ontology classification or after a code‑graph build) to emit a detailed trace.  This trace is useful for debugging ManualLearning pipelines and for auditing how a manual observation was classified or enriched.

Because the source observation reports “0 code symbols found,” the concrete class and method names are not enumerated, but the file paths give a precise anchor for any future code navigation.

---

## Integration Points  

* **Parent – KnowledgeManagement** – ManualLearning is a child of KnowledgeManagement, meaning it participates in the overall knowledge acquisition and storage pipeline.  All persistence and tracing facilities defined at the KnowledgeManagement level are reused here.

* **Sibling – Persistence** – The Persistence sub‑component also depends on `persistence-agent.ts` and `graph-database-adapter.ts`.  ManualLearning and Persistence therefore share the same persistence contract, ensuring that manually authored entities are stored in the same graph schema as automatically extracted ones.

* **Sibling – OnlineLearning** – OnlineLearning consumes the same persistence layer for batch‑generated entities.  If an online learning run discovers a concept that should be manually verified, the workflow can hand that concept over to ManualLearning without any format conversion.

* **Sibling – TraceReportModule** – The TraceReportModule directly uses `ukb-trace-report.ts`.  ManualLearning can call the same utility to generate trace artefacts for any manual edit, keeping observability consistent across the system.

* **External – Graph Database** – The GraphDatabaseAdapter abstracts the actual graph store.  ManualLearning does not interact with the database directly; any change to the storage technology would be isolated to this adapter file.

* **External – Code Base** – When the CodeGraphAgent is employed, it reads source files from the repository (paths not listed) and writes derived graph structures back through the same persistence pathway.

These integration points illustrate a **tight coupling to shared agents** but a **loose coupling to storage and external analysis tools**, which is a deliberate design decision to keep manual and automated knowledge flows interchangeable.

---

## Usage Guidelines  

1. **Create or edit entities only through the PersistenceAgent** – Direct manipulation of the graph database is discouraged.  Always call the façade methods provided by `persistence-agent.ts` so that ontology classification and any side‑effects (e.g., event logging) are reliably executed.

2. **Leverage the GraphDatabaseAdapter for custom queries** – If a developer needs to run a bespoke graph query that is not covered by the PersistenceAgent, they should extend or use the methods in `graph-database-adapter.ts`.  This keeps custom logic confined to the adapter layer.

3. **Enrich manual entities with CodeGraphAgent when code context is required** – After persisting a manual observation, invoke the CodeGraphAgent to generate a code‑knowledge sub‑graph and link it back to the entity.  This should be done as a separate step to avoid coupling the persistence transaction with potentially long‑running code analysis.

4. **Generate trace reports after each manual operation** – Call `ukb-trace-report.ts` to produce a trace file.  This aids debugging and provides an audit trail for manual edits, especially in regulated environments.

5. **Respect the shared contract with sibling components** – When designing new manual learning features, follow the same data schema and classification rules used by OnlineLearning and Persistence.  Consistency ensures that downstream queries (e.g., semantic search) treat manual and automated entities uniformly.

---

### Architectural patterns identified  

* **Facade pattern** – `PersistenceAgent` acts as a façade over persistence and classification.  
* **Adapter pattern** – `GraphDatabaseAdapter` isolates the graph‑store implementation from the rest of the system.  
* **Modular/Agent‑centric design** – Distinct agents (`PersistenceAgent`, `CodeGraphAgent`) encapsulate separate concerns.

### Design decisions and trade‑offs  

* **Centralised persistence via a façade** simplifies usage but introduces a single point of change if classification logic evolves.  
* **Adapter isolation** provides storage flexibility at the cost of an extra indirection layer.  
* **Optional code‑graph enrichment** keeps the manual path lightweight; however, developers must manage the extra step when richer context is needed.

### System structure insights  

* ManualLearning sits under **KnowledgeManagement**, sharing core agents with its siblings.  
* All persistence‑related code resides in `src/agents` and `src/storage`, reinforcing a clear separation between business logic (agents) and infrastructure (adapter).  
* Traceability is provided by a dedicated utility rather than being embedded in agents, promoting reuse across the whole component suite.

### Scalability considerations  

* Because persistence is funneled through the GraphDatabaseAdapter, scaling the underlying graph database (e.g., clustering, sharding) will directly benefit ManualLearning without code changes.  
* The agent model allows parallel processing of multiple manual edits, provided the adapter and underlying DB support concurrent writes.  
* Enrichment via CodeGraphAgent can become a bottleneck for large codebases; it is advisable to run it asynchronously or batch‑process enrichments.

### Maintainability assessment  

* **High maintainability** – Clear separation of concerns, well‑named modules, and shared agents reduce duplication.  
* **Ease of updates** – Changing the graph store or classification algorithm requires modifications only in the adapter or the agent, leaving ManualLearning callers untouched.  
* **Potential risk** – The reliance on a single PersistenceAgent means that bugs or performance regressions in that file can impact all knowledge‑acquisition pathways (manual, online, persistence).  Adequate unit and integration tests around `persistence-agent.ts` are therefore critical.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes a modular architecture, with separate modules for graph database adaptation, persistence, and semantic analysis. This is evident in the way the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) is used for persistence, and the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) is used for managing entity persistence and ontology classification. The CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) is also used for constructing code knowledge graphs and providing semantic code search capabilities. The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) is used for generating detailed trace reports of UKB workflow runs. This modular design allows for flexibility and maintainability of the component.

### Siblings
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning utilizes the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis.
- [TraceReportModule](./TraceReportModule.md) -- The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) is used to generate detailed trace reports of UKB workflow runs.
- [Persistence](./Persistence.md) -- The PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) is used for managing entity persistence and ontology classification.


---

*Generated from 7 observations*
