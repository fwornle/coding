# Persistence

**Type:** SubComponent

The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) can be used to generate detailed trace reports of UKB workflow runs, which can inform the Persistence sub-component.

## What It Is  

The **Persistence** sub‑component lives inside the *KnowledgeManagement* domain of the MCP server and is implemented primarily in three source files:  

* `integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts` – the **PersistenceAgent** that orchestrates entity storage and ontology classification.  
* `integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts` – the **GraphDatabaseAdapter** that translates the component’s domain objects into the concrete calls required by the underlying graph database.  
* `integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts` – the **CodeGraphAgent** that can feed code‑level knowledge graphs into Persistence when needed.  

In practice, developers or automated pipelines create **manually authored entities** or **hand‑crafted observations** (e.g., notes, classifications) and hand them to the PersistenceAgent. The agent validates the payload, assigns ontology metadata, and then persists the result through the GraphDatabaseAdapter into the graph store. The sub‑component also supports **direct edits** to existing entities; such updates are routed through the same adapter so the graph database remains the single source of truth. Ancillary utilities such as `integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts` can generate trace reports that surface the lifecycle of these persistence operations, giving developers visibility into the UKB workflow that produced or modified the data.

---

## Architecture and Design  

Persistence is built as a **modular, adapter‑driven layer** within KnowledgeManagement. The design separates *concern* (what to store) from *mechanism* (how to store it). The **PersistenceAgent** acts as a façade for higher‑level callers (e.g., ManualLearning, TraceReportModule) and encapsulates business rules around ontology classification. Underneath, the **GraphDatabaseAdapter** implements an *Adapter* pattern: it hides the specifics of the graph database API (queries, transaction handling, schema mapping) behind a clean, type‑safe TypeScript interface. This allows the rest of the system to remain agnostic to the particular graph store implementation and makes swapping or extending the storage backend straightforward.

The **CodeGraphAgent** illustrates an *Agent* pattern where a self‑contained unit is responsible for constructing and enriching a code knowledge graph. When the Persistence sub‑component needs to persist code‑level artifacts, it can invoke the CodeGraphAgent to obtain a ready‑made graph fragment, which the PersistenceAgent then forwards to the GraphDatabaseAdapter. This collaboration is loosely coupled: the agents communicate through well‑defined data contracts rather than shared mutable state.

Sibling components such as **ManualLearning** also reuse the PersistenceAgent, demonstrating a **shared service** approach. The parent **KnowledgeManagement** component’s description explicitly calls out this modular architecture, confirming that Persistence is one of several interchangeable modules (ManualLearning, OnlineLearning, TraceReportModule) that together provide a cohesive knowledge pipeline.

---

## Implementation Details  

* **PersistenceAgent (`persistence-agent.ts`)** – Exposes methods like `createEntity`, `updateEntity`, and `classifyOntology`. Internally it validates incoming payloads, enriches them with ontology tags (e.g., “Observation”, “Entity”), and delegates the actual write operation to the GraphDatabaseAdapter. The agent also logs activity through the UKB trace utilities, enabling downstream trace‑report generation.

* **GraphDatabaseAdapter (`graph-database-adapter.ts`)** – Implements low‑level CRUD operations against the graph store. Typical functions include `runQuery`, `upsertNode`, and `deleteRelationship`. The adapter abstracts connection handling, transaction boundaries, and error translation so callers never need to manage driver specifics. Its presence in the `storage` folder signals a clear separation between *domain* logic (agents) and *infrastructure* logic (storage).

* **CodeGraphAgent (`code-graph-agent.ts`)** – Parses source repositories, extracts symbols, and builds a semantic graph representation. The agent can be invoked by Persistence when a new code‑related observation is created, ensuring that the graph database always contains a synchronized view of both hand‑crafted knowledge and automatically derived code structure.

* **ukb‑trace‑report (`ukb-trace-report.ts`)** – Provides a utility for assembling a detailed execution trace of UKB (Unified Knowledge Base) workflow runs. Persistence‑related events (entity creation, updates, classification) are recorded here, allowing developers to reconstruct the exact series of actions that led to a particular graph state.

The overall flow is: **client → PersistenceAgent → (optional CodeGraphAgent) → GraphDatabaseAdapter → graph DB**. All data movement is performed via strongly typed DTOs defined in the TypeScript code base, ensuring compile‑time safety.

---

## Integration Points  

Persistence sits at the intersection of several system concerns:

1. **ManualLearning** – Directly consumes the PersistenceAgent to store user‑generated entities. Both modules share the same ontology classification logic, guaranteeing consistent metadata across manual and automated inputs.  
2. **OnlineLearning** – While not directly invoking Persistence in the observations, the batch analysis pipeline it runs can produce entities that later flow through the PersistenceAgent for durable storage.  
3. **TraceReportModule** – Leverages `ukb-trace-report.ts` to surface persistence actions in its reports, providing observability into how knowledge is accumulated over time.  
4. **CodeGraphAgent** – Supplies code‑level graph fragments that Persistence can embed, enabling a unified view of both declarative observations and derived code knowledge.  
5. **GraphDatabaseAdapter** – Acts as the sole persistence gateway; any component that needs to read or write graph data must go through this adapter, ensuring a single point of change for storage‑related concerns (e.g., switching from Neo4j to another graph store).

All dependencies are expressed via import statements in the TypeScript modules, reinforcing compile‑time coupling and making the dependency graph explicit. The modular folder layout (`agents/`, `storage/`, `utils/`) mirrors the logical separation of responsibilities.

---

## Usage Guidelines  

* **Always route persistence through the PersistenceAgent.** Direct calls to the GraphDatabaseAdapter should be limited to low‑level utilities or migration scripts; business‑level code must respect the ontology classification enforced by the agent.  
* **When persisting code‑related observations, invoke the CodeGraphAgent first.** Retrieve the generated graph fragment and attach it to the entity payload before handing it to the PersistenceAgent. This guarantees that the code knowledge graph stays synchronized with hand‑crafted observations.  
* **Leverage the UKB trace utilities for debugging.** After each persistence operation, the agent logs a trace entry; developers should consult `ukb-trace-report.ts` when troubleshooting missing or malformed entities.  
* **Treat the GraphDatabaseAdapter as an immutable contract.** If a new storage backend is needed, implement the same method signatures inside the adapter rather than scattering database‑specific code throughout agents.  
* **Follow the ontology taxonomy defined by the PersistenceAgent.** Adding custom classification types requires extending the agent’s internal mapping, not ad‑hoc string literals, to keep downstream consumers (search, analytics) consistent.

---

### Summary of Architectural Insights  

1. **Architectural patterns identified** – Adapter pattern (GraphDatabaseAdapter), Agent/Façade pattern (PersistenceAgent, CodeGraphAgent), modular separation of concerns.  
2. **Design decisions and trade‑offs** – Centralising ontology logic in PersistenceAgent improves consistency but creates a single point of responsibility; using an adapter isolates storage specifics, enabling future backend swaps at the cost of an additional abstraction layer.  
3. **System structure insights** – Persistence is a leaf sub‑component of KnowledgeManagement, sharing services with ManualLearning and TraceReportModule while remaining decoupled from OnlineLearning’s batch pipeline. The folder hierarchy mirrors the logical layering (agents → storage → utils).  
4. **Scalability considerations** – Because all writes funnel through a single adapter, scaling the graph database (horizontal sharding, clustering) can be addressed by enhancing the adapter’s connection pool and transaction handling without touching higher‑level agents. The agent model also permits parallel processing of independent entity batches.  
5. **Maintainability assessment** – High maintainability: clear boundaries, type‑safe contracts, and a single source of truth for storage interactions. The main risk is the concentration of ontology rules in PersistenceAgent; any change to classification schemes requires careful regression testing across all consumers.


## Hierarchy Context

### Parent
- [KnowledgeManagement](./KnowledgeManagement.md) -- [LLM] The KnowledgeManagement component utilizes a modular architecture, with separate modules for graph database adaptation, persistence, and semantic analysis. This is evident in the way the GraphDatabaseAdapter (integrations/mcp-server-semantic-analysis/src/storage/graph-database-adapter.ts) is used for persistence, and the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) is used for managing entity persistence and ontology classification. The CodeGraphAgent (integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts) is also used for constructing code knowledge graphs and providing semantic code search capabilities. The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) is used for generating detailed trace reports of UKB workflow runs. This modular design allows for flexibility and maintainability of the component.

### Siblings
- [ManualLearning](./ManualLearning.md) -- ManualLearning utilizes the PersistenceAgent (integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts) for managing entity persistence and ontology classification.
- [OnlineLearning](./OnlineLearning.md) -- OnlineLearning utilizes the batch analysis pipeline to extract knowledge from git history, LSL sessions, and code analysis.
- [TraceReportModule](./TraceReportModule.md) -- The ukb-trace-report (integrations/mcp-server-semantic-analysis/src/utils/ukb-trace-report.ts) is used to generate detailed trace reports of UKB workflow runs.


---

*Generated from 7 observations*
