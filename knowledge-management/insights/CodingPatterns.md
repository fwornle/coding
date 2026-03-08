# CodingPatterns

**Type:** Component

The CodingPatterns component leverages the OntologyConfigManager to load ontology configurations from specific files (integrations/mcp-server-semantic-analysis/config/ontology-config.yaml), which ensures consistent ontology management. The OntologyConfigManager is responsible for loading and managing the ontology configurations, which define the relationships between different coding concepts and patterns. For instance, the `loadConfig` method in the OntologyConfigManager class (integrations/mcp-server-semantic-analysis/config/ontology-config-manager.ts) is used to load the ontology configurations from the specified file, while the `getConfig` method is used to retrieve the loaded configurations. The use of this manager ensures that the ontology configurations are handled consistently throughout the component, which is essential for maintaining the integrity of the coding patterns and practices.

## What It Is  

The **CodingPatterns** component lives under the `coding-patterns/` hierarchy of the project and is realised through a set of concrete TypeScript modules. Its core responsibilities are to **store, retrieve, and analyse coding‑related patterns** (design patterns, conventions, best‑practices, anti‑patterns and code‑analysis results) and to turn the raw observations into actionable insights.  

Key implementation files that anchor the component are:  

* **`storage/graph-database-adapter.ts`** – the low‑level persistence gateway that talks to the graph database.  
* **`insights/generator.ts`** – the `InsightGenerator` class that consumes processed observations and emits insight objects.  
* **`integrations/mcp-server-semantic-analysis/config/ontology-config-manager.ts`** – the `OntologyConfigManager` that loads the ontology definition from `ontology-config.yaml`.  
* **`factory.ts`** – a lightweight factory that creates concrete pattern‑related domain objects (`createPattern`, `createPractice`).  
* **`file-system-watcher.ts`** – a wrapper around **chokidar** that watches source files for changes (`watchFiles`, `onFileChanged`).  
* **`pipeline-executor.ts`** – the DAG‑based pipeline runner that orders batch‑analysis steps with a topological sort (`executePipeline`, `sortSteps`).  
* **`retry-manager.ts`** – the `RetryManager` that guarantees reliable service start‑up (`retryStartService`, `onServiceStarted`).  

Together these modules give the component the ability to persist complex relationship graphs, react to file‑system events, run ordered analysis pipelines, and surface high‑level recommendations to developers. The component sits under the **Coding** root node, shares the factory and retry patterns with its siblings (e.g., *KnowledgeManagement* and *DockerizedServices*), and exposes its stored artefacts to child sub‑components such as **DesignPatterns**, **CodingConventions**, **BestPractices**, **AntiPatterns**, and **CodeAnalysis**.

---

## Architecture and Design  

### Architectural style  

The observations reveal a **modular, layered architecture** built around clear separation of concerns:

1. **Persistence Layer** – `GraphDatabaseAdapter` abstracts all graph‑DB operations, exposing `storePattern` and `retrievePatterns`.  
2. **Configuration Layer** – `OntologyConfigManager` loads the ontology definition from a YAML file, providing a single source of truth for concept relationships.  
3. **Domain‑Object Creation** – The `Factory` class follows the **Factory Method** pattern, decoupling the creation of pattern‑related objects (`Pattern`, `Practice`) from their concrete classes.  
4. **Event‑driven File Monitoring** – `FileSystemWatcher` leverages **chokidar** to emit file‑system events, enabling reactive updates without tightly coupling to the rest of the system.  
5. **Pipeline Execution** – `PipelineExecutor` implements a **Directed Acyclic Graph (DAG)** execution model with a topological sort, ensuring that batch‑analysis steps defined in `batch-analysis.yaml` run in a deterministic order.  
6. **Reliability Layer** – `RetryManager` provides a **retry‑with‑backoff** mechanism for service start‑up, mirroring the pattern used by the sibling *DockerizedServices* component.  
7. **Insight Generation** – `InsightGenerator` consumes the processed observations and applies data‑analysis heuristics to produce actionable insights.

These layers interact through well‑defined interfaces (e.g., the adapter exposes `storePattern`, the factory returns domain objects, the watcher calls back into the pipeline). The design deliberately avoids deep coupling: the persistence implementation can be swapped, the ontology can be re‑loaded without touching the insight engine, and the pipeline can be extended by adding new steps to the YAML file.

### Interaction diagram (textual)  

* **File change** → `FileSystemWatcher.watchFiles` detects → calls `PipelineExecutor.executePipeline` (the changed file becomes an input node).  
* **Pipeline step** → `PipelineExecutor.sortSteps` orders steps → each step may call `GraphDatabaseAdapter.storePattern` or `retrievePatterns`.  
* **Ontology lookup** → any step needing semantic context calls `OntologyConfigManager.getConfig`.  
* **Pattern creation** → steps use `Factory.createPattern` / `createPractice` to materialise domain objects before persisting.  
* **Insight phase** → after pipeline finishes, `InsightGenerator.generateInsights` receives the processed observations and emits insight objects consumed by downstream UI or reporting services.  
* **Service start‑up** → at component bootstrap, `RetryManager.retryStartService` ensures dependent services (e.g., the graph DB) are available before any of the above can run.

---

## Implementation Details  

### GraphDatabaseAdapter (`storage/graph-database-adapter.ts`)  
The adapter encapsulates all CRUD operations against the underlying graph store (likely Neo4j or a similar technology).  
* **`storePattern(pattern: Pattern): Promise<void>`** – serialises a `Pattern` node and its relationships, then writes it to the graph.  
* **`retrievePatterns(): Promise<Pattern[]>`** – runs a query that returns all pattern vertices, reconstructing them into domain objects.  
All child components (DesignPatterns, CodingConventions, etc.) invoke `storePattern` directly, ensuring a uniform persistence contract.

### OntologyConfigManager (`integrations/mcp-server-semantic-analysis/config/ontology-config-manager.ts`)  
* **`loadConfig(filePath: string): void`** reads `ontology-config.yaml` and builds an in‑memory map of concept relationships (e.g., “DesignPattern → belongsTo → ArchitecturalStyle”).  
* **`getConfig(): OntologyConfig`** returns the parsed configuration, used by the insight engine to contextualise patterns.

### Factory (`factory.ts`)  
Implements a simple **Factory Method**:  
* **`createPattern(data: RawPatternData): Pattern`** – validates input, selects the appropriate concrete subclass (e.g., `DesignPattern`, `AntiPattern`).  
* **`createPractice(data: RawPracticeData): Practice`** – similar logic for practice objects.  
Because the factory lives in a shared module, any new pattern type can be added without touching the persistence or pipeline code.

### FileSystemWatcher (`file-system-watcher.ts`)  
Wraps **chokidar**:  
* **`watchFiles(globPattern: string, handler: (event: FileEvent) => void): FSWatcher`** – registers a watcher on the supplied glob.  
* **`onFileChanged(event: FileEvent)`** – normalises the raw chokidar event and forwards it to the pipeline executor.  
This enables **event‑driven** updates: when a developer adds a new coding‑pattern file, the system automatically re‑processes it.

### PipelineExecutor (`pipeline-executor.ts`)  
* **`executePipeline(pipelineSpec: PipelineSpec): Promise<void>`** – loads the YAML definition, builds a DAG of steps, then runs them respecting dependencies.  
* **`sortSteps(steps: Step[]): Step[]`** – performs a topological sort, guaranteeing that a step only runs after all its predecessors have succeeded.  
The DAG model gives deterministic ordering while allowing parallel execution of independent steps (future scalability improvement).

### InsightGenerator (`insights/generator.ts`)  
* **`generateInsights(observations: Observation[]): Insight[]`** – iterates over the processed observations, applies statistical or heuristic rules (e.g., frequency of anti‑patterns, co‑occurrence of practices), and produces a list of `Insight` objects.  
These insights are the primary output consumed by UI dashboards or CI‑integrations to suggest refactorings or training needs.

### RetryManager (`retry-manager.ts`)  
* **`retryStartService(service: Service, attempts: number = 5, backoffMs: number = 200): Promise<void>`** – attempts to start a service, waiting `backoffMs` between tries, and aborts after the configured number of attempts.  
* **`onServiceStarted(service: Service): void`** – callback invoked on success, used to trigger the next bootstrap phase.  
The pattern mirrors the **retry‑with‑backoff** used in the sibling *DockerizedServices* component, reinforcing a consistent reliability strategy across the codebase.

---

## Integration Points  

1. **Parent – Coding**: As a child of the *Coding* root, CodingPatterns inherits the project‑wide logging and telemetry hooks. The component’s insights are aggregated at the parent level for cross‑component reporting.  
2. **Siblings** – *KnowledgeManagement* also uses the `GraphDatabaseAdapter` (shared persistence) and a factory for LLM instances, demonstrating a **shared‑service** approach. *DockerizedServices* supplies the retry‑with‑backoff logic that `RetryManager` re‑uses. *LiveLoggingSystem* provides classification agents that could enrich the observations fed to `InsightGenerator`.  
3. **Children** – Each child (DesignPatterns, CodingConventions, BestPractices, AntiPatterns, CodeAnalysis) calls `GraphDatabaseAdapter.storePattern` to persist its specific artefacts. They may also invoke the factory to create typed objects before storage.  
4. **External services** – The graph database itself (e.g., Neo4j) is an external dependency accessed via `GraphDatabaseAdapter`. The ontology YAML file is a configuration artifact loaded by `OntologyConfigManager`.  
5. **Pipeline definition** – `batch-analysis.yaml` (referenced by `PipelineExecutor`) lives in the component’s `config/` folder and can be edited to add new analysis steps, making the component extensible without code changes.  
6. **File‑system events** – The watcher watches source directories that contain pattern definition files; any addition or modification automatically triggers a pipeline run, keeping the graph in sync with the source of truth.

---

## Usage Guidelines  

* **Persist via the adapter** – Always create or update pattern data through `Factory.createPattern` (or `createPractice`) and then call `GraphDatabaseAdapter.storePattern`. Direct DB calls bypass validation and should be avoided.  
* **Keep the ontology current** – When new coding concepts are introduced, update `ontology-config.yaml` and run `OntologyConfigManager.loadConfig` (typically at startup) so that downstream insight calculations understand the new relationships.  
* **Leverage the file watcher** – Place new pattern definition files under the watched glob (e.g., `src/patterns/**/*.json`). The watcher will automatically enqueue a pipeline run; manual pipeline triggers are only needed for bulk operations.  
* **Extend the analysis pipeline** – To add a new batch step, edit `batch-analysis.yaml` with the new node and its dependencies, then implement the step logic as a class exposing a `run(observations): Observation[]` method. The DAG executor will handle ordering.  
* **Handle service start‑up failures** – If a dependent service (graph DB, ontology loader) is unavailable, rely on `RetryManager.retryStartService` rather than writing custom loops. The built‑in backoff prevents resource exhaustion.  
* **Consume insights responsibly** – `InsightGenerator.generateInsights` may produce a large number of suggestions; downstream consumers should filter by severity or relevance to avoid overwhelming developers.  
* **Testing** – Unit‑test each factory method, adapter CRUD operation, and pipeline step in isolation. Integration tests should spin up an in‑memory graph DB instance and verify that a file change triggers the full pipeline and persists the expected nodes.

---

### Architectural patterns identified  

1. **Factory Method** – `Factory` creates `Pattern` and `Practice` objects.  
2. **Adapter** – `GraphDatabaseAdapter` abstracts the graph database.  
3. **Configuration Manager** – `OntologyConfigManager` loads external YAML configuration.  
4. **Event‑driven file watching** – `FileSystemWatcher` uses **chokidar** to emit events.  
5. **DAG‑based pipeline execution** – `PipelineExecutor` orders steps via topological sort.  
6. **Retry‑with‑backoff** – `RetryManager` ensures reliable service startup.  
7. **Insight generation (analysis)** – `InsightGenerator` applies data‑analysis heuristics (not a formal pattern but a clear separation of concerns).

### Design decisions and trade‑offs  

| Decision | Rationale | Trade‑off |
|----------|-----------|-----------|
| Use a **graph database** for pattern storage | Captures complex relationships (e.g., “pattern A refines pattern B”) naturally. | Requires a separate service and introduces latency compared to a simple relational store. |
| Separate **ontology config** into a YAML file | Allows domain experts to edit relationships without code changes. | Runtime must reload or restart to pick up changes; potential version‑skew if multiple services read the file concurrently. |
| Implement **DAG pipeline** via YAML | Enables non‑developers to reorder or add analysis steps. | Validation of the DAG is required at load time; malformed YAML could break the pipeline. |
| Adopt **chokidar** for FS watching | Provides cross‑platform, efficient event handling. | File‑system events can be noisy; debouncing logic may be needed for large repos. |
| Centralise **retry logic** in `RetryManager` | Consistent error‑handling across components (mirrors DockerizedServices). | Adds an extra abstraction layer; developers must understand the backoff parameters to tune them. |

### System structure insights  

* The component follows a **clean‑architecture** style: UI‑agnostic core (adapter, factory, pipeline) is independent of external concerns (file system, service lifecycle).  
* Persistence, configuration, and analysis are each isolated into their own modules, making the codebase **highly modular** and encouraging reuse across siblings (e.g., KnowledgeManagement).  
* The **DAG pipeline** provides a natural extension point; new analytical capabilities can be added without touching existing step implementations.  

### Scalability considerations  

* **Horizontal scaling of the graph DB** (sharding, clustering) will allow the component to handle millions of pattern nodes as the codebase grows.  
* The DAG executor can be enhanced to run independent steps in parallel, leveraging multi‑core machines and reducing batch‑analysis latency.  
* The file‑watcher may become a bottleneck in extremely large repositories; batching events or using OS‑level debouncing can mitigate this.  
* Retry backoff parameters should be configurable to avoid overwhelming downstream services during large‑scale restarts.  

### Maintainability assessment  

* **High** – Clear separation of concerns, well‑named classes, and explicit factory methods make the codebase approachable.  
* **Medium** – The reliance on external YAML files (ontology, pipeline) introduces configuration drift risk; a validation suite for these files is essential.  
* **Low** – Direct usage of `GraphDatabaseAdapter` by many child modules could lead to duplicated query logic; introducing a repository layer would further decouple domain objects from persistence.  
* Overall, the component’s adherence to common patterns (factory, adapter, retry) and its alignment with sibling components (shared retry, shared factory) promote **consistent maintenance practices** across the entire *Coding* hierarchy.


## Hierarchy Context

### Parent
- [Coding](./Coding.md) -- Root node of the coding project knowledge hierarchy, encompassing all development infrastructure knowledge. The project consists of 8 major components: LiveLoggingSystem: The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-cla; LLMAbstraction: The LLMAbstraction component's modular design is evident in its separation of concerns, with distinct files and classes dedicated to specific aspects ; DockerizedServices: The DockerizedServices component exhibits robust service startup capabilities, thanks to the retry-with-backoff pattern implemented in the ServiceStar; Trajectory: The Trajectory component's architecture is designed to handle different connection methods to the Specstory extension, including HTTP, IPC, and file w; KnowledgeManagement: The KnowledgeManagement component utilizes a factory pattern for creating LLM instances, as seen in the Wave agents, which follow the constructor(repo; CodingPatterns: The CodingPatterns component utilizes the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for graph database interactions, which enables flex; ConstraintSystem: The ConstraintSystem component's architecture is characterized by a mix of event-driven and request-response patterns, with the UnifiedHookManager (li; SemanticAnalysis: The SemanticAnalysis component follows a modular architecture, with each agent, such as the OntologyClassificationAgent and SemanticAnalysisAgent, res.

### Children
- [DesignPatterns](./DesignPatterns.md) -- DesignPatterns uses the GraphDatabaseAdapter's storePattern method to store new design patterns in the graph database
- [CodingConventions](./CodingConventions.md) -- CodingConventions uses the GraphDatabaseAdapter's storePattern method to store new coding conventions in the graph database
- [BestPractices](./BestPractices.md) -- BestPractices uses the GraphDatabaseAdapter's storePattern method to store new best practices in the graph database
- [AntiPatterns](./AntiPatterns.md) -- AntiPatterns uses the GraphDatabaseAdapter's storePattern method to store new anti-patterns in the graph database
- [CodeAnalysis](./CodeAnalysis.md) -- CodeAnalysis uses the GraphDatabaseAdapter's storePattern method to store new code analysis results in the graph database

### Siblings
- [LiveLoggingSystem](./LiveLoggingSystem.md) -- The LiveLoggingSystem component utilizes the OntologyClassificationAgent, located in integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts, to classify observations against the ontology system. This agent employs heuristic classification and LLM integration, enabling the system to accurately categorize user interactions. The OntologyClassificationAgent's classifyObservation method takes in a set of observations and returns a list of classified results, which are then used to inform the logging process. Furthermore, the agent's use of heuristic classification allows it to adapt to changing user behavior and improve its accuracy over time.
- [LLMAbstraction](./LLMAbstraction.md) -- The LLMAbstraction component's modular design is evident in its separation of concerns, with distinct files and classes dedicated to specific aspects of its functionality. For instance, the LLMService class (lib/llm/llm-service.ts) serves as a high-level facade for all LLM operations, handling tasks such as mode routing, caching, and provider fallback. This modularity enables easier maintenance, updates, and extensions of the component. Furthermore, the use of interfaces like LLMCompletionRequest and LLMCompletionResult (lib/llm/llm-service.ts) facilitates communication between different parts of the component, ensuring consistency in data exchange.
- [DockerizedServices](./DockerizedServices.md) -- The DockerizedServices component exhibits robust service startup capabilities, thanks to the retry-with-backoff pattern implemented in the ServiceStarterModule (lib/service-starter.js). This pattern helps prevent endless loops and promotes system stability by introducing a delay between retries. For instance, the startService function in ServiceStarterModule utilizes a backoff strategy to retry failed service startups, ensuring that services are properly initialized before use. The use of Dockerization in this component further enhances deployment and management of services, making it easier to scale and maintain the system. The LLMService (lib/llm/llm-service.ts) also plays a crucial role in this component, providing high-level LLM operations such as mode routing, caching, and circuit breaking.
- [Trajectory](./Trajectory.md) -- The Trajectory component's architecture is designed to handle different connection methods to the Specstory extension, including HTTP, IPC, and file watch, as seen in the connectViaHTTP, connectViaIPC, and connectViaFileWatch methods in specstory-adapter.js. This flexibility allows the component to provide a fallback option when necessary, ensuring reliable connectivity. The SpecstoryAdapter class plays a crucial role in this design, as it encapsulates the logic for connecting to the Specstory extension via various methods. The initialize method in SpecstoryAdapter implements a retry mechanism to handle connection failures, demonstrating a focus on robustness.
- [KnowledgeManagement](./KnowledgeManagement.md) -- The KnowledgeManagement component utilizes a factory pattern for creating LLM instances, as seen in the Wave agents, which follow the constructor(repoPath, team) + ensureLLMInitialized() + execute(input) pattern for lazy LLM initialization. This pattern allows for efficient initialization of LLM instances only when required, reducing unnecessary resource allocation. The ensureLLMInitialized() method, likely defined in the Wave agent classes, ensures that the LLM instance is properly initialized before execution. This approach enables the component to manage resources effectively and optimize performance. The GraphDatabaseAdapter, employed for Graphology+LevelDB persistence, also plays a crucial role in storing and retrieving knowledge graph data, as defined in storage/graph-database-adapter.ts.
- [ConstraintSystem](./ConstraintSystem.md) -- The ConstraintSystem component's architecture is characterized by a mix of event-driven and request-response patterns, with the UnifiedHookManager (lib/agent-api/hooks/hook-manager.js) playing a central role in hook orchestration. This is evident in the way it handles hook configurations loaded by the HookConfigLoader (lib/agent-api/hooks/hook-config.js), which merges configurations from multiple sources. The ContentValidationAgent (integrations/mcp-server-semantic-analysis/src/agents/content-validation-agent.ts) is then used to validate entity content and detect staleness, leveraging the GraphDatabaseAdapter (storage/graph-database-adapter.ts) for graph database interactions and data synchronization.
- [SemanticAnalysis](./SemanticAnalysis.md) -- The SemanticAnalysis component follows a modular architecture, with each agent, such as the OntologyClassificationAgent and SemanticAnalysisAgent, responsible for a specific task. This modularity is reflected in the code organization, with each agent having its own file, such as integrations/mcp-server-semantic-analysis/src/agents/ontology-classification-agent.ts and integrations/mcp-server-semantic-analysis/src/agents/semantic-analysis-agent.ts. The use of a BaseAgent class, defined in integrations/mcp-server-semantic-analysis/src/agents/base-agent.ts, provides a standard way for all agents to create response envelopes and calculate confidence levels.


---

*Generated from 7 observations*
