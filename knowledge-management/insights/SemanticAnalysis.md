# SemanticAnalysis

**Type:** Component

The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entities. It features a modular architecture with various agents, each responsible for a specific task, such as ontology classification, semantic analysis, and content validation. The system utilizes a range of technologies, including GraphDatabaseAdapter for persistence, LLMService for language model integration, and Wave agents for concurrent execution.

## What It Is  

The **SemanticAnalysis** component lives under the **integrations/mcp‑server‑semantic‑analysis** folder and is realized as a **multi‑agent system** that ingests Git history and Live‑Session‑Logging (LSL) streams, extracts structured knowledge entities, and persists them for downstream consumption. The core agents are implemented in the following files:  

* `integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts` – **OntologyClassificationAgent**  
* `integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts` – **SemanticAnalysisAgent**  
* `integrations/mcp-server-semantic-analysis/src/agents/code-graph-agent.ts` – **CodeGraphAgent**  
* `integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts` – **ContentValidationAgent**  
* `integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts` – **BaseAgent** (the shared execution contract)

Together with the child modules **Pipeline**, **Ontology**, **Insights**, **CodeKnowledgeGraph**, **EntityValidator**, **LLMFacade**, **WorkflowOrchestrator**, **GraphDatabaseAdapter**, and **MemgraphAdapter**, SemanticAnalysis forms a self‑contained knowledge‑extraction pipeline that sits under the top‑level **Coding** component. Its siblings—*LiveLoggingSystem*, *LLMAbstraction*, *DockerizedServices*, *Trajectory*, *KnowledgeManagement*, *CodingPatterns*, and *ConstraintSystem*—share the same multi‑agent and modular philosophy, but each focuses on a different domain (logging, LLM abstraction, container orchestration, etc.).

---

## Architecture and Design  

### Multi‑Agent Architecture  
SemanticAnalysis adopts a **multi‑agent architecture** where each responsibility is encapsulated in a dedicated agent class that extends the **BaseAgent** (see `base-agent.ts`). The BaseAgent defines a standard lifecycle (`initialize`, `execute`, `handleResponse`, `shutdown`) and error‑handling semantics, allowing the system to launch agents concurrently via the **Wave** execution framework (mentioned in the observations). This design isolates concerns, makes the system horizontally extensible, and mirrors the pattern used by sibling components such as *LiveLoggingSystem*.

### Facade & Service Abstractions  
Interaction with external language‑model services is mediated through an **LLMFacade** (child component) that wraps the **LLMService**. The `SemanticAnalysisAgent` lazily creates the LLM client via its `ensureLLMInitialized()` method, preventing unnecessary warm‑up costs. This lazy‑initialization pattern is a concrete implementation of the **Facade** pattern, providing a simple, stable API while shielding agents from provider‑specific details.

### Pipeline Orchestration (DAG)  
The **Pipeline** child component is orchestrated by the **WorkflowOrchestrator** and driven by a DAG definition stored in `pipeline-configuration.yaml`. Each step declares explicit `depends_on` edges, enabling a topological sort at runtime. This **pipeline‑as‑code** approach gives the system deterministic execution order and makes it straightforward to add, remove, or reorder processing stages without touching agent code.

### Ontology‑Driven Classification  
The **OntologyClassificationAgent** consumes hierarchical definitions from `ontology-definitions.yaml` (as described for the Ontology child). By applying a two‑level classification (upper and lower ontology), the agent maps raw observations onto a structured taxonomy, a pattern that aligns with the **Strategy** pattern: the classification algorithm can be swapped by providing a different strategy implementation.

### Knowledge‑Graph Construction  
`CodeGraphAgent` builds a **code knowledge graph** using AST parsing and persists it via the **MemgraphAdapter** (child). This follows the **Builder** pattern: `CodeKnowledgeGraphBuilder.buildGraph()` incrementally assembles graph nodes and relationships before flushing them to Memgraph. The resulting graph enables **semantic code search** and is later queried by the **Insights** generator.

### Validation & Staleness Detection  
`ContentValidationAgent` implements a validation strategy based on entity metadata (see `EntityValidator.validateEntity()`). It checks for content accuracy and flags stale entities, embodying the **Validator** pattern common across the *ConstraintSystem* sibling.

Overall, the architecture is **modular**, **plug‑and‑play**, and **layered**: agents sit on top of service facades, which in turn rely on persistence adapters, all coordinated by a DAG‑driven pipeline orchestrator.

---

## Implementation Details  

### BaseAgent (`base-agent.ts`)  
All agents inherit from `BaseAgent`, which provides:  

* **`initialize(context: AgentContext)`** – prepares dependencies (e.g., database connections, LLM client handles).  
* **`execute(payload: any)`** – the core business logic, implemented by each concrete agent.  
* **`handleResponse(result: AgentResult)`** – normalises output into a common `AgentResponse` shape.  
* **`shutdown()`** – graceful cleanup of resources.

This contract guarantees that the **Wave** runtime can schedule any agent uniformly and collect results in a predictable format.

### OntologyClassificationAgent (`ontology-classification-agent.ts`)  
* Reads the ontology hierarchy from `ontology-definitions.yaml`.  
* Receives raw observations (git commits, LSL events) and maps them to ontology nodes using a hierarchical lookup.  
* Emits classified entities that are fed downstream to the **SemanticAnalysisAgent**.

### SemanticAnalysisAgent (`semantic-analysis-agent.ts`)  
* Implements **lazy LLM initialization** via `ensureLLMInitialized()`. The first call creates an instance of the LLM client through the **LLMFacade**, deferring network and model loading costs.  
* Performs deep semantic analysis on the classified observations, extracting entities such as functions, classes, and architectural patterns.  
* Persists enriched entities via the **GraphDatabaseAdapter** (child) and forwards graph‑ready data to **CodeGraphAgent**.

### CodeGraphAgent (`code-graph-agent.ts`)  
* Parses source files into ASTs, then walks the trees to generate nodes (e.g., `Function`, `Class`, `Import`) and edges (e.g., `calls`, `inherits`).  
* Calls `CodeKnowledgeGraphBuilder.buildGraph()` (child) to assemble the graph in memory.  
* Writes the final graph to Memgraph through **MemgraphAdapter**, enabling fast graph queries for downstream insights.

### ContentValidationAgent (`content-validation-agent.ts`)  
* Receives entities from the semantic pipeline and validates them against the ontology definitions and metadata timestamps.  
* Detects **staleness** by comparing the entity’s last‑updated marker with the current repository head.  
* Emits validation reports that are stored alongside the entities, informing the **Insights** generator about potential knowledge decay.

### Persistence Adapters  
* **GraphDatabaseAdapter** abstracts a generic graph store (e.g., Neo4j) used for high‑level knowledge entities.  
* **MemgraphAdapter** is specialised for the code‑knowledge graph, offering low‑latency traversal for semantic search. Both adapters expose CRUD‑style methods (`createNode`, `createRelationship`, `query`) that agents invoke without needing to know the underlying database driver.

### Orchestration (`WorkflowOrchestrator` + `pipeline-configuration.yaml`)  
* The orchestrator reads the DAG definition, resolves dependencies, and launches agents in parallel where possible.  
* Steps are defined as `agent: <AgentClass>` plus optional `params`. The orchestrator injects the shared `AgentContext` (containing adapters, logger, config) into each agent’s `initialize` method.

---

## Integration Points  

1. **LLM Service** – The **LLMFacade** hides the concrete provider (e.g., Claude, Copilot). Agents that need language‑model capabilities (currently only `SemanticAnalysisAgent`) request a client via `ensureLLMInitialized()`. This mirrors the integration pattern used by the *LLMAbstraction* sibling, ensuring a consistent LLM contract across the codebase.  

2. **Graph Stores** – Two adapters connect the component to persistent stores:  
   * `GraphDatabaseAdapter` (generic graph DB) – used for ontology‑linked entities.  
   * `MemgraphAdapter` (high‑performance graph DB) – used for the code knowledge graph. Both adapters are injected into the `AgentContext` and can be swapped for test doubles, supporting the **Dependency Inversion** principle.  

3. **Pipeline Configuration** – The DAG described in `pipeline-configuration.yaml` is the sole declarative integration point for adding or re‑ordering agents. Because the orchestrator reads this file at startup, developers can extend the pipeline without modifying any agent code.  

4. **Sibling Collaboration** –  
   * **LiveLoggingSystem** supplies the raw LSL session streams that feed the SemanticAnalysis pipeline.  
   * **KnowledgeManagement** consumes the persisted knowledge entities, making them searchable across the broader Coding ecosystem.  
   * **DockerizedServices** packages the entire SemanticAnalysis service (including its agents, adapters, and LLMFacade) into a container, enabling consistent deployment alongside other services like *ConstraintSystem*.  

5. **Testing Hooks** – The BaseAgent’s lifecycle methods and the adapter interfaces provide natural seams for unit‑ and integration‑testing, a pattern also leveraged by the *ConstraintSystem* component for its rule‑engine validation tests.

---

## Usage Guidelines  

* **Register Agents via the DAG** – To add a new processing step, create a concrete agent extending `BaseAgent`, place its source file under `src/agents/`, and add an entry in `pipeline-configuration.yaml` with the correct `depends_on` edges. The orchestrator will automatically wire it into the execution flow.  

* **Respect Lazy LLM Initialization** – Only call LLM‑dependent methods after `ensureLLMInitialized()` has succeeded. Avoid invoking the LLM in constructors; keep heavy initialisation inside `initialize` or the first `execute` call.  

* **Persist Through Adapters** – Never embed raw database driver calls inside agents. Use the injected `GraphDatabaseAdapter` or `MemgraphAdapter` from the `AgentContext`. This keeps agents testable and allows swapping storage back‑ends without code changes.  

* **Validate Early** – Run `ContentValidationAgent` immediately after `SemanticAnalysisAgent` to catch stale or malformed entities before they are persisted. Validation failures should be logged with the component’s structured logger (shared via `AgentContext`).  

* **Follow the Ontology Schema** – When extending the ontology, edit `ontology-definitions.yaml` and, if necessary, update `OntologyClassificationAgent` to handle new categories. The hierarchical approach (upper → lower) must be preserved to keep downstream agents (e.g., Insights) functional.  

* **Container Deployment** – Use the Docker image built by the *DockerizedServices* component. The image bundles the agents, adapters, and configuration files, guaranteeing that the same version of the pipeline runs in all environments.  

* **Monitoring & Observability** – Each agent emits structured logs and metrics (execution time, success/failure counts) through the shared logger. Integrate these with the *LiveLoggingSystem* to obtain end‑to‑end traceability from raw LSL events to final knowledge entities.

---

### Architectural patterns identified  

| Pattern | Where it appears |
|---------|------------------|
| **Multi‑Agent (Actor‑like)** | All agents (`OntologyClassificationAgent`, `SemanticAnalysisAgent`, `CodeGraphAgent`, `ContentValidationAgent`) extending `BaseAgent` |
| **Facade** | `LLMFacade` wrapping `LLMService`; lazy init in `SemanticAnalysisAgent` |
| **Builder** | `CodeKnowledgeGraphBuilder.buildGraph()` in the CodeKnowledgeGraph child |
| **Strategy** | Ontology classification strategy in `OntologyClassificationAgent` (hierarchical lookup) |
| **Validator** | `EntityValidator.validateEntity()` used by `ContentValidationAgent` |
| **Pipeline/DAG** | `PipelineController` and `pipeline-configuration.yaml` orchestrated by `WorkflowOrchestrator` |
| **Dependency Inversion** | Adapters (`GraphDatabaseAdapter`, `MemgraphAdapter`) injected via `AgentContext` |
| **Lazy Initialization** | `ensureLLMInitialized()` in `SemanticAnalysisAgent` |

---

### Design decisions and trade‑offs  

* **Agent isolation vs. coordination overhead** – By giving each concern its own agent, the system gains clear separation and easy extensibility, but the orchestrator must manage more inter‑process communication and potential race conditions. The DAG model mitigates this by defining explicit dependencies.  
* **Lazy LLM creation** – Saves resources on cold starts and reduces cost, at the expense of a slight latency penalty on the first LLM‑driven step. This trade‑off is acceptable because semantic analysis is typically batch‑oriented.  
* **Dual graph adapters** – Using a generic `GraphDatabaseAdapter` for ontology entities and a specialised `MemgraphAdapter` for code graphs optimises query performance for each use case, but introduces two persistence layers that must stay in sync.  
* **YAML‑driven pipeline** – Provides declarative extensibility and version‑controlled pipelines, but requires careful schema validation to avoid mis‑configured DAGs that could cause deadlocks.  
* **Facade over LLM providers** – Guarantees a stable API across different LLM back‑ends, yet abstracts away provider‑specific tuning knobs that might be useful for performance optimisation.

---

### System structure insights  

* The **SemanticAnalysis** component is a leaf in the **Coding** hierarchy but acts as a knowledge‑generation engine for many siblings (e.g., *KnowledgeManagement*, *LiveLoggingSystem*).  
* Its child modules form a classic **extract‑transform‑load (ETL)** pipeline:  
  1. **Extract** – `OntologyClassificationAgent` pulls raw git/LSL data.  
  2. **Transform** – `SemanticAnalysisAgent` enriches with LLM‑derived semantics; `CodeGraphAgent` builds a graph representation.  
  3. **Load** – Adapters persist entities; `EntityValidator` ensures quality before loading.  
* The component’s modularity mirrors the broader system: *LiveLoggingSystem* also uses agents and adapters; *DockerizedServices* provides containerisation for all such components, reinforcing a consistent architectural language across the project.

---

### Scalability considerations  

* **Horizontal scaling of agents** – Because agents are stateless aside from injected adapters, multiple instances can be spawned behind the Wave runtime to handle larger git histories or concurrent LSL streams.  
* **Graph database sharding** – `GraphDatabaseAdapter` can be pointed at a clustered Neo4j or similar, while `MemgraphAdapter` supports horizontal partitioning of the code‑knowledge graph, allowing the system to handle millions of code entities.  
* **Pipeline parallelism** – The DAG permits parallel execution of independent steps (e.g., classification and validation could run concurrently if the DAG is configured accordingly).  
* **LLM cost management** – Lazy initialization and the ability to cache LLM responses (via the *DockerizedServices* façade) help keep compute costs bounded as workload grows.  
* **Back‑pressure handling** – The orchestrator can be extended with a simple token‑bucket or queue to throttle ingestion when downstream adapters become saturated, preventing cascade failures.

---

### Maintainability assessment  

* **High cohesion, low coupling** – Each agent focuses on a single responsibility and communicates only through well‑defined interfaces (`BaseAgent`, adapters). This makes the codebase easy to navigate and refactor.  
* **Declarative pipeline** – Changes to processing order or addition of new agents are made in YAML, reducing the need for code changes and lowering regression risk.  
* **Testability** – The adapter abstractions and BaseAgent lifecycle enable unit tests with mock adapters, while integration tests can spin up the full DAG in a containerised environment (leveraging *DockerizedServices*).  
* **Documentation surface** – The presence of explicit file paths and naming conventions (e.g., `*-agent.ts`) provides clear discoverability. However, the lack of visible inline documentation in the observations suggests a need for consistent code comments to aid future contributors.  
* **Potential debt** – Maintaining two separate graph adapters introduces duplication; a shared abstraction layer could reduce future maintenance effort. Additionally, the lazy LLM init must be guarded against race conditions when multiple agents request the client simultaneously.  

Overall, the design choices promote extensibility and operational resilience, positioning **SemanticAnalysis** as a robust knowledge‑extraction hub within the broader **Coding** ecosystem.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, inclu; LLMAbstraction: The component's architecture is designed to be highly modular and extensible, with a range of interfaces and abstract classes that enable easy integra; DockerizedServices: The DockerizedServices component serves as the Docker containerization layer for various coding services, including semantic analysis, constraint moni; Trajectory: Key patterns in this component include the use of a multi-agent architecture, with the SpecstoryAdapter class acting as a facade for interacting with ; KnowledgeManagement: The KnowledgeManagement component plays a vital role in the overall system, providing a centralized repository of knowledge that can be leveraged by v; CodingPatterns: The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the pro; ConstraintSystem: The ConstraintSystem component plays a critical role in maintaining the integrity and consistency of the codebase, and its architecture and patterns r; SemanticAnalysis: The SemanticAnalysis component is a multi-agent system that processes git history and LSL sessions to extract and persist structured knowledge entitie.

### Children
- [Pipeline](./Pipeline.md) -- PipelineController uses a DAG-based execution model with topological sort in pipeline-configuration.yaml steps, each step declaring explicit depends_on edges
- [Ontology](./Ontology.md) -- OntologyClassifier uses a hierarchical classification approach, with upper and lower ontology definitions in ontology-definitions.yaml
- [Insights](./Insights.md) -- InsightGenerator.generateInsights() uses a pattern-based approach to generate insights from knowledge entities
- [CodeKnowledgeGraph](./CodeKnowledgeGraph.md) -- CodeKnowledgeGraphBuilder.buildGraph() constructs the code knowledge graph using AST parsing and Memgraph
- [EntityValidator](./EntityValidator.md) -- EntityValidator.validateEntity() implements a validation strategy based on entity metadata and definitions
- [LLMFacade](./LLMFacade.md) -- LLMFacade.getLLMModel() retrieves the LLM model instance based on configuration and provider
- [WorkflowOrchestrator](./WorkflowOrchestrator.md) -- WorkflowOrchestrator.runWorkflow() executes the workflow with the given input and parameters
- [GraphDatabaseAdapter](./GraphDatabaseAdapter.md) -- GraphDatabaseAdapter.persistEntity() persists the entity to the graph database
- [MemgraphAdapter](./MemgraphAdapter.md) -- MemgraphAdapter.persistCodeEntity() persists the code entity to Memgraph

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component is a comprehensive logging infrastructure designed to capture and process live session logs from various agents, including Claude Code and Copilot. It features a modular architecture with multiple sub-components, including transcript adapters, log converters, and database adapters. The system utilizes a range of technologies, such as Graphology, LevelDB, and JSON-Lines, to store and process log data. The component's architecture is designed to support multi-agent interactions, with a focus on flexibility, scalability, and performance.
- [LLMAbstraction](./LLMAbstraction.md) -- The component's architecture is designed to be highly modular and extensible, with a range of interfaces and abstract classes that enable easy integration of new providers and services. The use of dependency injection and inversion of control patterns further enhances the component's flexibility and maintainability, making it an essential part of the larger Coding project ecosystem.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component serves as the Docker containerization layer for various coding services, including semantic analysis, constraint monitoring, and code-graph-rag, along with supporting databases. Its architecture involves a multi-agent system, utilizing a range of classes and functions to manage the different services and their interactions. The component is built around a high-level facade for interacting with LLM providers, implementing circuit breaking, caching, and budget checks to ensure efficient and controlled operation.
- [Trajectory](./Trajectory.md) -- Key patterns in this component include the use of a multi-agent architecture, with the SpecstoryAdapter class acting as a facade for interacting with the Specstory extension. The component also employs a range of classes and functions to manage the connection and logging processes.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component plays a vital role in the overall system, providing a centralized repository of knowledge that can be leveraged by various tools and agents. Its ability to integrate with multiple systems and technologies makes it a key enabler of the system's functionality. The component's use of advanced technologies, such as Graphology and LevelDB, ensures that it can handle complex knowledge management tasks efficiently and effectively.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component encompasses general programming wisdom, design patterns, best practices, and coding conventions applicable across the project. It serves as a catch-all for entities not fitting other components, providing a foundation for maintainable and efficient code. The component's architecture is not explicitly defined in the provided codebase, but it is likely to involve a range of classes and functions that implement various design patterns and coding conventions.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component plays a critical role in maintaining the integrity and consistency of the codebase, and its architecture and patterns reflect a deep understanding of the complexities and challenges of large-scale software development. Its use of multiple agents, flexible persistence mechanisms, and optimized concurrency models enables it to operate efficiently and effectively, even in the face of complex and dynamic constraint validation requirements.


---

*Generated from 8 observations*
