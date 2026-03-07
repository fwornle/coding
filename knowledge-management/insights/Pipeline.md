# Pipeline

**Type:** SubComponent

The Pipeline sub-component uses a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgent for classifying observations against the ontology system, as seen in the OntologyClassificationAgent class (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts).

## What It Is  

The **Pipeline** sub‑component lives inside the *SemanticAnalysis* feature set and is implemented under the `integrations/mcp-server-semantic-analysis/src/agents/` directory.  Its core is a **DAG‑based execution model** that orchestrates a set of agents (e.g., `SemanticAnalysisAgent`, `OntologyClassificationAgent`, `CodeAnalyzer`, `InsightGenerator`) through a topologically‑sorted workflow described in `batch-analysis.yaml`.  Each step in the YAML declares explicit `depends_on` edges, and the runtime engine materialises those edges in the `BatchScheduler` class (`integrations/mcp-server-semantic-analysis/src/agents/batch-scheduler.ts`).  The Pipeline therefore acts as a lightweight, extensible orchestrator that drives data through a series of specialised agents, each of which implements the common `BaseAgent` contract (`integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts`).  

## Architecture and Design  

The Pipeline follows a **modular, agent‑centric architecture**.  All functional units are modelled as agents that implement the standardized interface defined in `BaseAgent`.  This guarantees a uniform lifecycle (`init`, `run`, `shutdown`) and enables the `BatchScheduler` to treat every step as a black‑box node in a directed acyclic graph (DAG).  The DAG itself is a **data‑flow orchestration pattern** expressed declaratively in `batch-analysis.yaml`; the scheduler resolves execution order with a **topological sort** algorithm, guaranteeing that each agent runs only after its declared dependencies have completed.  

Concurrency is handled by the `WaveController` (`integrations/mcp-server-semantic-analysis/src/agents/wave-controller.ts`).  Its `runWithConcurrency()` method uses a **work‑stealing** strategy: a shared `nextIndex` counter is atomically incremented by any idle worker, allowing the pool to dynamically rebalance load without a central queue.  This design keeps the pipeline responsive under variable task durations and scales linearly with the number of workers.  

The agents themselves are **single‑responsibility** components.  For example, `OntologyClassificationAgent` focuses solely on mapping observations to ontology classes, while `SemanticAnalysisAgent` delegates LLM‑driven analysis to the `LLMService` (`integrations/mcp-server-semantic-analysis/src/model/llm-service.ts`).  The `PersistenceAgent` (`integrations/mcp-server-semantic-analysis/src/agents/persistence-agent.ts`) enriches entities with ontology metadata **up‑front** via `mapEntityToSharedMemory()`, eliminating redundant LLM re‑classification later in the pipeline.  This reflects a **caching‑or‑pre‑populate** optimisation pattern.  

## Implementation Details  

* **BatchScheduler (`batch-scheduler.ts`)** – Parses `batch-analysis.yaml`, builds an adjacency list of steps, and executes a topological sort to produce a linearised order that respects `depends_on`.  It then hands each step to the `WaveController` for concurrent execution.  

* **BaseAgent (`base-agent.ts`)** – Declares the contract all agents must satisfy (e.g., `execute(context)`, `configure(options)`).  By inheriting from this base class, agents gain access to shared utilities such as logging, error handling, and a common execution context that carries the shared memory populated by `PersistenceAgent`.  

* **PersistenceAgent (`persistence-agent.ts`)** – Implements `mapEntityToSharedMemory()`, which extracts the `entityType` and injects `metadata.ontologyClass` into the shared memory store before any LLM calls.  This pre‑population reduces downstream latency and LLM token usage.  

* **WaveController (`wave-controller.ts`)** – Manages a pool of worker threads (or async tasks).  Its `runWithConcurrency()` method loops while `nextIndex < totalTasks`, atomically fetching the next task index.  Idle workers immediately “steal” work, achieving high CPU utilisation without a central dispatcher.  

* **SemanticAnalysisAgent (`semantic-analysis-agent.ts`)** – Calls into `LLMService` for generation and analysis tasks.  The agent receives enriched entities from the shared memory, passes them to the LLM, and writes results back to the pipeline context.  

* **OntologyClassificationAgent (`ontology-classification-agent.ts`)** – Uses the ontology subsystem (a sibling component) to map raw observations to ontology concepts, relying on the pre‑populated metadata to avoid duplicate classification.  

* **CodeAnalyzer (`code-analyzer.ts`)** – Demonstrates the extensibility of the Pipeline: a new agent was added without touching the scheduler or other agents, simply by declaring a new step in `batch-analysis.yaml` and implementing the `BaseAgent` interface.  

The **DAGBasedExecutionModel** child component is realized by the combination of `batch-analysis.yaml` (declarative DAG) and the runtime topological sort in `BatchScheduler`.  This separation keeps the model definition data‑driven while the engine remains reusable across different pipelines.  

## Integration Points  

* **Parent – SemanticAnalysis** – The Pipeline is a core part of the `SemanticAnalysis` component.  It consumes the shared ontology definitions supplied by the sibling **Ontology** sub‑component and produces insight payloads consumed by the **Insights** and **InsightGenerator** sub‑components.  

* **Sibling – LLMService** – Agents such as `SemanticAnalysisAgent` and any future LLM‑driven agents depend on the `LLMService` class (`integrations/mcp-server-semantic-analysis/src/model/llm-service.ts`).  The service abstracts model selection, prompt construction, and response handling, providing a clean contract for agents.  

* **Sibling – Ontology** – `OntologyClassificationAgent` interacts with the Ontology subsystem to validate and enrich classifications.  The shared metadata fields (`entityType`, `metadata.ontologyClass`) created by `PersistenceAgent` are the glue that aligns Pipeline data with the Ontology model.  

* **Sibling – CodeAnalyzer / InsightGenerator** – These agents plug into the same DAG via new steps in `batch-analysis.yaml`.  Their only requirement is compliance with `BaseAgent`, illustrating the low‑coupling integration point.  

* **Child – DAGBasedExecutionModel** – The DAG model is defined in `batch-analysis.yaml` and executed by `BatchScheduler`.  Any modification to execution order, parallelism, or dependency graph is performed by editing the YAML, not by code changes, making the integration point declarative.  

## Usage Guidelines  

1. **Declare Steps Declaratively** – Add or modify pipeline stages by editing `batch-analysis.yaml`.  Ensure each step lists its `depends_on` edges so the topological sort can resolve a valid execution order.  

2. **Implement BaseAgent** – New agents must extend `BaseAgent` and implement the required methods (`execute`, `configure`, etc.).  Re‑use shared utilities (logging, context handling) provided by the base class to stay consistent with existing agents.  

3. **Pre‑populate Metadata** – When an agent introduces new entity types, follow the pattern used in `PersistenceAgent.mapEntityToSharedMemory()` to add `entityType` and `metadata.ontologyClass` early.  This avoids redundant LLM classification later in the pipeline.  

4. **Leverage Work‑Stealing Concurrency** – For CPU‑bound or I/O‑bound tasks, rely on `WaveController.runWithConcurrency()` rather than building custom thread pools.  The shared `nextIndex` counter is thread‑safe and maximises resource utilisation.  

5. **Respect Dependency Boundaries** – Do not introduce circular dependencies in `batch-analysis.yaml`.  The topological sort will fail, and the scheduler will abort the run.  Validate the DAG with a static analysis tool if possible.  

6. **Testing Agents in Isolation** – Because each agent adheres to a common interface, unit tests can instantiate an agent with a mock context and verify its behaviour without invoking the full pipeline.  Integration tests should exercise the full DAG to confirm end‑to‑end ordering and data flow.  

---

### 1. Architectural patterns identified  

* **Modular Agent‑Based Architecture** – each functional piece is an independent agent implementing a shared interface (`BaseAgent`).  
* **Declarative DAG Orchestration** – execution order is expressed in `batch-analysis.yaml` and materialised via topological sort (`BatchScheduler`).  
* **Work‑Stealing Concurrency** – `WaveController.runWithConcurrency()` uses a shared counter to dynamically balance load.  
* **Pre‑population / Caching** – `PersistenceAgent.mapEntityToSharedMemory()` enriches entities up‑front to avoid repeated LLM calls.  

### 2. Design decisions and trade‑offs  

* **Data‑driven DAG vs. hard‑coded flow** – Using a YAML‑defined DAG gives flexibility (easy re‑ordering, addition of steps) at the cost of needing validation logic to prevent malformed graphs.  
* **Standardised BaseAgent** – Guarantees consistency and simplifies the scheduler but imposes a uniform lifecycle that may be overkill for very lightweight tasks.  
* **Work‑stealing instead of fixed queues** – Improves throughput for heterogeneous task durations, though it introduces a shared mutable counter that must be atomic, adding a tiny synchronization overhead.  
* **Early ontology metadata injection** – Saves LLM tokens and latency, but requires agents to trust the pre‑populated data, potentially propagating errors if the initial classification is wrong.  

### 3. System structure insights  

The Pipeline sits under **SemanticAnalysis**, sharing the **BaseAgent** contract with sibling agents across the system.  Its child, **DAGBasedExecutionModel**, is a pure data‑driven layer that decouples *what* runs from *how* it runs.  The scheduler (`BatchScheduler`) bridges the declarative model and the runtime, while the `WaveController` provides the parallel execution engine.  All agents communicate through a shared context (populated by `PersistenceAgent`) and rely on external services such as **LLMService** and **Ontology** for domain‑specific logic.  

### 4. Scalability considerations  

* **Horizontal scaling** – Adding more worker threads or async workers in `WaveController.runWithConcurrency()` linearly increases throughput, thanks to the work‑stealing design.  
* **DAG size** – Because the scheduler performs a topological sort on every run, extremely large DAGs could add noticeable O(N + E) overhead; however, typical pipelines remain modest in size.  
* **LLM call cost** – The pre‑population strategy reduces the number of expensive LLM invocations, making the pipeline more cost‑effective as the volume of entities grows.  
* **I/O bottlenecks** – Agents that perform heavy persistence or external API calls should be written as async operations to avoid blocking the worker pool.  

### 5. Maintainability assessment  

The **modular agent interface** and **declarative DAG** make the Pipeline highly maintainable.  Adding a new capability (e.g., the `CodeAnalyzer` agent) requires only a new class extending `BaseAgent` and a step entry in `batch-analysis.yaml`.  Existing agents remain untouched, limiting regression risk.  The clear separation between orchestration (`BatchScheduler`/`WaveController`) and business logic (individual agents) aids code readability and testability.  The main maintenance burden lies in keeping the DAG definition accurate—circular dependencies or missing edges will surface as runtime errors, so a CI‑time validation step is advisable.  Overall, the design favours extensibility and low coupling, supporting long‑term evolution of the SemanticAnalysis ecosystem.


## Hierarchy Context

### Parent
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component employs a modular architecture, with each agent responsible for a specific task, such as the OntologyClassificationAgent (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts) for classifying observations against the ontology system. This modularity allows for easier maintenance and extension of the component, as new agents can be added or existing ones modified without affecting the overall system. For instance, the SemanticAnalysisAgent (integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts) utilizes the LLMService for large language model-based analysis and generation, demonstrating the flexibility of the component's design. The use of a standardized agent interface, as defined in the BaseAgent (integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts), ensures consistency across the different agents and facilitates communication between them.

### Children
- [DAGBasedExecutionModel](./DAGBasedExecutionModel.md) -- The DAG-based execution model is implemented using topological sort in batch-analysis.yaml steps, as seen in the parent context of the Pipeline sub-component.

### Siblings
- [Ontology](./Ontology.md) -- The Ontology sub-component utilizes the OntologyClassificationAgent for classifying observations against the ontology system, as seen in the OntologyClassificationAgent class (integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts).
- [Insights](./Insights.md) -- The Insights sub-component utilizes the InsightGenerator agent for generating insights from analyzed data, as seen in the InsightGenerator class (integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts).
- [CodeAnalyzer](./CodeAnalyzer.md) -- The CodeAnalyzer sub-component utilizes the CodeAnalyzer agent for analyzing code and generating insights, as seen in the CodeAnalyzer class (integrations/mcp-server-semantic-analysis/src/agents/code-analyzer.ts).
- [InsightGenerator](./InsightGenerator.md) -- The InsightGenerator sub-component utilizes the InsightGenerator agent for generating insights from analyzed data, as seen in the InsightGenerator class (integrations/mcp-server-semantic-analysis/src/agents/insight-generator.ts).
- [LLMService](./LLMService.md) -- The LLMService sub-component utilizes the LLMService class for providing large language model-based analysis and generation, as seen in the LLMService class (integrations/mcp-server-semantic-analysis/src/model/llm-service.ts).


---

*Generated from 7 observations*
