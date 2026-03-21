# Pipeline

**Type:** SubComponent

The Pipeline's KG operators leverage the KnowledgeGraphConstructor to construct a knowledge graph of code entities using Memgraph and Tree-sitter AST parsing, as implemented in the integrations/mcp-server-semantic-analysis/src/agents/knowledge-graph-constructor.ts file.

## What It Is  

The **Pipeline** sub‑component lives inside the **SemanticAnalysis** package and is implemented across a set of tightly‑coupled agents under the path `integrations/mcp-server-semantic-analysis/src/agents/`.  Its primary responsibility is to orchestrate a multi‑stage, DAG‑driven workflow that transforms raw source‑code artefacts and git history into structured observations, validates and deduplicates them, builds a code‑centric knowledge graph, and finally persists the results into the ontology managed by the **OntologyManager**.  Key entry points include:

* `coordinator-agent.ts` – the central scheduler that drives the DAG execution.  
* `observation-generation-agent.ts` – extracts raw observations using the **CodeAnalyzer** and enriches them with ontology metadata.  
* `knowledge-graph-constructor.ts` – materialises a graph of code entities in Memgraph via Tree‑sitter AST parsing.  
* `entity-validator.ts` – validates and de‑duplicates entities, detecting staleness.  
* `ontology-manager.ts` – persists the final, classified entities into the ontology store.  

Together these agents realise the Pipeline’s end‑to‑end processing chain, enabling the higher‑level **SemanticAnalysis** component to deliver actionable insights at scale.  

![Pipeline — Relationship](../../.data/knowledge-graph/insights/images/pipeline-relationship.png)

---

## Architecture and Design  

The Pipeline follows an **agent‑based modular architecture** where each logical step is encapsulated in a dedicated TypeScript class (e.g., `OntologyClassificationAgent`, `CodeAnalyzer`, `KnowledgeGraphConstructor`).  This mirrors the broader design of the **SemanticAnalysis** component, which groups related agents (OntologyClassificationAgent, SemanticAnalysisAgent, CodeGraphAgent) to keep concerns isolated and promote independent evolution.

### DAG‑driven execution  

`coordinator-agent.ts` builds a **directed acyclic graph (DAG)** of batch‑analysis steps.  Each step declares its `depends_on` edges, and the coordinator performs a **topological sort** to determine a safe execution order.  This guarantees that, for example, the Knowledge Graph construction only runs after observations have been generated and validated.  The DAG model also makes the pipeline naturally extensible—new steps can be added by declaring additional dependencies without touching the scheduler.

### Work‑stealing concurrency  

To keep the DAG processing highly parallel, the coordinator maintains a **shared `nextIndex` counter**.  Worker threads (or async tasks) fetch the next available step by atomically incrementing this counter, implementing a classic **work‑stealing** pattern.  Idle workers immediately pull pending work, reducing latency and improving CPU utilisation, especially on large codebases where the number of steps can be substantial.

### Agent responsibilities and separation of concerns  

* **Observation Generation** (`observation-generation-agent.ts`) invokes the **CodeAnalyzer** (see `code-analyzer.ts`) to parse files and git history, then **pre‑populates** ontology fields (`entityType`, `metadata.ontologyClass`).  This avoids redundant LLM classification later in the pipeline.  
* **Knowledge Graph Construction** (`knowledge-graph-constructor.ts`) uses **Tree‑sitter** to build ASTs and writes entities to **Memgraph**, forming a rich, queryable graph of code constructs.  
* **Deduplication / Validation** (`entity-validator.ts`) employs the **EntityValidator** to compare incoming observations against existing ones, flagging stale or duplicate entries before persistence.  
* **Persistence** (`ontology-manager.ts`) interacts with the ontology hierarchy (upper/lower ontology definitions) to store validated entities, leveraging the same manager used by sibling components such as **Ontology** and **Insights**.

The design deliberately avoids a monolithic processing loop; instead, each agent can be tested, versioned, and swapped independently, which aligns with the modular ethos of the sibling components (e.g., **InsightGenerator**, **CodeGraphRAG**).

---

## Implementation Details  

### Coordinator (`coordinator-agent.ts`)  

* **DAG Construction** – Each batch step is represented as an object with a `depends_on` array.  The coordinator iterates over these definitions, building adjacency lists used by a topological sort routine (`topologicalSort()` function).  
* **Task Dispatch** – After sorting, the coordinator spawns a pool of workers.  Workers repeatedly read the atomic `nextIndex` (implemented via a `SharedArrayBuffer` or simple `let nextIndex = 0;` guarded by a mutex) and fetch the corresponding step from the sorted list.  This “pull‑based” model is the core of the work‑stealing mechanism.  

### Observation Generation (`observation-generation-agent.ts`)  

* Calls `CodeAnalyzer.analyze(filePath)` to retrieve raw code metrics and git change data.  
* Immediately writes `entityType` and `metadata.ontologyClass` into the observation payload, leveraging the ontology schema defined in `ontology-manager.ts`.  This metadata is later consumed by the **OntologyClassificationAgent** without additional LLM calls.  

### Knowledge Graph Construction (`knowledge-graph-constructor.ts`)  

* Parses source files with **Tree‑sitter** to produce AST nodes.  
* Transforms AST nodes into graph vertices/edges and streams them into **Memgraph** via its Bolt driver.  
* The constructor also registers entity relationships (e.g., function‑calls, inheritance) that downstream agents (such as **CodeGraphRAG**) can query for retrieval‑augmented generation.  

### Deduplication (`entity-validator.ts`)  

* Implements `EntityValidator.validate(observation)` which checks for content similarity, timestamp freshness, and ontology compliance.  
* Stale observations are either marked for re‑analysis or dropped, ensuring the pipeline does not waste resources on already‑known facts.  

### Persistence (`ontology-manager.ts`)  

* Provides `OntologyManager.save(entity)` which inserts the entity into the hierarchical ontology store.  
* Handles classification validation against upper‑level ontology definitions, guaranteeing semantic consistency across the **Ontology** sibling component.  

All agents expose a minimal public API (e.g., `run()`, `processStep()`) that the coordinator invokes, keeping coupling low and allowing future replacement (e.g., swapping Memgraph for another graph DB) with minimal impact.

---

## Integration Points  

* **SemanticAnalysis (parent)** – The Pipeline is instantiated by the SemanticAnalysis orchestrator, which supplies the initial list of files and git commits to analyse.  SemanticAnalysis also consumes the final knowledge graph and persisted ontology entities to feed higher‑level insight generation.  
* **CodeAnalyzer (sibling)** – Directly used by the Observation Generation agent to extract low‑level code signals.  The same CodeAnalyzer is also leveraged by the **InsightGenerator** to produce narrative insights, ensuring a single source of truth for code parsing.  
* **OntologyManager (sibling)** – Both the Pipeline’s persistence agent and the OntologyClassificationAgent rely on the manager’s hierarchical schema to classify and store entities.  This shared dependency guarantees consistent ontology evolution across the system.  
* **KnowledgeGraphConstructor (sibling)** – Supplies the graph that **CodeGraphRAG** later queries for retrieval‑augmented generation, creating a feedback loop where insights can be re‑contextualised with fresh graph data.  
* **EntityValidator (sibling)** – The deduplication logic is also used by the **InsightGenerator** to avoid emitting duplicate insights, reinforcing data hygiene throughout the platform.  

These integration points are realised through explicit TypeScript imports (e.g., `import { CodeAnalyzer } from './code-analyzer';`) and well‑defined interfaces (`IAnalyzer`, `IValidator`, `IGraphBuilder`), making the dependency graph clear and compile‑time safe.

---

## Usage Guidelines  

1. **Define DAG steps declaratively** – When extending the pipeline, add a new step object with a unique identifier and a `depends_on` list that reflects true data dependencies.  The coordinator will automatically place it in the correct execution order.  
2. **Populate ontology metadata early** – Follow the pattern in `observation-generation-agent.ts` by setting `entityType` and `metadata.ontologyClass` as soon as an observation is created.  This prevents downstream LLM classification overhead and keeps the pipeline performant.  
3. **Leverage work‑stealing** – Do not manually assign work to workers; rely on the shared `nextIndex` counter.  This ensures optimal load balancing, especially when step execution times vary widely.  
4. **Validate before persisting** – Always run observations through `EntityValidator` to catch duplicates or stale data.  Skipping this step can lead to ontology bloat and misleading insights.  
5. **Keep agents side‑effect free** – Agents should only modify the data they own and return results to the coordinator.  Avoid global mutable state beyond the controlled `nextIndex` counter; this preserves testability and simplifies reasoning about concurrency.  

---

### Architectural patterns identified  

* **Agent‑based modular architecture** – each functional concern is an isolated TypeScript class.  
* **DAG‑driven workflow with topological sort** – guarantees correct execution ordering.  
* **Work‑stealing task distribution** – shared counter enables dynamic load balancing.  
* **Pre‑population of metadata** – reduces redundant LLM classification.  
* **Separation of validation/deduplication** – dedicated `EntityValidator` ensures data quality.  

### Design decisions and trade‑offs  

* **Explicit DAG vs. ad‑hoc sequencing** – Choosing a DAG makes the pipeline deterministic and extensible, at the cost of upfront definition complexity.  
* **Work‑stealing over static partitioning** – Improves utilisation for heterogeneous step runtimes, but introduces contention on the `nextIndex` counter (mitigated by atomic operations).  
* **Agent isolation** – Enhances maintainability and testing, yet may increase inter‑agent communication overhead (mostly mitigated by in‑process calls).  
* **Pre‑populating ontology fields** – Saves LLM compute, but requires tight coupling to the ontology schema; schema changes must be propagated to the generation agent.  

### System structure insights  

The Pipeline sits as a central orchestrator within **SemanticAnalysis**, bridging low‑level code parsing (CodeAnalyzer) and high‑level knowledge representation (OntologyManager, KnowledgeGraphConstructor).  Its agents form a vertical slice that mirrors the sibling components, reinforcing a consistent “agent‑per‑concern” pattern across the codebase.  

### Scalability considerations  

* **Horizontal scaling** – Because work is pulled via the shared counter, adding more worker threads or processes linearly increases throughput until the underlying resources (CPU, Memgraph I/O) saturate.  
* **Graph size** – The Knowledge Graph constructor streams AST nodes directly to Memgraph; Memgraph’s native clustering can be leveraged for very large codebases without changing pipeline logic.  
* **DAG size** – The topological sort runs in O(V+E) time, so even thousands of steps remain cheap; however, extremely deep dependency chains could increase latency for downstream steps.  

### Maintainability assessment  

The clear separation of responsibilities, coupled with explicit TypeScript interfaces, makes the Pipeline highly maintainable.  Adding new analysis steps or swapping out the graph backend requires only modifications to the corresponding agent, leaving the coordinator untouched.  The only maintenance hotspot is the shared `nextIndex` mechanism, which must remain atomic and correctly reset between pipeline runs.  Overall, the design balances extensibility with runtime efficiency, providing a solid foundation for future growth.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- [LLM] The SemanticAnalysis component employs a multi-agent architecture, utilizing agents such as the OntologyClassificationAgent, SemanticAnalysisAgent, and CodeGraphAgent, to perform tasks such as code analysis, ontology classification, and insight generation. The OntologyClassificationAgent, for instance, is implemented in the file integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and is responsible for classifying observations against the ontology system. This agent-based approach allows for a modular and scalable design, enabling the component to handle large-scale codebases and provide meaningful insights.

### Siblings
- [Ontology](./Ontology.md) -- The OntologyManager uses a hierarchical structure to organize the ontology system, with upper and lower ontology definitions, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-manager.ts file.
- [Insights](./Insights.md) -- The InsightGenerator utilizes the CodeAnalyzer to extract meaningful insights from code files and git history, as referenced in the integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts file.
- [OntologyManager](./OntologyManager.md) -- The OntologyManager uses a hierarchical structure to organize the ontology system, with upper and lower ontology definitions, as seen in the integrations/mcp-server-semantic-analysis/src/agents/ontology-manager.ts file.
- [CodeAnalyzer](./CodeAnalyzer.md) -- The CodeAnalyzer utilizes a parsing mechanism to extract insights from code files, as implemented in the integrations/mcp-server-semantic-analysis/src/agents/code-analyzer.ts file.
- [InsightGenerator](./InsightGenerator.md) -- The InsightGenerator utilizes the CodeAnalyzer to extract meaningful insights from code files and git history, as referenced in the integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts file.
- [KnowledgeGraphConstructor](./KnowledgeGraphConstructor.md) -- The KnowledgeGraphConstructor utilizes Memgraph to store and manage the knowledge graph, as implemented in the integrations/mcp-server-semantic-analysis/src/agents/knowledge-graph-constructor.ts file.
- [EntityValidator](./EntityValidator.md) -- The EntityValidator utilizes a set of predefined rules to validate entity content, as implemented in the integrations/mcp-server-semantic-analysis/src/agents/entity-validator.ts file.
- [CodeGraphRAG](./CodeGraphRAG.md) -- The CodeGraphRAG utilizes a graph database to store and manage the code graph, as implemented in the integrations/code-graph-rag/README.md file.


---

*Generated from 7 observations*
