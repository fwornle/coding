# SemanticAnalysis

**Type:** Component

The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) for classifying observations against the ontology system. This modularity allows for easier maintenance and extension of the component, as new agents can be added or existing ones modified without affecting the overall system. For instance, the SemanticAnalysisAgent (integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts) utilizes the LLMService for large language model-based analysis and generation, demonstrating the flexibility of the component's design. The use of a standardized agent interface, as defined in the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts), ensures consistency across the different agents and facilitates communication between them.

## What It Is  

The **SemanticAnalysis** component lives under the `integrations/mcp-server-semantic-analysis` tree. Its core source files include a set of agents such as  

* `src/agents/ontology-classification-agent.ts` – classifies observations against the shared ontology,  
* `src/agents/semantic-analysis-agent.ts` – drives large‑language‑model (LLM)‑based analysis via the `LLMService`,  
* `src/agents/code-graph-agent.ts` – builds and queries a knowledge graph of code entities,  
* `src/agents/content‑validation-agent.ts` – enforces rule‑based integrity on the knowledge graph, and  
* `src/agents/base-agent.ts` – defines the **standardized agent interface** that all agents implement.  

Persisted knowledge is stored in a graph database accessed through the **GraphDatabaseAdapter** (`storage/graph-database-adapter.js`). The component is a child of the top‑level **Coding** knowledge hierarchy and works alongside sibling components such as **LiveLoggingSystem**, **LLMAbstraction**, **DockerizedServices**, **Trajectory**, **KnowledgeManagement**, and **ConstraintSystem**. Its own children—**Pipeline**, **Ontology**, **Insights**, **CodeAnalyzer**, **InsightGenerator**, and **LLMService**—are realized as agents or supporting classes that together deliver a full‑stack semantic analysis pipeline for source code.

---

## Architecture and Design  

SemanticAnalysis follows a **modular, agent‑based architecture**. Each distinct responsibility (ontology classification, code graph construction, LLM‑driven analysis, content validation, etc.) is encapsulated in an **agent** that implements the `BaseAgent` interface (`src/agents/base-agent.ts`). This interface guarantees a common lifecycle (initialisation, execution, result handling) and enables the component to orchestrate heterogeneous tasks without tight coupling.  

The **graph‑database adapter pattern** (`storage/graph-database-adapter.js`) abstracts the underlying graph store (Graphology + LevelDB in other parts of the system) from the agents. By delegating all CRUD and query logic to the adapter, agents such as `CodeGraphAgent` can focus on domain logic while remaining database‑agnostic. This mirrors the adapter usage seen in the sibling **KnowledgeManagement** component, reinforcing a consistent separation‑of‑concerns across the codebase.  

A **pipeline/DAG execution model** is provided by the child **Pipeline** component. The `BatchScheduler` (referenced in `src/agents/batch-scheduler.ts`) reads a DAG description (`batch-analysis.yaml`) and performs a topological sort to execute agents in dependency order. This design enables deterministic, parallelisable processing where, for example, `OntologyClassificationAgent` must finish before `InsightGenerator` consumes its results.  

Inter‑component communication is largely **interface‑driven**. Agents depend on higher‑level services such as `LLMService` (found in the **LLMAbstraction** sibling) via injected abstractions rather than concrete implementations. This mirrors the dependency‑injection pattern used by `LLMService` itself, allowing the SemanticAnalysis component to swap LLM providers (Anthropic, DMR, etc.) without code changes.

---

## Implementation Details  

### Agent Base and Concrete Agents  
`src/agents/base-agent.ts` defines the contract: methods like `initialize()`, `execute(context)`, and `shutdown()`. All concrete agents extend this class, guaranteeing that the `BatchScheduler` can treat them uniformly.  

* **OntologyClassificationAgent** (`src/agents/ontology-classification-agent.ts`) receives raw observations, queries the shared **Ontology** model, and tags entities with ontology concepts. It writes the enriched entities into the graph via the `GraphDatabaseAdapter`.  

* **SemanticAnalysisAgent** (`src/agents/semantic-analysis-agent.ts`) calls `LLMService` to perform natural‑language reasoning on code snippets and previously classified ontology data. The LLM output (e.g., summaries, pattern explanations) is stored back in the graph as **Insight** nodes.  

* **CodeGraphAgent** (`src/agents/code-graph-agent.ts`) parses source files, creates nodes for functions, classes, and modules, and establishes edges representing import, inheritance, and call relationships. It leverages the `GraphDatabaseAdapter` for bulk upserts, enabling fast traversal for later agents.  

* **ContentValidationAgent** (`src/agents/content-validation-agent.ts`) runs a rule engine against the graph, checking constraints such as “every function node must have an associated documentation node” or “ontology tags must conform to the current schema”. Violations are flagged and can abort the pipeline, preserving data integrity.  

### GraphDatabaseAdapter  
Implemented in `storage/graph-database-adapter.js`, this adapter wraps low‑level graph operations (node/edge creation, property updates, complex queries). It exposes methods like `addNode(type, properties)`, `addEdge(sourceId, targetId, type)`, and `query(cypherLikeString)`. Because the adapter is the sole point of contact with the graph store, swapping the underlying engine (e.g., moving from LevelDB‑backed Graphology to Neo4j) would only require changes inside this file.  

### Pipeline Execution  
The **Pipeline** child component reads a YAML‑defined DAG (`batch-analysis.yaml`). `BatchScheduler` parses the DAG, validates that all declared agents exist, and performs a topological sort. Execution proceeds in stages: agents without dependencies run concurrently; once a stage completes, dependent agents are scheduled. This model provides natural parallelism while respecting data dependencies (e.g., validation must wait for graph construction).  

### LLM Integration  
`LLMService` is provided by the sibling **LLMAbstraction** component (`lib/llm/llm-service.ts`). SemanticAnalysis injects an instance of this service into `SemanticAnalysisAgent`. The service abstracts provider selection, budget tracking, and sensitivity classification, allowing the agent to request `generate(prompt)` without knowing the concrete LLM implementation.  

---

## Integration Points  

1. **Ontology Sub‑component** – The `OntologyClassificationAgent` directly consumes the shared ontology definitions maintained by the parent **Coding** hierarchy. Any updates to the ontology model automatically affect classification outcomes.  

2. **LLMAbstraction** – `SemanticAnalysisAgent` depends on the `LLMService` interface. Because `LLMService` is registered in a provider registry (`lib/llm/provider-registry.js`), the SemanticAnalysis component can switch providers at runtime, aligning with the system‑wide strategy for LLM flexibility.  

3. **Graph Database** – Both **SemanticAnalysis** and **KnowledgeManagement** use the same `GraphDatabaseAdapter` (different file extensions but analogous functionality). This creates a unified persistence layer for all knowledge entities, enabling cross‑component queries (e.g., a logging system could retrieve code‑related insights).  

4. **Pipeline DAG** – The `BatchScheduler` interacts with the **DockerizedServices** component indirectly: if a downstream service (e.g., an external analysis micro‑service) is required, the scheduler can invoke it as a step defined in the DAG, reusing the retry/start‑up logic from `lib/service-starter.js`.  

5. **LiveLoggingSystem** – While not a direct dependency, the logging facilities (`integrations/mcp-server-semantic-analysis/src/logging.ts`) used by agents mirror those in LiveLoggingSystem, ensuring consistent log formatting and centralised observability across siblings.  

---

## Usage Guidelines  

* **Add New Agents via BaseAgent** – To extend functionality, create a new class under `src/agents/` that extends `BaseAgent`. Implement the required lifecycle methods and register the agent name in the DAG definition (`batch-analysis.yaml`). Because the pipeline resolves agents by name, no other component needs modification.  

* **Never Bypass the GraphDatabaseAdapter** – Direct graph manipulation inside an agent undermines the abstraction and can lead to coupling with a specific database implementation. All node/edge operations must go through the adapter’s public API.  

* **Validate Before Publishing** – Run `ContentValidationAgent` as the final step of any pipeline run. Its rule set should be kept up‑to‑date with any schema changes in the ontology or insight models.  

* **Respect Dependency Order** – When editing the DAG, ensure that agents producing data (e.g., `CodeGraphAgent`) precede consumers (e.g., `SemanticAnalysisAgent`). The scheduler will enforce topological constraints, but a mis‑ordered DAG will cause runtime failures.  

* **Leverage LLMService Configuration** – If a new LLM provider is added to `provider-registry.js`, update the `LLMService` configuration in the component’s startup script rather than hard‑coding credentials in agents. This maintains the separation of concerns and keeps budget/quota tracking centralized.  

---

### 1. Architectural patterns identified  
* **Agent‑Based Modularity** – each functional unit is an independent agent implementing a common `BaseAgent` interface.  
* **Adapter Pattern** – `GraphDatabaseAdapter` abstracts persistence details from business logic.  
* **Pipeline/DAG Execution** – the `Pipeline` child component orchestrates agents via a topologically sorted DAG.  
* **Dependency Injection** – agents receive services such as `LLMService` through injected abstractions, not concrete classes.  

### 2. Design decisions and trade‑offs  
* **Explicit Agent Interface** – promotes consistency and ease of extension, at the cost of a slightly higher learning curve for new contributors.  
* **Graph‑Database Centralisation** – enables rich relationship queries but introduces a single point of failure; the adapter mitigates this by isolating database‑specific concerns.  
* **LLM Service Abstraction** – provides flexibility to swap providers, yet adds indirection that can obscure performance characteristics of a specific model.  
* **DAG‑Based Pipeline** – guarantees correct ordering and parallelism, but requires careful maintenance of the YAML definition as the system evolves.  

### 3. System structure insights  
SemanticAnalysis is a **leaf component** in the Coding hierarchy but acts as a hub for knowledge creation: agents ingest raw code, enrich it with ontology tags, store it in a graph, and finally generate human‑readable insights. Its children (Pipeline, Ontology, Insights, CodeAnalyzer, InsightGenerator, LLMService) are realized as agents or supporting services, while its siblings share common infrastructure (logging, LLM abstraction, graph adapters).  

### 4. Scalability considerations  
* **Horizontal Agent Execution** – because the DAG scheduler can run independent agents concurrently, the system scales with additional CPU cores.  
* **Graph Database Choice** – the adapter permits swapping to a more scalable backend (e.g., Neo4j) if the knowledge graph grows beyond LevelDB’s capacity.  
* **LLM Request Batching** – `SemanticAnalysisAgent` can be enhanced to batch prompts, reducing latency and cost as the number of code entities increases.  
* **Pipeline Partitioning** – large codebases can be split into multiple DAG runs (e.g., per repository) to keep each run bounded in time and memory.  

### 5. Maintainability assessment  
The **agent‑based modularity** and **standardized interface** make the codebase highly maintainable: adding, removing, or updating functionality rarely requires changes outside the affected agent. The **adapter** isolates persistence concerns, allowing database migrations without ripple effects. Consistent logging and validation agents further reduce hidden bugs. The main maintenance burden lies in keeping the DAG definition and validation rule set synchronized with evolving ontology and insight schemas. Overall, the design strikes a strong balance between flexibility and disciplined structure, facilitating long‑term evolution.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component employs a modular architecture, with separate modules for logging, transcript conversion, and ontology classification.; LLMAbstraction: The LLMAbstraction component's architecture is designed with modularity in mind, as seen in the separation of concerns between the LLMService (lib/llm; DockerizedServices: The DockerizedServices component utilizes a microservices architecture, with each service potentially running in its own container. This is evident in; Trajectory: The Trajectory component's architecture is designed with flexibility and fault tolerance in mind, as evident from its ability to adapt to different co; KnowledgeManagement: The KnowledgeManagement component's reliance on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for persistence and automatic JSON export; CodingPatterns: The CodingPatterns component demonstrates a modular structure through its use of various integration modules, such as integrations/browser-access/ and; ConstraintSystem: The ConstraintSystem component utilizes a GraphDatabaseAdapter for persistence, which is a crucial aspect of its architecture. This adapter is respons; SemanticAnalysis: The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgen.

### Children
- [Pipeline](./Pipeline.md) -- The Pipeline uses a DAG-based execution model with topological sort in batch-analysis.yaml steps, each step declaring explicit depends_on edges, as seen in the BatchScheduler class (integrations/mcp-server-semantic-analysis/src/agents/batch-scheduler.ts).
- [Ontology](./Ontology.md) -- The Ontology sub-component utilizes the OntologyClassificationAgent for classifying observations against the ontology system, as seen in the OntologyClassificationAgent class (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts).
- [Insights](./Insights.md) -- The Insights sub-component utilizes the InsightGenerator agent for generating insights from analyzed data, as seen in the InsightGenerator class (integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts).
- [CodeAnalyzer](./CodeAnalyzer.md) -- The CodeAnalyzer sub-component utilizes the CodeAnalyzer agent for analyzing code and generating insights, as seen in the CodeAnalyzer class (integrations/mcp-server-semantic-analysis/src/agents/code-analyzer.ts).
- [InsightGenerator](./InsightGenerator.md) -- The InsightGenerator sub-component utilizes the InsightGenerator agent for generating insights from analyzed data, as seen in the InsightGenerator class (integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts).
- [LLMService](./LLMService.md) -- The LLMService sub-component utilizes the LLMService class for providing large language model-based analysis and generation, as seen in the LLMService class (integrations/mcp-server-semantic-analysis/src/model/llm-service.ts).

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component employs a modular architecture, with separate modules for logging, transcript conversion, and ontology classification. This is evident in the organization of the codebase, where each module is responsible for a specific task. For instance, the logging module (integrations/mcp-server-semantic-analysis/src/logging.ts) handles log entries and provides a unified logging interface, while the TranscriptAdapter (lib/agent-api/transcript-api.js) abstracts transcript formats and provides a unified interface for reading and converting transcripts. The use of separate modules for each task allows for easier maintenance and modification of the codebase.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component's architecture is designed with modularity in mind, as seen in the separation of concerns between the LLMService (lib/llm/llm-service.ts) and the provider registry (lib/llm/provider-registry.js). This modular design allows for the easy addition or removal of LLM providers, such as Anthropic and DMR, without affecting the core functionality of the component. Furthermore, the use of dependency injection in the LLMService enables the injection of various dependencies, including budget trackers, sensitivity classifiers, and quota trackers, which enhances the flexibility and customizability of the component.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component utilizes a microservices architecture, with each service potentially running in its own container. This is evident in the use of the startServiceWithRetry function (lib/service-starter.js) for robust service startup with retry, timeout, and exponential backoff mechanisms. For instance, in scripts/api-service.js, the spawn function from the child_process module is used to start the API server, and in scripts/dashboard-service.js, it is used to start the dashboard. The startServiceWithRetry function ensures that these services are started with a retry mechanism, preventing endless loops and providing graceful degradation when optional services fail.
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed with flexibility and fault tolerance in mind, as evident from its ability to adapt to different connection methods such as HTTP, IPC, and file watch. This is achieved through the use of the SpecstoryAdapter class in lib/integrations/specstory-adapter.js, which provides a unified interface for connecting to the Specstory extension. The connectViaHTTP function in specstory-adapter.js demonstrates this flexibility by implementing a connection retry mechanism to handle transient connection issues.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component's reliance on the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for persistence and automatic JSON export sync enables efficient data management. This is evident in the way the adapter leverages Graphology and LevelDB for robust graph database interactions. For instance, the 'syncJSONExport' function in graph-database-adapter.ts ensures that data remains consistent across different storage formats, thus supporting the project's data analysis goals.
- [CodingPatterns](./CodingPatterns.md) -- The CodingPatterns component demonstrates a modular structure through its use of various integration modules, such as integrations/browser-access/ and integrations/code-graph-rag/. These modules accommodate different coding patterns and practices, allowing for flexibility and scalability in the project's architecture. For instance, the setup-browser-access.sh script in the browser-access module automates the setup process for browser-based coding environments, while the delete-coder-workspaces.py script in the same module handles teardown processes. This modularity enables developers to easily add or remove integration modules as needed, without affecting the overall project structure. The config/teams/*.json files, which store team-specific settings and coding conventions, further emphasize the component's emphasis on modularity and configurability.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component utilizes a GraphDatabaseAdapter for persistence, which is a crucial aspect of its architecture. This adapter is responsible for storing and retrieving constraint validation results, entity refresh results, and hook configurations. The GraphDatabaseAdapter is implemented in the graphdb-adapter.ts file, which provides methods for creating, reading, updating, and deleting data in the graph database. For instance, the createConstraintValidationResult method in this file creates a new node in the graph database to store the result of a constraint validation. The use of a graph database allows for efficient querying and retrieval of complex relationships between entities, which is essential for the ConstraintSystem component.


---

*Generated from 6 observations*
