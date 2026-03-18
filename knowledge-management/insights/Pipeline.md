# Pipeline

**Type:** SubComponent

The KG operators in the Pipeline perform knowledge graph operations, such as entity resolution and validation, as implemented in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file.

## What It Is  

The **Pipeline** sub‑component lives inside the **SemanticAnalysis** module and is realised as a batch‑oriented, multi‑agent execution engine. Its source code is anchored in the `integrations/mcp-server-semantic-analysis/src/agents/` directory, where the core logic is built on the `BaseAgent` class (`base-agent.ts`). The batch definition that drives the Pipeline is stored in `batch-analysis.yaml`. Within a single batch run the Pipeline coordinates a set of specialised agents – for example the **OntologyClassificationAgent** (`ontology-classification-agent.ts`), the observation‑generation logic that calls the `GraphDatabaseAdapter` (`storage/graph-database-adapter.js`), a deduplication step, and a persistence step – all orchestrated by a **coordinator agent** defined in the same `base-agent.ts` file. In short, the Pipeline is the glue that schedules, runs, and finalises a series of agents to turn raw observations into persisted, de‑duplicated insights.

---

## Architecture and Design  

The design of the Pipeline follows a **batch‑processing + coordinator/agent** architecture. A batch description in `batch-analysis.yaml` enumerates the agents that must run for a given execution cycle. The **coordinator agent** (implemented in `base-agent.ts`) reads this definition and sequentially or conditionally invokes each agent, respecting any declared dependencies. This yields a clear, deterministic execution order without the need for a full‑blown workflow engine.

The **BaseAgent** class provides a **template‑method**‑like structure that all concrete agents extend. By inheriting from `BaseAgent`, agents such as `OntologyClassificationAgent` gain a common lifecycle (initialisation → execution → cleanup) and shared utilities (logging, error handling, status reporting). This standardisation reduces duplication and enforces a uniform contract across the Pipeline’s child agents.

Key interactions are:

* **Observation generation → GraphDatabaseAdapter** – The observation‑generation agent queries the graph store via `storage/graph-database-adapter.js` to fetch ontology nodes needed for classification.  
* **KG operators → OntologyClassificationAgent** – Knowledge‑graph operations (entity resolution, validation) are performed inside `ontology-classification-agent.ts`, leveraging the same adapter for data access.  
* **Deduplication → BaseAgent** – The deduplication logic lives in `base-agent.ts` and removes duplicate observations before they are handed off to downstream agents.  
* **Persistence → BaseAgent** – After all processing steps, the persistence routine (also in `base-agent.ts`) writes the final batch results to the configured datastore.

Because the Pipeline is a sibling of **Ontology**, **Insights**, **WorkflowOrchestrator**, and **GraphDatabaseAdapter**, it shares the same graph‑access layer (`GraphDatabaseAdapter`) and benefits from the same agent‑centric conventions introduced by the **WorkflowOrchestrator** (which also relies on `BaseAgent` for orchestrating work). This tight coupling ensures that any change to the base agent contract propagates consistently across the entire SemanticAnalysis family.

---

## Implementation Details  

### Core Files  

| Path | Role |
|------|------|
| `batch-analysis.yaml` | Declarative batch definition – lists agents, order, and any conditional flags. |
| `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts` | Implements the **coordinator agent**, the **deduplication** step, and the **persistence** step. Provides the `BaseAgent` abstract class that all agents extend. |
| `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` | A concrete KG operator that performs **entity resolution** and **validation** against the ontology. Calls `GraphDatabaseAdapter` for data retrieval. |
| `storage/graph-database-adapter.js` | Adapter layer that abstracts queries to the underlying graph database, exposing methods used by the observation‑generation and ontology‑classification agents. |

### Agent Lifecycle  

1. **Initialisation** – When the coordinator parses `batch-analysis.yaml`, it instantiates each agent class via its exported constructor. The `BaseAgent` constructor sets up common context (e.g., logger, configuration).  
2. **Execution** – Each agent implements an `execute()` method. For the observation‑generation agent, `execute()` invokes `GraphDatabaseAdapter.fetchRelevantNodes()` to obtain classification candidates. The `OntologyClassificationAgent` then runs its classification logic, calling back into the adapter for validation checks.  
3. **Deduplication** – After all classification agents finish, the coordinator calls the deduplication routine defined in `base-agent.ts`. This routine scans the accumulated observations, hashes their signatures, and drops duplicates.  
4. **Persistence** – Finally, the coordinator triggers the persistence routine, which writes the cleaned observation set to the target store (e.g., a relational DB or a document store). The exact persistence mechanism is abstracted behind the same `BaseAgent` helpers, allowing the Pipeline to swap storage back‑ends with minimal code changes.  

### Standardised Structure  

All agents inherit from `BaseAgent`, which enforces:

* A **`run()`** wrapper that handles exception capture and status reporting.  
* Access to a **shared configuration object** (batch‑level settings).  
* Helper methods for **logging**, **metric emission**, and **resource cleanup**.  

Because the concrete agents only need to implement their domain‑specific `execute()` logic, the Pipeline remains extensible: adding a new agent simply requires extending `BaseAgent` and registering it in `batch-analysis.yaml`.

---

## Integration Points  

* **SemanticAnalysis (parent)** – The Pipeline is the execution engine for SemanticAnalysis. SemanticAnalysis invokes the Pipeline when a new batch of raw observations arrives, passing in any high‑level context (e.g., tenant ID, time window).  
* **GraphDatabaseAdapter (sibling)** – Both the observation‑generation logic and the ontology‑classification logic rely on this adapter for read‑only graph queries. The adapter abstracts the underlying graph store (Neo4j, JanusGraph, etc.) and presents a stable API used throughout the Pipeline.  
* **Ontology (sibling)** – The KG operators in the Pipeline (e.g., `OntologyClassificationAgent`) directly consume ontology definitions managed by the Ontology sub‑component. Any changes to ontology schemas are reflected automatically because the agents query the graph at runtime.  
* **Insights (sibling)** – After the Pipeline persists classified and de‑duplicated observations, the Insights component can consume those results to generate higher‑level patterns. The hand‑off is purely data‑driven; the Pipeline does not embed insight‑generation logic.  
* **WorkflowOrchestrator (sibling)** – While the Pipeline uses its own batch‑oriented coordinator, the broader system may invoke the Pipeline as a step within a larger workflow orchestrated by WorkflowOrchestrator. Both share the `BaseAgent` contract, making nesting possible without additional glue code.  

External interfaces are limited to the YAML batch descriptor, the `BaseAgent` public methods (`run`, `execute`), and the `GraphDatabaseAdapter` query functions. This narrow surface area simplifies testing and substitution.

---

## Usage Guidelines  

1. **Define Batches Declaratively** – Always add or reorder agents in `batch-analysis.yaml`. The coordinator reads this file at runtime; changing the code without updating the YAML will have no effect.  
2. **Extend `BaseAgent` for New Functionality** – When introducing a new processing step, create a class that extends `BaseAgent` and implement the `execute()` method. Register the new class name in the batch file. Do not duplicate logging or error‑handling logic; rely on the inherited helpers.  
3. **Leverage the GraphDatabaseAdapter** – All data needed from the knowledge graph must be fetched through `storage/graph-database-adapter.js`. Direct queries to the graph store bypassing the adapter break the abstraction and make future store swaps painful.  
4. **Respect Deduplication Order** – The deduplication routine runs automatically after all agents have executed. If an agent produces observations that must be unique by design, ensure its `execute()` method tags observations with a stable identifier to aid the deduplication hash.  
5. **Persist Only Final Results** – The persistence step is intended for the final, de‑duplicated observation set. If an intermediate result needs to be stored (e.g., for debugging), write to a temporary location inside the agent rather than invoking the persistence helper directly.  

Following these conventions keeps the Pipeline’s execution predictable, testable, and aligned with the broader SemanticAnalysis architecture.

---

### Summary of Architectural Insights  

1. **Architectural patterns identified** – Batch‑processing driven by a declarative YAML file; Coordinator/Agent pattern with a shared `BaseAgent` template; Adapter pattern for graph‑database access.  
2. **Design decisions and trade‑offs** – Centralising orchestration in a single coordinator simplifies control flow but creates a single point of scheduling logic; using a base class enforces consistency at the cost of tighter coupling among agents.  
3. **System structure insights** – The Pipeline sits under SemanticAnalysis, shares the GraphDatabaseAdapter with Ontology and Insights, and follows the same agent conventions introduced by WorkflowOrchestrator. All agents are plug‑compatible via the `BaseAgent` contract.  
4. **Scalability considerations** – Because execution is batch‑oriented, scaling horizontally can be achieved by running multiple independent batch instances (e.g., sharding by tenant or time window). The coordinator remains lightweight; the heavy lifting is in the agents (graph queries, classification), which can be optimised or cached independently.  
5. **Maintainability assessment** – High maintainability thanks to the standardized `BaseAgent` structure, clear separation of concerns (generation, KG operations, deduplication, persistence), and a single source of truth for batch composition (`batch-analysis.yaml`). The main risk is the tight coupling to the YAML schema; any schema change requires coordinated updates across the coordinator and all agents.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component's architecture is designed as a multi-agent system, with each agent responsible for a specific task. For instance, the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) is used for classifying observations against the ontology system. This agent extends the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts) class, which provides a standardized structure for agent development. The use of a base agent class ensures consistency across all agents and simplifies the development of new agents. The OntologyClassificationAgent's classification process involves querying the GraphDatabaseAdapter (storage/graph-database-adapter.js) to retrieve relevant data for classification.

### Siblings
- [Ontology](./Ontology.md) -- The Ontology sub-component uses a hierarchical approach to manage the ontology system, with upper and lower ontology definitions, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file.
- [Insights](./Insights.md) -- The Insights sub-component uses a pattern-based approach to generate insights, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts file.
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- The WorkflowOrchestrator sub-component uses a workflow-based approach to manage the execution of agents, as seen in the integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts file.
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- The GraphDatabaseAdapter sub-component uses a querying mechanism to retrieve relevant data for classification, as seen in the storage/graph-database-adapter.js file.


---

*Generated from 7 observations*
